import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import importPlugin from 'eslint-plugin-import';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import tailwind from 'eslint-plugin-tailwindcss';
import prettier from 'eslint-config-prettier/flat';
import globals from 'globals';
import { fileURLToPath } from 'node:url';

// Any page entry works: both import the same theme.css (eslint-plugin-tailwindcss v4 needs a CSS entry).
const tailwindEntry = fileURLToPath(new URL('./pages/side-panel/src/index.css', import.meta.url));

// Flat config shared by every workspace; each `eslint .` resolves up to this file.
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
      react.configs.flat.recommended,
      react.configs.flat['jsx-runtime'],
      tseslint.configs.recommended,
      importPlugin.flatConfigs.recommended,
      jsxA11y.flatConfigs.recommended,
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
    settings: { react: { version: 'detect' }, tailwindcss: { cssConfigPath: tailwindEntry } },
    rules: {
      // ponytail: only the two classic hooks rules (v4 parity); v7's React Compiler rules are opt-in.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react/prop-types': 'off',
      'import/no-unresolved': 'off',
      '@typescript-eslint/consistent-type-imports': 'error',
      // assistant-* are hand-written classes in side-panel/src/index.css; `inputs` is the rest arg of cn(...inputs).
      'tailwindcss/no-custom-classname': ['warn', { whitelist: ['assistant-.*', 'inputs'] }],
    },
  },
);
