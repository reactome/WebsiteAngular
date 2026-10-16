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
    include: ['{src,projects,tools,deploy}/**/*.spec.{ts,mjs}'],
    css: false,
    // No graph credentials for any spec. graph.mjs reads them from a file when
    // the environment has none, so on a machine that has that file the specs
    // would query a real graph -- and the specs for an unreachable graph would
    // never run that path (tools/content-node/hermetic.spec.mjs).
    env: {
      CONTENT_NODE_ENV_FILE: '/nonexistent/content-node.env',
      NEO4J_USER: '',
      NEO4J_PASSWORD: '',
      SOLR_URL: '',
      SOLR_USER: '',
      SOLR_PASSWORD: '',
      SOLR_CONCURRENCY: '',
    },
  },
});
