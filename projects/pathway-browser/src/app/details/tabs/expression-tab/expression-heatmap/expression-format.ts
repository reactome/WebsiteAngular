/**
 * A TPM value as the heatmap's details read it: whole numbers from 10 up, two
 * figures below. 9.95 and up round to 10 at two figures, so they read as whole
 * numbers too; trailing zeros are trimmed only after a decimal point -- trimmed
 * from any number, "10" read as "1" (9.96 TPM showed as "median 1 TPM").
 */
export function formatTpm(value: number | undefined): string {
  if (value === undefined) return '';
  if (value >= 9.95) return Math.round(value).toLocaleString('en-US');
  const text = value.toPrecision(2);
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}
