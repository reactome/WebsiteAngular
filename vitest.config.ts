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
    include: ['{src,projects}/**/*.spec.ts'],
    css: false,
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
