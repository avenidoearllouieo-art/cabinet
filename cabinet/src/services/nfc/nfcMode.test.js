import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveNfcMode } from './nfcMode.js'

test('hardware is the default NFC mode', () => {
  assert.equal(resolveNfcMode(undefined, true), 'hardware')
  assert.equal(resolveNfcMode('', true), 'hardware')
  assert.equal(resolveNfcMode(undefined, false), 'hardware')
})

test('mock mode is opt-in in development and impossible in production', () => {
  assert.equal(resolveNfcMode('mock', true), 'mock')
  assert.equal(resolveNfcMode('MOCK', true), 'mock')
  assert.equal(resolveNfcMode('mock', false), 'hardware')
  assert.equal(resolveNfcMode('hardware', true), 'hardware')
  assert.equal(resolveNfcMode('unknown', true), 'hardware')
})