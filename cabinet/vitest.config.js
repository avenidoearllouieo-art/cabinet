import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_NFC_MODE': JSON.stringify('mock'),
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.jsx'],
  },
})