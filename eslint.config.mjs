import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import react from '@eslint-react/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';
import importX from 'eslint-plugin-import-x';
import jsxA11y from 'eslint-plugin-jsx-a11y-x';
import tailwind from 'eslint-plugin-tailwindcss';
import prettier from 'eslint-config-prettier/flat';
import globals from 'globals';
import { fileURLToPath } from 'node:url';

// Any page entry works: both import the same theme.css (eslint-plugin-tailwindcss v4 needs a CSS entry).
const tailwindEntry = fileURLToPath(new URL('./pages/side-panel/src/index.css', import.meta.url));

// Flat config shared by every workspace; each `eslint .` resolves up to this file.
// Plugins are the ESLint 10-ready successors: @eslint-react (react), import-x (import), jsx-a11y-x (jsx-a11y).
export default defineConfig(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/node_modules/**',
      '**/tailwind.config.ts',
      '**/buildDomTree.js',
      '**/watch.js',
    ],
  },
  {
    files: ['**/*.{ts,tsx}', 'chrome-extension/**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      react.configs['recommended-typescript'],
      react.configs['disable-conflict-eslint-plugin-react-hooks'],
      tseslint.configs.recommended,
      importX.flatConfigs.recommended,
      jsxA11y.configs.recommended,
      tailwind.configs.recommended,
      prettier,
    ],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node, chrome: 'readonly' },
    },
    settings: { tailwindcss: { cssConfigPath: tailwindEntry } },
    rules: {
      // ponytail: only the two classic hooks rules (v4 parity); v7's React Compiler rules are opt-in.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'import-x/no-unresolved': 'off',
      '@typescript-eslint/consistent-type-imports': 'error',
      // assistant-* are hand-written classes in side-panel/src/index.css; `inputs` is the rest arg of cn(...inputs).
      'tailwindcss/no-custom-classname': ['warn', { whitelist: ['assistant-.*', 'inputs'] }],
    },
  },
);
