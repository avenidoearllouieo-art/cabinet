import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  const backendEnv = loadEnv(mode, '../backend', '')
  const djangoServerUrl = env.VITE_DJANGO_SERVER_URL
  const apiBaseUrl = env.VITE_DJANGO_API_BASE_URL || '/api'
  if (mode === 'development' && apiBaseUrl === '/api' && !djangoServerUrl) {
    throw new Error('VITE_DJANGO_SERVER_URL must be configured for the Cabinet development proxy.')
  }
  const proxy = djangoServerUrl ? {
    '/api': {
      target: djangoServerUrl,
      changeOrigin: true,
      secure: false,
      configure: (proxyServer) => {
        proxyServer.on('proxyReq', (proxyRequest) => {
          const apiKey = env.DEVICE_API_KEY || env.VITE_DJANGO_API_KEY || backendEnv.DEVICE_API_KEY
          if (apiKey) proxyRequest.setHeader('X-API-Key', apiKey)
        })
      },
    },
  } : undefined
  return {
    plugins: [react()],
    ...(proxy ? { server: { proxy } } : {}),
  }
})
