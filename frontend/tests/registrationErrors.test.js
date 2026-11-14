import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getRegistrationSubmissionError, getRegistrationValidationError } from '../src/pages/auth/registrationErrors.js'
import { NFC_REGISTRATION_FIELDS } from '../src/pages/auth/registrationForm.js'

test('expired or consumed registration tokens tell the user to tap the card again', () => {
  const message = getRegistrationValidationError({ response: { status: 410 } })

  assert.match(message, /expired or was already used/i)
  assert.match(message, /tap the NFC card again/i)
})

test('network failures are reported as service reachability problems', () => {
  const message = getRegistrationValidationError(new Error('Network Error'))

  assert.match(message, /could not be reached/i)
  assert.match(message, /online/i)
})

test('other API failures include the response status', () => {
  const message = getRegistrationValidationError({ response: { status: 503 } })

  assert.match(message, /HTTP 503/)
})

test('registration credential fields require username, password, and confirmation', () => {
  assert.deepEqual(NFC_REGISTRATION_FIELDS.map(({ label }) => label), ['Username', 'Password', 'Confirm Password'])
  assert.equal(NFC_REGISTRATION_FIELDS[1].type, 'password')
  assert.equal(NFC_REGISTRATION_FIELDS[1].minLength, 8)
  assert.equal(NFC_REGISTRATION_FIELDS[2].type, 'password')
  assert.equal(NFC_REGISTRATION_FIELDS[2].minLength, 8)
})

test('registration submission displays backend field validation messages', () => {
  const message = getRegistrationSubmissionError({ response: { data: { username: ['That username is already in use.'] } } })

  assert.equal(message, 'That username is already in use.')
})

test('registration submission explains network, expired links, and throttled requests', () => {
  assert.match(getRegistrationSubmissionError(new Error('Network Error')), /could not be reached/i)
  assert.match(getRegistrationSubmissionError({ response: { status: 410 } }), /expired/i)
  assert.match(getRegistrationSubmissionError({ response: { status: 429 } }), /too many registration attempts/i)
})