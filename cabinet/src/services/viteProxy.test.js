import assert from 'node:assert/strict'
import test from 'node:test'
import viteConfig from '../../vite.config.js'

function restoreEnvironment(name, value) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

test('development proxy forwards only the backend key', async () => {
  const previousDeviceKey = process.env.DEVICE_API_KEY
  const previousViteKey = process.env.VITE_DEVICE_API_KEY
  const backendKey = `backend-test-${process.pid}`
  const frontendKey = `frontend-test-${process.pid}`
  process.env.DEVICE_API_KEY = backendKey
  process.env.VITE_DEVICE_API_KEY = frontendKey

  try {
    const config = await viteConfig({ mode: 'development', command: 'serve' })
    const apiProxy = config.server.proxy['/api']
    let onProxyRequest
    apiProxy.configure({
      on: (event, callback) => {
        if (event === 'proxyReq') onProxyRequest = callback
      },
    })

    const forwardedHeaders = new Map()
    onProxyRequest({
      setHeader: (name, value) => forwardedHeaders.set(name, value),
    })

    assert.equal(apiProxy.target, 'http://127.0.0.1:8000')
    assert.equal(forwardedHeaders.get('X-API-Key'), backendKey)
    assert.notEqual(forwardedHeaders.get('X-API-Key'), frontendKey)
    assert.equal(config.define, undefined)
  } finally {
    restoreEnvironment('DEVICE_API_KEY', previousDeviceKey)
    restoreEnvironment('VITE_DEVICE_API_KEY', previousViteKey)
  }
})

test('production build does not configure a development API proxy', async () => {
  const config = await viteConfig({ mode: 'production', command: 'build' })

  assert.equal(config.server, undefined)
  assert.equal(config.define, undefined)
})