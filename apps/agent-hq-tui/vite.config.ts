import { chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    {
      name: 'emit-package-json-and-chmod',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'package.json',
          source: JSON.stringify({ type: 'module' }, null, 2),
        });
      },
      closeBundle() {
        try {
          const outMain = resolve(
            import.meta.dirname,
            '../../dist/apps/agent-hq-tui/main.js',
          );
          chmodSync(outMain, 0o755);
        } catch {
          // Ignore if file doesn't exist
        }
      },
    },
  ],
  build: {
    target: 'node22',
    outDir: '../../dist/apps/agent-hq-tui',
    emptyOutDir: true,
    ssr: 'src/main.tsx',
    rollupOptions: {
      output: {
        entryFileNames: 'main.js',
        format: 'es',
        banner: '#!/usr/bin/env node\n',
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{js,ts,tsx}'],
  },
});
