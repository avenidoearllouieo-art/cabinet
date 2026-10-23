import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  return {
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
      port: 5177,
      proxy: {
        '/api': {
          target: env.VITE_DJANGO_SERVER_URL || 'http://127.0.0.1:8000',
          changeOrigin: true,
          secure: false,
        },
      },
    },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.jsx'],
    },
  }
})
