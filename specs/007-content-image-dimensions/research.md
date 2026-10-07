# Decisions behind reserving space for content images

Each entry: what was decided, why, what was measured, and what was rejected.

Written 19 Sep 2026, after a test that had been dismissed as flaky turned out to
be reporting a real fault.

---

## D1. The bug is not the test

**Decision**: treat `content-pages.spec.ts` "clicking a table-of-contents link
scrolls to that section" as a defect report about the site, not about itself.

**Why**: it failed under parallel load and passed alone, which is the signature
everyone reads as flakiness. It failed on the assertion rather than on a
timeout -- `Received: 160.875`, later `3802.875` -- which says the heading
genuinely came to rest in the wrong place.

**Measured** on `/documentation/userguide/reactome-fiviz`, sampling after the
click:

    before the click   docHeight 27,496   116 images, 12 loaded, 0 with dimensions
    immediately after  heading top 0      docHeight 39,807   38 loaded
    250ms later        heading top 2,793  docHeight 78,312   116 loaded

The browser scrolls correctly. Then the images above the target finish loading,
each one occupying space it did not have before, and the document nearly triples
in height. Nothing re-anchors, so the reader ends up 2,793px above the section
they asked for and stays there.

**Rejected**: raising the assertion's tolerance, and marking the test flaky.
Both would have kept a real reader-facing fault out of sight -- and this is a
fault a curator meets, because the userguide pages are where they navigate by
contents link.

## D2. Six pages, not all 102

**Decision**: describe the problem by how many images a page carries.

**Measured**: 102 content pages carry at least one image; **14 carry five or
more; 6 carry twenty or more**. reactome-fiviz and tools/reactome-fiviz carry
114 each, pathway-diagram-specs 33, analysis 28, diseases 24, searching 20.

**Why it matters**: the severity scales with the count. On the long userguide
pages the reader lands thousands of pixels away; on a page with one image the
shift is small enough that nobody notices. An earlier draft of this said "every
content page", which was true and useless.

## D3. Measure at build time, in this repository

**Decision**: read each image's intrinsic size when content is staged, and ship
the numbers with the page.

**Why**: these images are files in this repository and change only when the
content does. There is no reason to make a reader's browser discover a fact we
can write down. It also cannot be done at render time: the page is rendered from
markdown in the browser, and an image's size is not known until it has loaded --
which is the problem.

**Rejected**: a CSS `aspect-ratio` default. A wrong ratio reserves the wrong
space, so the reader still jumps, in a direction nobody can predict from the
stylesheet.

## D4. Per page, not one manifest

**Decision**: attach `imageSizes` to the page's own JSON.

**Why**: a page needs only its own images, and a shared manifest would be a
second request standing between a reader and the first paragraph. The whole
corpus is 850 images; the largest page uses 114 of them.

**Rejected**: a global `image-sizes.json`. Simpler to build, worse to read.

## D5. Four formats, parsed here, rather than a dependency

**Decision**: read PNG, GIF, JPEG and SVG headers directly.

**Measured**: the corpus is 671 PNG, 33 SVG, 20 GIF, 26 JPEG, and 100 files with
no extension at all. **850 of 850 measured**, including the extensionless ones,
because the parser identifies by magic bytes rather than by filename.

**Why**: each format states its dimensions in a header a few bytes long. A
package would be a lockfile entry and a supply-chain surface for sixty lines.
The one subtlety is JPEG, where the start-of-frame segment sits after whatever
metadata precedes it -- an EXIF thumbnail pushes it kilobytes in -- so the
segments are walked rather than indexed, and there is a test with 4kB of padding
that fails against a fixed offset.

**Rejected**: trusting file extensions. A hundred files have none.

## D6. An unmeasurable image is left alone

**Decision**: if the size cannot be read, the image is absent from the map and
the renderer does not touch it. An author's own `width` or `height` always wins.

**Why**: a wrong size is worse than none. It reserves the wrong box, so the
reader gets a jump in the opposite direction, and nothing about the page
suggests the manifest is responsible.

## D7. What the review found, and why the measurement was nearly believed

Two defects in the first implementation, both caught by attacking it rather than
by running it:

- **`<img\b[^>]*>` truncates a tag at the first `>` inside an attribute.**
  Documentation is full of menu paths -- `alt="File > Export"` -- and the width
  was inserted into the middle of the alt text. Quoted values are now matched as
  units.
- **The transform was inert.** `normalizeContentUrl` strips the leading slash
  before it runs, so images measured as `/uploads/x.png` arrive as
  `uploads/x.png` and no key matched. **114 images on the page, 0 given a size.**

The second is the one worth remembering. The geometry probe had already been
re-run and looked fixed: the heading held at `top: 0` and the document grew far
less. It was a warm image cache -- 84 of 116 images already loaded at the first
sample, against 12 on the cold run. A green measurement, a plausible mechanism,
and a change doing nothing. What separated them was reading the rendered markup
and asking whether the attribute was actually present.

**The general form**: when a fix and a confounder both predict the same
improvement, measure the mechanism rather than the outcome.
