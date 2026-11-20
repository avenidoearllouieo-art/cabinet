import { describe, expect, it } from 'vitest'
import { uploadErrorMessages } from './uploadPolicy.js'

describe('uploadErrorMessages', () => {
  it('replaces HTML server errors with the caller fallback', () => {
    const error = {
      response: {
        status: 500,
        headers: { 'content-type': 'text/html' },
        data: '<!doctype html><title>Server Error (500)</title>',
      },
    }

    expect(uploadErrorMessages(error, 'Upload failed. Please try again.'))
      .toEqual(['Upload failed. Please try again.'])
  })

  it('uses a sign-in message for expired sessions', () => {
    expect(uploadErrorMessages({ response: { status: 401 } }, 'Fallback'))
      .toEqual(['Your session has expired. Please sign in again.'])
  })

  it('uses a storage connection message for gateway and service failures', () => {
    for (const status of [502, 503, 504]) {
      expect(uploadErrorMessages({ response: { status } }, 'Fallback'))
        .toEqual(['Unable to connect to file storage. Please retry.'])
    }
  })

  it('keeps safe structured validation messages', () => {
    expect(uploadErrorMessages({ response: { status: 400, data: { files: ['Invalid video type.'] } } }, 'Fallback'))
      .toEqual(['Invalid video type.'])
  })
})