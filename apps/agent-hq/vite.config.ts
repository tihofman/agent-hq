import fs from 'node:fs';
import path from 'node:path';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

function nodeAdapterWithDefaults(options?: Parameters<typeof adapter>[0]) {
  const base = adapter(options);
  return {
    ...base,
    async adapt(builder: Parameters<NonNullable<typeof base.adapt>>[0]) {
      await base.adapt(builder);
      const outDir = options?.out ?? 'build';
      const envFile = path.join(outDir, 'default-env.js');
      fs.writeFileSync(
        envFile,
        "process.env.HOST ??= '127.0.0.1';\nprocess.env.PORT ??= '3333';\n",
      );
      const indexPath = path.join(outDir, 'index.js');
      if (fs.existsSync(indexPath)) {
        const content = fs.readFileSync(indexPath, 'utf-8');
        fs.writeFileSync(indexPath, `import './default-env.js';\n${content}`);
      }
    },
  };
}

export default defineConfig({
  server: {
    host: process.env.HOST || '127.0.0.1',
    port: Number(process.env.PORT) || 3333,
  },
  preview: {
    host: process.env.HOST || '127.0.0.1',
    port: Number(process.env.PORT) || 3333,
  },
  plugins: [
    tailwindcss(),
    sveltekit({
      compilerOptions: {
        runes: ({ filename }) =>
          filename.split(/[/\\]/).includes('node_modules') ? undefined : true,
      },
      adapter: nodeAdapterWithDefaults(),
    }),
  ],
  test: {
    expect: { requireAssertions: true },
    projects: [
      {
        extends: './vite.config.ts',
        test: {
          name: 'server',
          environment: 'node',
          include: ['src/**/*.{test,spec}.{js,ts}'],
        },
      },
    ],
  },
});
