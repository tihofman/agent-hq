import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

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
      adapter: adapter(),
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{js,ts}'],
    expect: { requireAssertions: true },
  },
});
