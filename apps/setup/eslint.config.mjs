import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const setupDir = path.dirname(fileURLToPath(import.meta.url));
const webRequire = createRequire(path.resolve(setupDir, '../web/package.json'));

const { default: js } = await import(webRequire.resolve('@eslint/js'));
const { default: globals } = await import(webRequire.resolve('globals'));
const { default: react } = await import(
  webRequire.resolve('eslint-plugin-react')
);
const { default: reactHooks } = await import(
  webRequire.resolve('eslint-plugin-react-hooks')
);
const { default: reactRefresh } = await import(
  webRequire.resolve('eslint-plugin-react-refresh')
);
const { default: tseslint } = await import(
  webRequire.resolve('typescript-eslint')
);
const { default: prettier } = await import(
  webRequire.resolve('eslint-config-prettier')
);

export default [
  {
    ignores: ['dist', 'node_modules', 'vite.config.ts', 'src/vite-env.d.ts'],
  },
  {
    settings: {
      react: {
        version: '19.0',
      },
    },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  react.configs.flat.recommended,
  react.configs.flat['jsx-runtime'],
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'prefer-const': 'warn',
      'no-empty': 'warn',
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/ban-ts-comment': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      'react/prop-types': 'off',
      'react/no-unescaped-entities': 'off',
    },
  },
  prettier,
];
