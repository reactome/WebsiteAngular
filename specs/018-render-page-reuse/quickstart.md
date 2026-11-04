# Quickstart: Render page reuse

Validation runs on a private host. Nothing is sent to Reactome's public services.

## 1. A site build of the branch, not beta's

Build the site into a scratch output path, never the default `dist/` a running site
serves. Serve it on a loopback port, with the content service of the private release
graph behind it.

## 2. Two render services

Run the render service twice from the branch's image, on loopback, both with
`RENDER_FILES` set to the release's files and `RENDER_BASE` pointing to the build of
step 1:

- one with `RENDER_REUSE=off`;
- one with reuse on.

Each `/health` answer names the same build, and only the second reports `reuse: true`.

## 3. The comparison (SC-003, SC-005)

Run `tools/render/reuse-compare.ts` against the two services (research R5).

- **Expected:** every SVG byte-identical, and the other formats equal after the named
  variation is stripped. The planted failure's neighbours are unchanged, and
  `replaced.failure` is at least 1.
- **Each mutant** of research R5 makes it fail.

## 4. Timing (SC-002)

Draw the same 40 or more reactions through each service at concurrency 4. The reused
median must be at most half the fresh median.

## 5. The release run (SC-001, SC-004)

Run pdf-export's figures step for release 98 against the reuse service with T031's
settings (research R6). Expected results:

- it takes at most 2 h 54 min;
- every figure is drawn;
- no request fails for want of memory, and the container stays within 3 GB;
- the figures match T031's folder, or each difference is explained.
