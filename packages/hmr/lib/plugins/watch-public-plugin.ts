import type { PluginOption } from 'vite';
import { glob } from 'node:fs/promises';
import { join } from 'node:path';

export function watchPublicPlugin(): PluginOption {
  return {
    name: 'watch-public-plugin',
    async buildStart() {
      for await (const entry of glob('public/**/*', { withFileTypes: true })) {
        if (entry.isFile()) this.addWatchFile(join(entry.parentPath, entry.name));
      }
    },
  };
}
