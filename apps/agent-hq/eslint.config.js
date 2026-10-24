import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';

export default ts.config(
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs['flat/recommended'],
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { ignoreRestSiblings: true },
      ],
    },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
    languageOptions: {
      parserOptions: {
        parser: ts.parser,
      },
    },
  },
  {
    files: [
      'src/lib/**/*',
      'src/routes/**/*.svelte',
      'src/routes/**/+page*.ts',
      'src/routes/**/+page*.js',
      'src/routes/**/+layout*.ts',
      'src/routes/**/+layout*.js',
    ],
    ignores: ['src/lib/server/**'],
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@agent-hq/queue',
              message:
                'Value imports from @agent-hq/queue are forbidden in client code. Use @agent-hq/queue/types or import type instead.',
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },
  {
    ignores: ['build/', '.svelte-kit/', 'dist/'],
  },
);
