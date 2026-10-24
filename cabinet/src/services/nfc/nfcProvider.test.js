import assert from 'node:assert/strict'
import test from 'node:test'
import { createNfcProvider } from './nfcProvider.js'
import { HardwareNfcProvider } from './hardwareNfcProvider.js'
import { MockNfcProvider } from './mockNfcProvider.js'

test('only explicit mock mode creates the mock NFC provider', () => {
  assert.ok(createNfcProvider({ mode: 'mock' }) instanceof MockNfcProvider)
  assert.throws(() => createNfcProvider({ mode: undefined }), /explicitly set/)
  assert.throws(() => createNfcProvider({ mode: 'unknown' }), /explicitly set/)
})

test('hardware mode requires the configured service URL', () => {
  assert.throws(() => createNfcProvider({ mode: 'hardware' }), /VITE_NFC_SERVICE_URL is required/)
  assert.ok(createNfcProvider({ mode: 'hardware', serviceUrl: 'http://127.0.0.1:5001' }) instanceof HardwareNfcProvider)
})