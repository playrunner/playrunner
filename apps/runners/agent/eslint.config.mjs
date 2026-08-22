import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default [
  { basePath: '..', ignores: ['**/dist', '**/node_modules'] },
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
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_' },
      ],
    },
  },
  { ...prettier, basePath: '..' },
];
