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
    // ngx-reactome-cytoscape-style's ESM does `import { isArray } from
    // 'lodash'`, and lodash is CommonJS only, so vite's interop rejects the named
    // import ("Named export 'isArray' not found") before any test touching the
    // library can run. Inlining it makes vite transform the library and resolve
    // the interop.
    //
    // The library is installed built, from ngx-reactome-base, so a local run and
    // CI resolve the same copy. (When it was built here, a machine with dist/
    // passed without this option and CI failed on four spec files.)
    //
    // diagram/cytoscape-style-interop.spec.ts imports the library directly, so
    // this is covered by a test rather than only by whichever spec happens to
    // pull the library in first.
    server: {
      deps: {
        inline: [/reactome-cytoscape-style/],
      },
    },
  },
});
