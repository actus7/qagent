import { resolve } from 'node:path';
import { withPageConfig } from '@extension/vite-config';

const rootDir = resolve(__dirname);
const srcDir = resolve(rootDir, 'src');
const packagesDir = resolve(rootDir, '..', '..', 'packages');
const extensionAliases = [
  { find: /^@extension\/storage$/, replacement: resolve(packagesDir, 'storage', 'index.ts') },
  { find: /^@extension\/storage\/(.*)$/, replacement: resolve(packagesDir, 'storage', '$1') },
  { find: /^@extension\/shared$/, replacement: resolve(packagesDir, 'shared', 'index.ts') },
  { find: /^@extension\/shared\/(.*)$/, replacement: resolve(packagesDir, 'shared', '$1') },
  { find: /^@extension\/i18n$/, replacement: resolve(packagesDir, 'i18n', 'index.ts') },
  { find: /^@extension\/i18n\/(.*)$/, replacement: resolve(packagesDir, 'i18n', '$1') },
];

export default withPageConfig({
  resolve: {
    alias: [{ find: '@src', replacement: srcDir }, ...extensionAliases],
  },
  publicDir: resolve(rootDir, 'public'),
  build: {
    outDir: resolve(rootDir, '..', '..', 'dist', 'side-panel'),
  },
});
