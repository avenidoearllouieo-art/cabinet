import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchAccessLogPhoto, getDjangoAccessLogEventId, mapPhotoStatus } from './accessLogPhoto.js'

const metadataFor = (eventId, overrides = {}) => ({
  event_id: eventId,
  capture_status: 'success',
  captured_at: '2026-10-09T14:45:00Z',
  diagnostic_error: null,
  image_available: true,
  image_endpoint: `/api/access-logs/${eventId}/photo/image/`,
  ...overrides,
})

test('backend capture statuses map to pending, captured, and unavailable labels', () => {
  assert.deepEqual(mapPhotoStatus('pending', false), { label: 'Pending', state: 'pending' })
  assert.deepEqual(mapPhotoStatus('success', true), { label: 'Captured', state: 'captured' })
  assert.deepEqual(mapPhotoStatus('failed', false), { label: 'Unavailable', state: 'unavailable' })
  assert.deepEqual(mapPhotoStatus(null, false), { label: 'Unavailable', state: 'unavailable' })
  assert.deepEqual(mapPhotoStatus('success', false), { label: 'Unavailable', state: 'unavailable' })
})

test('photo lookups use nested Django event IDs for both station workflows', async () => {
  for (const [station, djangoEventId] of [['Station 1', 81], ['Station 2', 97]]) {
    const scanEvent = {
      event_id: 4,
      station,
      django_response: { event_id: djangoEventId },
    }
    assert.equal(getDjangoAccessLogEventId(scanEvent), djangoEventId)
    assert.equal(getDjangoAccessLogEventId({ event_id: 4 }), null)

    const requested = []
    const result = await fetchAccessLogPhoto(djangoEventId, {
      fetcher: async (url) => {
        requested.push(url)
        return new Response(JSON.stringify(metadataFor(djangoEventId, {
          capture_status: 'pending',
          image_available: false,
          image_endpoint: null,
        })), { status: 200, headers: { 'Content-Type': 'application/json' } })
      },
    })

    assert.equal(result.state, 'pending', station)
    assert.deepEqual(requested, [`/api/access-logs/${djangoEventId}/photo/`])
  }
})

test('captured photo reads authenticated metadata and protected image bytes', async () => {
  const eventId = 123
  const requested = []
  const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' })
  const photo = await fetchAccessLogPhoto(eventId, {
    fetcher: async (url, options) => {
      requested.push({ url, options })
      if (url.endsWith('/image/')) {
        return new Response(jpeg, { status: 200, headers: { 'Content-Type': 'image/jpeg' } })
      }
      return new Response(JSON.stringify(metadataFor(eventId)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    },
  })

  assert.equal(photo.label, 'Captured')
  assert.equal(photo.imageBlob.type, 'image/jpeg')
  assert.equal(requested.length, 2)
  assert.deepEqual(requested.map((request) => request.url), [
    '/api/access-logs/123/photo/',
    '/api/access-logs/123/photo/image/',
  ])
  assert.ok(requested.every(({ options }) => options.credentials === 'same-origin'))
  assert.ok(requested.every(({ options }) => options.cache === 'no-store'))
})

test('missing photos return a placeholder state without requesting image bytes', async () => {
  const photo = await fetchAccessLogPhoto(22, {
    fetcher: async () => new Response(JSON.stringify(metadataFor(22, {
      capture_status: null,
      captured_at: null,
      image_available: false,
      image_endpoint: null,
    })), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  })

  assert.equal(photo.label, 'Unavailable')
  assert.equal(photo.imageBlob, null)
})

test('metadata API errors reject while image retrieval errors map to unavailable', async () => {
  await assert.rejects(
    fetchAccessLogPhoto(31, { fetcher: async () => new Response('', { status: 503 }) }),
    /HTTP 503/,
  )

  const result = await fetchAccessLogPhoto(32, {
    fetcher: async (url) => url.endsWith('/image/')
      ? new Response('unavailable', { status: 503 })
      : new Response(JSON.stringify(metadataFor(32)), { status: 200 }),
  })
  assert.equal(result.state, 'unavailable')
  assert.equal(result.imageBlob, null)
})

test('image endpoint must match the same event and cannot redirect preview off-origin', async () => {
  const requested = []
  const result = await fetchAccessLogPhoto(44, {
    fetcher: async (url) => {
      requested.push(url)
      return new Response(JSON.stringify(metadataFor(44, {
        image_endpoint: 'https://untrusted.example/private-photo.jpg',
      })), { status: 200, headers: { 'Content-Type': 'application/json' } })
    },
  })

  assert.equal(result.label, 'Unavailable')
  assert.equal(result.diagnosticError, 'Photo image endpoint is unavailable.')
  assert.equal(result.imageBlob, null)
  assert.deepEqual(requested, ['/api/access-logs/44/photo/'])
})

test('non-image response from protected image endpoint is rejected', async () => {
  await assert.rejects(fetchAccessLogPhoto(54, {
    fetcher: async (url) => url.endsWith('/image/')
      ? new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
      : new Response(JSON.stringify(metadataFor(54)), { status: 200 }),
  }), /not an image/)
})