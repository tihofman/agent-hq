import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    env: {
      AGENT_HQ_HOME: join(tmpdir(), 'agent-hq-test'),
    },
    expect: { requireAssertions: true },
    projects: [
      {
        extends: true,
        test: {
          name: 'server',
          environment: 'node',
          include: ['src/**/*.{test,spec}.{js,ts}'],
          exclude: ['src/**/*.client.{test,spec}.{js,ts}'],
        },
      },
      {
        // Component tests that mount in a DOM need Svelte's browser build.
        extends: true,
        resolve: { conditions: ['browser'] },
        test: {
          name: 'client',
          environment: 'happy-dom',
          include: ['src/**/*.client.{test,spec}.{js,ts}'],
        },
      },
    ],
  },
});
