import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveNfcMode } from './nfcMode.js'

test('hardware is the only supported NFC mode', () => {
  assert.equal(resolveNfcMode(undefined), 'hardware')
  assert.equal(resolveNfcMode(''), 'hardware')
  assert.equal(resolveNfcMode('hardware'), 'hardware')
})

test('mock and unknown modes fail clearly', () => {
  assert.throws(() => resolveNfcMode('mock'), /Only hardware mode is supported/)
  assert.throws(() => resolveNfcMode('unknown'), /Only hardware mode is supported/)
})