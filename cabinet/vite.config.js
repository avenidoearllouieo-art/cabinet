import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// https://vite.dev/config/
const cabinetDirectory = fileURLToPath(new URL('.', import.meta.url))
const backendDirectory = fileURLToPath(new URL('../backend', import.meta.url))

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, cabinetDirectory, 'VITE_')
  const backendEnv = loadEnv(mode, backendDirectory, 'DEVICE_API_KEY')
  const apiBaseUrl = env.VITE_DJANGO_API_BASE_URL || '/api'
  let djangoServerUrl = env.VITE_DJANGO_SERVER_URL
  if (!djangoServerUrl && /^https?:\/\//i.test(apiBaseUrl)) {
    djangoServerUrl = new URL(apiBaseUrl).origin
  }
  if (mode === 'development' && !djangoServerUrl) {
    throw new Error('VITE_DJANGO_SERVER_URL must be configured for the Cabinet development proxy.')
  }
  const proxy = mode === 'development' && djangoServerUrl ? {
    '/api': {
      target: djangoServerUrl,
      changeOrigin: true,
      secure: false,
      configure: (proxyServer) => {
        proxyServer.on('proxyReq', (proxyRequest) => {
          const apiKey = backendEnv.DEVICE_API_KEY
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
