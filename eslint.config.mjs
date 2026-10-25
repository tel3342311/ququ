import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default [
  {
    ignores: [
      'dist/**',
      '**/dist/**',
      'helpers/**',
      '**/helpers/**',
      'desktop/**',
      '**/desktop/**',
      'utils/**',
      '**/utils/**',
      'scripts/**',
      '**/scripts/**',
      'vite.config.js',
      '**/vite.config.js',
      'cleanup.js',
      'main.js',
      'preload.js',
      'tailwind.config.js',
      'postcss.config.js',
      'test_*.js',
      '**/*.ts',
    ],
  },
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
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
      ...js.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'no-unused-vars': 'warn',
      'react-hooks/rules-of-hooks': 'warn',
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
];
