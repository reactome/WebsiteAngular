/**
 * A double's text as JDK 11's `Double.toString` writes it, which Jackson
 * uses for every Double in ContentService's answers.
 *
 * JDK 11 does not always write the fewest digits that read back as the same
 * double (2^-44 is written `5.6843418860808015E-14`, where
 * `5.684341886080802E-14` reads back the same; `4.9E-324` is the shortest
 * double's), and JavaScript's own text is always the shortest, so this
 * follows JDK 11's steps. It is an independent implementation, written for
 * this repository, of the algorithm of OpenJDK 11's
 * `jdk.internal.math.FloatingDecimal` for a double (`dtoa` in its compatible
 * format, and `getChars`); no OpenJDK source text is copied.
 *
 * In outline: a double that is a whole number below 2^63 is written from its
 * integer, rounded to the digits its precision supports. Any other is
 * developed digit by digit as the quotient of two integers B / S, stopping
 * once the remainder is within half an ulp (M) of either neighbour, and
 * rounding the last digit by that remainder. Java does this in 32-bit
 * integers, 64-bit integers or big integers according to the operands'
 * estimated sizes, each with its own wrap-around and its own stopping test;
 * all three are kept, because each can decide a digit.
 */

/** The double's text as JDK 11's `Double.toString(d)` writes it. */
export function jdk11DoubleText(value: number): string {
  if (Number.isNaN(value)) return 'NaN';
  if (value === Infinity) return 'Infinity';
  if (value === -Infinity) return '-Infinity';
  if (value === 0) return Object.is(value, -0) ? '-0.0' : '0.0';
  return (value < 0 ? '-' : '') + layOut(digitsOf(Math.abs(value)));
}

/** Significant digits and the decimal exponent: the value is 0.d1d2d3… × 10^exponent. */
interface Decimal {
  readonly digits: string;
  readonly exponent: number;
}

/** Bits of the significand below its leading one. */
const FRACTION_BITS = 52;
const LEADING_ONE = 1n << BigInt(FRACTION_BITS);
const FRACTION_MASK = LEADING_ONE - 1n;
const EXPONENT_BIAS = 1023;

function bitLength(n: bigint): number {
  return n === 0n ? 0 : n.toString(2).length;
}

/** The positive, finite, non-zero double's digits. */
function digitsOf(value: number): Decimal {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  const bits = view.getBigUint64(0);
  const field = Number(bits >> BigInt(FRACTION_BITS));
  const fraction = bits & FRACTION_MASK;
  // The significand with its leading one at bit 52, the binary exponent of
  // that bit, and how many bits the double's precision has (fewer for a
  // subnormal).
  let significand: bigint;
  let binaryExponent: number;
  let precision: number;
  if (field === 0) {
    precision = bitLength(fraction);
    const shift = FRACTION_BITS + 1 - precision;
    significand = fraction << BigInt(shift);
    binaryExponent = 1 - shift - EXPONENT_BIAS;
  } else {
    significand = fraction | LEADING_ONE;
    binaryExponent = field - EXPONENT_BIAS;
    precision = FRACTION_BITS + 1;
  }
  const trailingZeros = bitLength(significand & -significand) - 1;
  // The bits that matter, from the leading one to the last one bit, and how
  // many of them lie below the binary point.
  const usedBits = FRACTION_BITS + 1 - trailingZeros;
  const belowPoint = Math.max(0, usedBits - binaryExponent - 1);
  if (belowPoint === 0 && binaryExponent <= 62) {
    return wholeNumberDigits(significand, binaryExponent, precision);
  }
  return developedDigits(significand, trailingZeros, binaryExponent, precision, belowPoint);
}

/**
 * A whole number: its integer, less the low decimal digits finer than the
 * double's precision (fewer than could be dropped), rounded half up.
 */
function wholeNumberDigits(
  significand: bigint,
  binaryExponent: number,
  precision: number
): Decimal {
  let integer =
    binaryExponent >= FRACTION_BITS
      ? significand << BigInt(binaryExponent - FRACTION_BITS)
      : significand >> BigInt(FRACTION_BITS - binaryExponent);
  // Below 2^(binaryExponent - precision - 1) no digit is significant; Java
  // drops as many decimal digits as that power of two has, less one.
  const dropped =
    binaryExponent > precision
      ? (2n ** BigInt(binaryExponent - precision - 1)).toString().length - 1
      : 0;
  if (dropped > 0) {
    const unit = 10n ** BigInt(dropped);
    const rest = integer % unit;
    integer /= unit;
    // An exact half cannot arise (the integer has more factors of two than
    // the half), so half up and half down agree; Java rounds half up.
    if (rest >= unit / 2n) integer += 1n;
  }
  const text = integer.toString();
  return { digits: text.replace(/0+$/, ''), exponent: text.length + dropped };
}

/** How many bits 5^n takes, as Java's table of them has it (0 for 5^0). */
function bitsOfPowerOfFive(n: number): number {
  return n === 0 ? 0 : bitLength(5n ** BigInt(n));
}

/**
 * Java's estimate of floor(log10(value)), from a linear approximation of
 * log10 over the significand; it can be one too high, which the first digit
 * corrects.
 */
function estimatedDecimalExponent(significand: bigint, binaryExponent: number): number {
  const scaled = 1 + Number(significand & FRACTION_MASK) / 2 ** FRACTION_BITS;
  const log10 = (scaled - 1.5) * 0.289529654 + 0.176091259 + binaryExponent * 0.301029995663981;
  return Math.floor(log10);
}

