import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default [
  {
    basePath: '..',
    ignores: ['**/dist', '**/node_modules'],
  },
  { ...js.configs.recommended, basePath: '..' },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    basePath: '..',
  })),
  {
    basePath: '..',
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
      sourceType: 'module',
    },
    rules: {
      'prefer-const': 'warn',
      'no-empty': 'warn',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/ban-ts-comment': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
    },
  },
  { ...prettier, basePath: '..' },
];
