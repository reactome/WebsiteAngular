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
    // reactome-cytoscape-style's published ESM does `import { isArray } from
    // 'lodash'`, and lodash is CommonJS only, so vite's interop rejects the named
    // import before any test touching the library can run. Inlining it makes vite
    // transform the library and resolve the interop.
    //
    // **A local run can pass without this.** `tsconfig.json` maps the package to
    // `dist/reactome-cytoscape-style`, so on a machine that has built the
    // libraries the import resolves to that build, which does not need the help.
    // CI runs `npm ci` and `npm test` with no `dist/`, resolves to the
    // node_modules copy, and fails with `Named export 'isArray' not found`. I
    // removed this option on the strength of a local run and it failed CI on four
    // spec files -- two of which had nothing to do with the change.
    //
    // diagram/cytoscape-style-interop.spec.ts imports the library directly, so
    // this is now covered by a test rather than only by whichever spec happens to
    // pull the library in first.
    server: {
      deps: {
        // reactome-cytoscape-style resolves to its built output in dist/, whose
        // ESM does `import { isArray } from 'lodash'`. lodash is CommonJS-only,
        // so vite's interop rejects the named import ("Named export 'isArray'
        // not found") before the test can run. Inlining the library makes vite
        // transform it and resolve the interop.
        inline: [/reactome-cytoscape-style/],
      },
    },
  },
});
