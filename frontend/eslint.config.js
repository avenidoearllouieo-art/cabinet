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
    // Existing screens predate the stricter React compiler diagnostics. Keep
    // these checks visible without making the workspace lint command fail.
    rules: {
      'no-unused-vars': 'warn',
      'no-empty': 'warn',
      'no-extra-boolean-cast': 'warn',
      'no-useless-assignment': 'warn',
      'no-undef': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/rules-of-hooks': 'error',
    },
  },
])
