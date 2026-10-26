// ESLint: catches bugs and accessibility mistakes. Run with `pnpm lint`.
import js from '@eslint/js';
import astro from 'eslint-plugin-astro';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/',
      '**/.astro/',
      '**/.wrangler/',
      '**/node_modules/',
      // Made by the build: big downloads (e.g. onnxruntime-web, as published).
      '**/.cache/',
      'apps/*/public/on-demand/',
      // Not templates/: the app template is linted like an app, so a change
      // to a shared component can't break the next new app's first pull
      // request unseen (audit 4 J-9).
      'test-results/',
      'playwright-report/',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  ...astro.configs['flat/recommended'],
  // Accessibility rules for the HTML in .astro files (strict set).
  ...astro.configs['flat/jsx-a11y-strict'],
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // Prefer `import type` so type-only imports disappear from the output.
      '@typescript-eslint/consistent-type-imports': 'error',
      // Allow unused args/vars that start with an underscore.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // Strict equality, except for the common `== null` check.
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      // Never build HTML from strings in the browser (XSS); our CSP blocks it too.
      'no-restricted-properties': [
        'error',
        { property: 'innerHTML', message: 'Use textContent or <template> elements instead.' },
        { property: 'outerHTML', message: 'Use DOM methods instead.' },
        { property: 'insertAdjacentHTML', message: 'Use DOM methods instead.' },
      ],
      // Safari drops list semantics when bullets are hidden, so role="list" is deliberate.
      'astro/jsx-a11y/no-redundant-roles': ['error', { ul: ['list'], ol: ['list'] }],
      // Scrollable regions (e.g. wide tables) must be focusable for keyboard users.
      'astro/jsx-a11y/no-noninteractive-tabindex': ['error', { roles: ['region'] }],
      'no-eval': 'error',
      'no-implied-eval': 'error',
    },
  },
  {
    // Scripts and config files run in Node and may log.
    files: ['scripts/**', 'apps/*/scripts/**', '*.config.*', 'tests/**'],
    rules: { 'no-console': 'off' },
  },
);
