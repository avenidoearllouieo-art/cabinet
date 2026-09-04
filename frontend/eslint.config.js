import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'served_users.jsx', 'users-module.js']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      'no-unused-vars': 'error',
      'no-empty': 'error',
      'no-extra-boolean-cast': 'error',
      'no-useless-assignment': 'error',
      'no-undef': 'error',
      'react-hooks/immutability': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'react-hooks/set-state-in-effect': 'error',
      'react-hooks/refs': 'error',
      'react-hooks/purity': 'error',
      'react-hooks/rules-of-hooks': 'error',
    },
  },
])
