import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveNfcMode } from './nfcMode.js'

test('hardware is the default NFC mode', () => {
  assert.equal(resolveNfcMode(undefined), 'hardware')
  assert.equal(resolveNfcMode(''), 'hardware')
})

test('mock mode requires an explicit configuration', () => {
  assert.equal(resolveNfcMode('mock'), 'mock')
  assert.equal(resolveNfcMode('MOCK'), 'mock')
  assert.equal(resolveNfcMode('hardware'), 'hardware')
  assert.equal(resolveNfcMode('unknown'), 'hardware')
})