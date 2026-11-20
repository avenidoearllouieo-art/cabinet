import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import process from 'node:process'
import test from 'node:test'
import viteConfig from '../../vite.config.js'

function restoreEnvironment(name, value) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

test('development and preview proxy bridge traffic to the NFC service loopback', async () => {
  const config = await viteConfig({ mode: 'development', command: 'serve' })
  for (const proxyConfig of [config.server.proxy, (await viteConfig({ mode: 'production', command: 'serve' })).preview.proxy]) {
    const bridgeProxy = proxyConfig['/nfc-bridge']
    assert.equal(bridgeProxy.target, 'http://127.0.0.1:5001')
    assert.equal(bridgeProxy.changeOrigin, false)
    assert.equal(bridgeProxy.rewrite('/nfc-bridge/password-reset/handoff'), '/password-reset/handoff')
    assert.equal(bridgeProxy.rewrite('/nfc-bridge/api/scans'), '/api/scans')
  }
})

test('development and preview API proxies forward only the backend key', async () => {
  const previousDeviceKey = process.env.DEVICE_API_KEY
  const previousViteKey = process.env.VITE_DEVICE_API_KEY
  const backendKey = `backend-test-${process.pid}`
  const frontendKey = `frontend-test-${process.pid}`
  process.env.DEVICE_API_KEY = backendKey
  process.env.VITE_DEVICE_API_KEY = frontendKey

  try {
    for (const config of [
      await viteConfig({ mode: 'development', command: 'serve' }),
      await viteConfig({ mode: 'production', command: 'serve' }),
    ]) {
      const apiProxy = (config.server?.proxy || config.preview.proxy)['/api']
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
    }
  } finally {
    restoreEnvironment('DEVICE_API_KEY', previousDeviceKey)
    restoreEnvironment('VITE_DEVICE_API_KEY', previousViteKey)
  }
})

test('production builds leave the development server disabled and use preview proxies', async () => {
  const config = await viteConfig({ mode: 'production', command: 'build' })

  assert.equal(config.server, undefined)
  assert.equal(config.preview.proxy['/nfc-bridge'].target, 'http://127.0.0.1:5001')
  assert.equal(config.preview.proxy['/api'].target, 'http://127.0.0.1:8000')
  assert.equal(config.define, undefined)
})

test('the production Nginx server keeps hardware local and application API on Render', async () => {
  const configUrl = new URL('../../deploy/nginx.conf', import.meta.url)
  const config = await readFile(configUrl, 'utf8')

  assert.ok(config.includes('listen 5177;'))
  assert.ok(config.includes('proxy_pass http://127.0.0.1:5001/;'))
  assert.ok(config.includes('set $django_api_host taptrack-api.onrender.com;'))
  assert.ok(config.includes('proxy_pass https://$django_api_host$request_uri;'))
  assert.ok(config.includes('proxy_next_upstream off;'))
  assert.ok(config.includes('try_files $uri $uri/ /index.html;'))

  const photoStart = config.indexOf('location ~ ^/api/access-logs/')
  const apiStart = config.indexOf('location /api/')
  const photoLocation = config.slice(photoStart, apiStart)
  const apiLocation = config.slice(apiStart)
  assert.ok(photoLocation.includes('limit_except GET'))
  assert.ok(photoLocation.includes('include /run/taptrack-cabinet/cabinet-device-key.conf;'))
  assert.ok(!apiLocation.includes('cabinet-device-key.conf'))
})