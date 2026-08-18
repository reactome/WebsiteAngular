// @ts-check
/**
 * Lint configuration.
 *
 * This codebase had no linter until now, so a default rule set lights up in the
 * hundreds and would either be turned off again or ignored. The split below is
 * deliberate:
 *
 *   error  - rules that catch bugs. A violation is a defect, so it fails the
 *            build and the count must stay at zero.
 *   warn   - everything else: style, preference, and rules whose existing
 *            violations are too numerous to fix in one go. These are counted
 *            against a baseline by scripts/check-lint.mjs, which fails when the
 *            number goes up, so they shrink over time instead of accumulating.
 *
 * Type-aware rules (no-floating-promises and friends) need the type checker, so
 * they run against tsconfig.app.json -- the graph the app actually builds.
 */
const eslint = require('@eslint/js');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');

module.exports = tseslint.config(
  {
    // Generated, vendored, or build output: nothing to say about it.
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.angular/**',
      '**/out-tsc/**',
      '**/content-dist/**',
      '**/__generated__/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/*.d.ts',
      '.claude/**',
      // A minified bundle checked in as a demo, not source anyone edits.
      'web-component-demo/**',
    ],
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        // projectService rather than a fixed `project` list: this is a
        // multi-project workspace, and pointing at tsconfig.app.json alone left
        // 178 files -- every library, every spec -- unparseable and therefore
        // unlinted.
        projectService: true,
        tsconfigRootDir: __dirname,
      },
    },
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommended,
      ...angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    // Severity here means one thing: whether the codebase is already clean of
    // it. Rules with no existing violations stay errors, so a new one fails the
    // build immediately. Rules that already have violations are warnings,
    // counted against a baseline by scripts/check-lint.mjs so they can only go
    // down. Fix a rule's last violation and it should be promoted to error.
    rules: {
      // Already clean -- left as errors by the recommended sets.
      'no-empty': ['error', { allowEmptyCatch: true }],

      // Now clean, so promoted to error: a promise nobody handles swallows its
      // own failure, which is how a broken request renders an empty page with a
      // clean console. All 58 were dealt with, so a new one is a regression.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',
      '@typescript-eslint/no-namespace': 'warn',
      '@typescript-eslint/no-unused-expressions': 'warn',
      '@typescript-eslint/no-require-imports': 'warn',
      'prefer-const': 'warn',
      'no-useless-escape': 'warn',
      // Migrated in full with ng generate @angular/core:inject-migration, so
      // any new constructor injection is a step backwards.
      '@angular-eslint/prefer-inject': 'error',
      '@angular-eslint/prefer-standalone': 'warn',
      '@angular-eslint/no-output-native': 'warn',
      '@angular-eslint/no-input-rename': 'warn',
      // All twelve removed, so a new empty hook is a new mistake.
      '@angular-eslint/no-empty-lifecycle-method': 'error',
      '@angular-eslint/use-lifecycle-interface': 'warn',
      '@typescript-eslint/ban-ts-comment': 'warn',
      '@typescript-eslint/no-wrapper-object-types': 'warn',
      '@typescript-eslint/no-extra-non-null-assertion': 'warn',
      '@typescript-eslint/prefer-as-const': 'warn',
      '@angular-eslint/no-output-rename': 'warn',
      'no-useless-assignment': 'warn',
      'no-unused-vars': 'warn',
      'no-empty-pattern': 'warn',
    },
  },
  {
    files: ['**/*.html'],
    extends: [...angular.configs.templateRecommended],
    rules: {
      // Accessibility rules are worth having on and are mostly unmet today.
      '@angular-eslint/template/eqeqeq': 'warn',
      // Catches `!(value | async)`, which is truthy while the observable is
      // still pending -- a real bug pattern, but there are already four of them.
      '@angular-eslint/template/no-negated-async': 'warn',
      '@angular-eslint/template/prefer-control-flow': 'warn',
    },
  },
  {
    // Specs and tooling scripts: looser, and not held to the app's rules about
    // awaiting promises.
    files: ['**/*.spec.ts', 'e2e/**/*.ts', 'scripts/**/*.{js,mjs}', '**/scripts/**/*.ts'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      'no-undef': 'off',
      // Core no-unused-vars does not understand TypeScript -- it counted type
      // positions and parameter properties as unused and produced 526 spurious
      // warnings, a third of the entire baseline. typescript-eslint's version
      // handles those, and is already on.
      'no-unused-vars': 'off',
    },
  },
  {
    // Same reason, everywhere: keep only the TypeScript-aware rule.
    files: ['**/*.ts'],
    rules: { 'no-unused-vars': 'off' },
  }
);
