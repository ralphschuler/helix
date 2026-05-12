const js = require('@eslint/js');
const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'build/**',
      'coverage/**',
      '**/*.tsbuildinfo',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        sourceType: 'module',
      },
    },
    rules: {
      'no-console': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports' },
      ],
    },
  },
);
