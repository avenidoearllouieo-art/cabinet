import assert from 'node:assert/strict'
import test from 'node:test'
import { createNfcProvider } from './nfcProvider.js'
import { HardwareNfcProvider } from './hardwareNfcProvider.js'
import { MockNfcProvider } from './__fixtures__/mockNfcProvider.js'

test('mock provider remains an isolated test fixture, not a production provider option', () => {
  assert.ok(new MockNfcProvider())
  assert.throws(() => createNfcProvider({ mode: 'mock' }), /Only hardware mode is supported/)
  assert.throws(() => createNfcProvider({ mode: undefined }), /Only hardware mode is supported/)
  assert.throws(() => createNfcProvider({ mode: 'unknown' }), /Only hardware mode is supported/)
})

test('hardware mode requires the configured service URL', () => {
  assert.throws(() => createNfcProvider({ mode: 'hardware' }), /VITE_NFC_SERVICE_URL is required/)
  assert.ok(createNfcProvider({ mode: 'hardware', serviceUrl: 'http://127.0.0.1:5001' }) instanceof HardwareNfcProvider)
})