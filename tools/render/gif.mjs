/**
 * Animated GIF of an expression analysis, rendered by the site itself.
 *
 * GIF exists in Reactome for one reason: an expression dataset has many samples
 * and an animation is how the old site showed all of them in one file. The Java
 * exporter builds it from its own reimplementation of the diagram, which is why
 * a downloaded GIF looks nothing like the current site.
 *
 * Encoding happens inside the browser. A frame of a large diagram is tens of
 * megabytes of pixel data, and there are as many frames as there are samples;
 * shipping that out to be assembled costs far more than the finished file. The
 * page hands out primitives -- the sample list, a way to show one, a canvas of
 * what is on screen -- and the loop below composes them.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

/** Frames past this are dropped rather than rendered; reported, never silent. */
export const MAX_FRAMES = 50;

/** Milliseconds per frame. Slow enough to read the sample name on screen. */
export const DEFAULT_DELAY = 1000;

/**
 * Longest side of the animation, in pixels.
 *
 * A diagram's own coordinate space is large -- an ordinary pathway exports
 * around 6000px wide -- and a GIF pays for that once per frame. Left uncapped,
 * a four-sample analysis came out at 3MB and a twenty-sample one would be
 * unusable. Fitting to 2000px keeps labels legible at the size a figure is
 * actually looked at.
 */
export const MAX_SIZE = 2000;

const require = createRequire(import.meta.url);

/**
 * gifenc, wrapped so it can be injected into a page as a plain script.
 *
 * The published bundle is CommonJS, and a page has no module loader. Read once:
 * this is the same bytes for every render.
 */
let encoderSource;
function gifencScript() {
  encoderSource ??= readFileSync(require.resolve('gifenc'), 'utf8');
  return (
    'window.gifenc = (function () { const module = { exports: {} }; ' +
    `const exports = module.exports; ${encoderSource}\n; return module.exports; })();`
  );
}

/**
 * Encode the diagram on an already-rendered page as a GIF.
 *
 * With no expression analysis there is nothing to animate and the result is a
 * single frame -- which is what a request for a .gif of a plain diagram means.
 */
export async function gifFromPage(
  page,
  { scale = 1, delay = DEFAULT_DELAY, maxSize = MAX_SIZE } = {}
) {
  await page.addScriptTag({ content: gifencScript() });

  const result = await page.evaluate(
    async ({ scale, delay, maxFrames, maxSize }) => {
      const api = window.__renderExport;
      const { GIFEncoder, quantize, applyPalette } = window.gifenc;

      const samples = api.samples() ?? [];
      const frames = samples.length ? samples.slice(0, maxFrames) : [null];

      /** One frame's pixels, at the size the first frame established. */
      const capture = async (sample, expected, at) => {
        if (sample !== null) await api.showSample(sample);
        const canvas = await api.frameCanvas(at);
        if (expected && (canvas.width !== expected.width || canvas.height !== expected.height)) {
          throw new Error(
            `frame for "${sample}" came out ${canvas.width}x${canvas.height}, ` +
              `but the animation is ${expected.width}x${expected.height}`
          );
        }
        const context = canvas.getContext('2d');
        return {
          width: canvas.width,
          height: canvas.height,
          data: context.getImageData(0, 0, canvas.width, canvas.height).data,
        };
      };

      // Two passes over the samples, holding one frame at a time.
      //
      // A GIF has 256 colours, so the palette has to be decided before any
      // frame is written, and it has to cover every frame: one built from the
      // first frame alone shifts colours on samples whose values land elsewhere
      // on the scale. Keeping all the frames in memory to do that is what makes
      // a large diagram fall over -- a hundred megabytes of pixel data is
      // ordinary here -- so the frames are drawn twice and never accumulated.
      // Drawing is a recolour and a canvas read, which is cheap next to that.
      // What the diagram exports at, before deciding what to animate at. The
      // scale that fits it into maxSize cannot be known without this, and
      // guessing from a small probe puts a rounding error into every frame.
      let probe = await capture(frames[0], null, scale);
      const natural = [probe.width, probe.height];
      const longest = Math.max(probe.width, probe.height);
      const fit = longest > maxSize ? (scale * maxSize) / longest : scale;
      const size = fit === scale ? probe : await capture(frames[0], null, fit);
      // A full-size frame is tens of megabytes; do not hold one that is not
      // going into the animation.
      probe = null;
      // Enough pixels to characterise the colours without quantising the whole
      // animation: colours here come from a continuous scale over a fixed set
      // of diagram colours, not from photographic noise.
      const budget = 150_000;
      const step = Math.max(1, Math.floor((size.width * size.height * frames.length) / budget));
      const sampled = [];

      for (const [index, sample] of frames.entries()) {
        const frame = index === 0 ? size : await capture(sample, size, fit);
        for (let pixel = 0; pixel < frame.width * frame.height; pixel += step) {
          const at = pixel * 4;
          sampled.push(frame.data[at], frame.data[at + 1], frame.data[at + 2], 255);
        }
      }

      const palette = quantize(new Uint8Array(sampled), 256);

      const gif = GIFEncoder();
      const checksums = [];
      for (const [index, sample] of frames.entries()) {
        const frame = await capture(sample, size, fit);
        const indexed = applyPalette(frame.data, palette);
        // The palette goes in once, as the global colour table. Passing it again
        // writes a local table per frame, which is the same colours at the cost
        // of a kilobyte each.
        gif.writeFrame(indexed, frame.width, frame.height, {
          delay,
          ...(index === 0 ? { palette } : {}),
        });
        // Cheap fingerprint, to catch an animation whose frames are all the
        // same picture -- a plausible-looking file that shows nothing.
        let checksum = 0;
        for (let at = 0; at < indexed.length; at += 101) checksum = (checksum + indexed[at]) | 0;
        checksums.push(checksum);
      }
      gif.finish();

      const bytes = gif.bytes();
      let binary = '';
      const chunk = 0x8000;
      for (let at = 0; at < bytes.length; at += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(at, at + chunk));
      }

      return {
        base64: btoa(binary),
        width: size.width,
        height: size.height,
        frames: frames.length,
        samples: samples.length,
        distinct: new Set(checksums).size,
        natural,
      };
    },
    { scale, delay, maxFrames: MAX_FRAMES, maxSize }
  );

  if (result.frames > 1 && result.distinct === 1) {
    throw new Error(
      `all ${result.frames} frames are identical -- the samples are not reaching the diagram`
    );
  }

  return {
    bytes: Buffer.from(result.base64, 'base64'),
    frames: result.frames,
    samples: result.samples,
    distinct: result.distinct,
    size: [result.width, result.height],
    natural: result.natural,
    truncated: Math.max(0, result.samples - result.frames),
  };
}
