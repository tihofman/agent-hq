import js from '@eslint/js';
import globals from 'globals';
import ts from 'typescript-eslint';

export default ts.config(
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { ignoreRestSiblings: true },
      ],
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@agent-hq/queue',
              message:
                'Imports from @agent-hq/queue are forbidden. Use @agent-hq/queue/types instead.',
              allowTypeImports: true,
            },
            {
              name: 'bullmq',
              message: 'BullMQ is forbidden in client/TUI code.',
            },
            {
              name: 'ioredis',
              message: 'ioredis is forbidden in client/TUI code.',
            },
          ],
          patterns: [
            {
              group: [
                '**/server/**',
                '**/lib/server/**',
                '**/apps/agent-hq/src/lib/server/**',
                '**/apps/agent-hq/src/routes/**',
              ],
              message:
                'Imports of server modules are forbidden in agent-hq-tui.',
            },
          ],
        },
      ],
    },
  },
  {
    ignores: ['dist/', 'node_modules/'],
  },
);