/** The integer arithmetic Java does the digits in: 32 bits, 64 bits, or unbounded. */
type Width = 32 | 64 | 'big';

function wrapTo(width: Width): (n: bigint) => bigint {
  if (width === 'big') return (n) => n;
  return (n) => BigInt.asIntN(width, n);
}

/** Any other double, developed digit by digit as B / S with the half-ulp M. */
function developedDigits(
  significand: bigint,
  trailingZeros: number,
  binaryExponent: number,
  precision: number,
  belowPoint: number
): Decimal {
  const odd = significand >> BigInt(trailingZeros);
  const usedBits = FRACTION_BITS + 1 - trailingZeros;
  let decimalExponent = estimatedDecimalExponent(significand, binaryExponent);
  // B = value × 2^belowPoint × 10^max(0, -e), S = 10^max(0, e) × 2^belowPoint,
  // and M half an ulp scaled as B, each kept as powers of two and five.
  const b5 = Math.max(0, -decimalExponent);
  const s5 = Math.max(0, decimalExponent);
  const m5 = b5;
  let b2 = b5 + belowPoint + binaryExponent - (usedBits - 1);
  let s2 = s5 + belowPoint;
  let m2 = b5 + belowPoint + binaryExponent - precision;
  const common = Math.min(b2, s2);
  b2 -= common;
  s2 -= common;
  m2 -= common;
  // A power of two's lower neighbour is half as far; Java halves M for it.
  if (usedBits === 1) m2 -= 1;
  if (m2 < 0) {
    b2 -= m2;
    s2 -= m2;
    m2 = 0;
  }
  const bBits = usedBits + b2 + (b5 < 27 ? bitsOfPowerOfFive(b5) : b5 * 3);
  const tenSBits = s2 + 1 + (s5 + 1 < 27 ? bitsOfPowerOfFive(s5 + 1) : (s5 + 1) * 3);
  const width: Width = bBits < 32 && tenSBits < 32 ? 32 : bBits < 64 && tenSBits < 64 ? 64 : 'big';
  const wrap = wrapTo(width);

  let b = wrap(wrap(odd * 5n ** BigInt(b5)) << BigInt(b2));
  const s = wrap((5n ** BigInt(s5)) << BigInt(s2));
  let m = wrap((5n ** BigInt(m5)) << BigInt(m2));
  const tenS = wrap(s * 10n);
  // Below M from the digits so far, or above 10S less M: either neighbour is
  // that near. The unbounded arithmetic's test of the second is not strict,
  // the others' is.
  const nearHigh = (): boolean => (width === 'big' ? b + m >= tenS : wrap(b + m) > tenS);
  const step = (): number => {
    const q = Number(b / s);
    b = wrap(10n * (b % s));
    m = wrap(m * 10n);
    return q;
  };

  let digits = '';
  let q = step();
  let low = b < m;
  let high = nearHigh();
  if (q === 0 && !high) {
    decimalExponent--; // the estimate was one too high
  } else {
    digits += String(q);
  }
  // Scientific form always has a digit after the point: develop a second one.
  if (decimalExponent < -3 || decimalExponent >= 8) {
    low = false;
    high = false;
  }
  while (!low && !high) {
    q = step();
    if (width !== 'big' && m <= 0n) {
      // M overflowed its width: Java takes that as both neighbours near.
      low = true;
      high = true;
    } else {
      low = b < m;
      high = nearHigh();
    }
    digits += String(q);
  }
  let exponent = decimalExponent + 1;
  if (high) {
    let up = !low;
    if (low) {
      // Both near: round by the remainder against half of 10S, a tie to an
      // even digit.
      const twice = width === 'big' ? b * 2n - tenS : wrap(wrap(b << 1n) - tenS);
      up = twice > 0n || (twice === 0n && Number(digits.at(-1)) % 2 === 1);
    }
    if (up) [digits, exponent] = roundUp(digits, exponent);
  }
  return { digits, exponent };
}

/** One added to the last digit; a carry out of all nines makes 1 and 0s, one place up. */
function roundUp(digits: string, exponent: number): [string, number] {
  const nines = /9*$/.exec(digits)?.[0].length ?? 0;
  if (nines === digits.length) {
    // Java keeps the digit count: the 0s it wrote stay.
    return [`1${'0'.repeat(digits.length - 1)}`, exponent + 1];
  }
  const kept = digits.slice(0, digits.length - nines - 1);
  const last = Number(digits.charAt(digits.length - nines - 1)) + 1;
  return [`${kept}${String(last)}${'0'.repeat(nines)}`, exponent];
}

/** Plain for 10^-3 ≤ value < 10^7, `d.dddE±n` otherwise; always a digit after the point. */
function layOut({ digits, exponent }: Decimal): string {
  if (exponent > 0 && exponent < 8) {
    if (digits.length <= exponent) return `${digits.padEnd(exponent, '0')}.0`;
    return `${digits.slice(0, exponent)}.${digits.slice(exponent)}`;
  }
  if (exponent <= 0 && exponent > -3) return `0.${'0'.repeat(-exponent)}${digits}`;
  const rest = digits.length > 1 ? digits.slice(1) : '0';
  return `${digits.charAt(0)}.${rest}E${String(exponent - 1)}`;
}
