import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      checks: {
        // Build time varies significantly across developer machines and CI.
        // Keep actionable compilation checks enabled while omitting timing noise.
        pluginTimings: false,
      },
    },
  },
  server: {
    host: true,
    port: 5176,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
})
