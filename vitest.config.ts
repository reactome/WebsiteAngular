/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['src/test-setup.ts'],
    // Covers every project in the workspace. This was previously scoped to
    // website-angular only, which silently excluded pathway-browser and the
    // reactome-table / reactome-gsa-form libraries -- so most of the repo's
    // specs never ran at all.
    //
    // Note: components with an external templateUrl cannot be compiled under
    // this setup ("Component 'X' is not resolved"). Fixing that means wiring in
    // @analogjs/vite-plugin-angular, which in turn requires swapping
    // src/test-setup.ts over to Analog's zone setup and BrowserTestingModule.
    // Worth doing when we next add component-level unit tests; today every
    // component is covered through e2e/ instead.
    // tools/ too, and .mjs as well as .ts: the render service and its
    // exporters are plain modules, and tools/svg-export-harness/harness.spec.mjs
    // sat in the repo without being run by anything at all.
    include: ['{src,projects,tools}/**/*.spec.{ts,mjs}'],
    css: false,
    // There was a `server.deps.inline` here for reactome-cytoscape-style, whose
    // published ESM does `import { isArray } from 'lodash'` -- CommonJS-only, and
    // vite's interop used to reject the named import before any test could run.
    // vite no longer needs the help: the full suite passes identically with and
    // without it, checked on vitest 4. Removed rather than left in place, because
    // config that does nothing is config nobody dares touch.
    //
    // What replaced it is a test: diagram/cytoscape-style-interop.spec.ts imports
    // the library for real, so if an upgrade brings the problem back it fails as
    // a broken import rather than as a mystery in whichever spec touches it first.
  },
});
