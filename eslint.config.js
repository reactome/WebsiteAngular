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
      // TypeScript's noUnusedLocals/noUnusedParameters cover the app and the
      // libraries; this covers what no tsconfig does (specs, e2e, scripts).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      // `any` flowing through the code: an API answer read as any, then passed,
      // returned or dereferenced as if its shape were known. Warned, and held
      // at today's count rule by rule (scripts/check-lint.mjs), so new code
      // types what it reads while the existing ~980 are worked down.
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',
      '@typescript-eslint/no-namespace': 'warn',
      '@typescript-eslint/no-unused-expressions': 'warn',
      '@typescript-eslint/no-require-imports': 'warn',
      'prefer-const': 'warn',
      'no-useless-escape': 'warn',
      // Migrated in full with ng generate @angular/core:inject-migration, so
      // any new constructor injection is a step backwards.
      '@angular-eslint/prefer-inject': 'error',
      // Migrated in full (signal inputs, outputs and queries, by Angular's own
      // migrations, and every signal field readonly), so a decorator input or
      // a reassignable signal field is new.
      '@angular-eslint/prefer-signals': 'error',
      '@angular-eslint/prefer-output-emitter-ref': 'error',
      // Every deprecated API the code called has been replaced, so any use of
      // one is new. Deprecated is how Angular, and the libraries, say what the
      // next major version removes.
      '@typescript-eslint/no-deprecated': 'error',
      // A thrown string has no stack, and Angular does not wait for an async
      // lifecycle hook, so its errors escape. The code has neither.
      '@typescript-eslint/only-throw-error': 'error',
      '@typescript-eslint/prefer-promise-reject-errors': 'error',
      '@typescript-eslint/await-thenable': 'error',
      // `a && a.b` guards one thing and says it twice; the rule rewrites only
      // where the result cannot change, and each of the rest was checked by hand.
      '@typescript-eslint/prefer-optional-chain': 'error',
      // An object in a template literal becomes "[object Object]", an array
      // "a,b" -- which is how a two-species filter put "9606,10090" into the
      // PDF report's address and got a 404.
      '@typescript-eslint/restrict-template-expressions': 'error',
      // A switch over a union with no default that misses a member. A default
      // branch counts as handling the rest: that is its job.
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: true },
      ],
      '@angular-eslint/no-async-lifecycle-method': 'error',
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
      // All nine were same-type comparisons, so `===` was a no-op change; a new
      // `==` is a new chance of coercion.
      '@angular-eslint/template/eqeqeq': 'error',
      // Catches `!(value | async)`, which is truthy while the observable is
      // still pending. The four there were meant exactly that, and now say so:
      // `(value | async) !== true`. (The rule's own `=== false` would not be the
      // same -- it is false while pending.)
      '@angular-eslint/template/no-negated-async': 'error',
      '@angular-eslint/template/prefer-control-flow': 'warn',
      // A <button> with no type submits its form. Most here are outside forms,
      // where it does nothing, so warned and held rather than required.
      '@angular-eslint/template/button-has-type': 'warn',
    },
  },
  {
    /**
     * The node services under tools/ -- content-node and the render service.
     *
     * They were linted by nothing at all: the config matched TypeScript, HTML
     * and the scripts directory, and these are plain .mjs. So a broken
     * identifier passed every gate -- types (tsc, on the Angular app), lint,
     * dead-code, format and 380 unit tests all green -- and the service threw
     * "ReferenceError: repeated is not defined" on its first request. Nothing
     * in the suite executes these handlers, so nothing noticed.
     *
     * no-undef is the rule that matters here, and it is an error rather than a
     * warning: in a module with no type checking behind it, an undefined
     * identifier is not a style question. Node globals are declared so that
     * process, console and Buffer are not mistaken for typos.
     */
    files: ['tools/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        URL: 'readonly',
        AbortSignal: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        window: 'readonly',
        document: 'readonly',
        // Used inside page.evaluate, which runs in the browser rather than here.
        btoa: 'readonly',
        Image: 'readonly',
      },
    },
    extends: [eslint.configs.recommended],
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
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
