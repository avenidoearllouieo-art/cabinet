# NFC Access Photo API

Phase 1 adds optional photos to existing `AccessLog` records. An access log remains valid when no photo record exists, and a camera error never changes the NFC access result.

## Read Photo Status and Image

`GET /api/access-logs/{event_id}/photo/`

Authenticate with the Cabinet device's existing `X-API-Key`, or with a Django JWT (`Authorization: Bearer <token>`). Device keys can read only events for their mapped cabinet. JWT users follow access-log scope: students can read their own events, instructors can read events for students in their assigned sections, and administrators can read all events. Student responses are status-only: capture status is returned, while image availability, diagnostics, image endpoint, and image bytes are withheld. A Student request for their own image endpoint returns `403`; another student's event ID returns `404`.

```json
{
  "event_id": 123,
  "capture_status": "success",
  "captured_at": "2026-10-09T14:45:00Z",
  "diagnostic_error": null,
  "image_available": true,
  "image_endpoint": "/api/access-logs/123/photo/image/"
}
```

`capture_status` is the stored value `pending`, `success`, or `failed`; it is `null` when no capture record exists. The Cabinet and authorized staff map these to Pending, Captured, and Unavailable. For non-Student readers, `image_endpoint` is null unless the stored file exists. It is a protected API route, not a public media URL.

`GET /api/access-logs/{event_id}/photo/image/` streams JPEG bytes and requires the same device key or JWT authorization. It returns `404` when no image file is available. Responses are private/no-store. Never use the Admin staff-session image route or a `/media/` path from Cabinet.

## Upload a Photo

`POST /api/access-logs/{event_id}/photo/`

Authenticate with the existing Cabinet device key in the `X-API-Key` header. The key must map to an active `TAPTRACK_NFC_DEVICE_MAP` entry. Send `multipart/form-data` with one `image` field containing a JPEG; uploads are limited to 5 MB and 20 megapixels. The server validates the JPEG content and stores it under a generated filename in Django media storage. Client-supplied station and student identifiers are ignored; the event, station, student, and cabinet come from the existing `AccessLog`.

Success (`201`):

```json
{
  "success": true,
  "event_id": 123,
  "capture_status": "success",
  "captured_at": "2026-10-09T14:45:00Z"
}
```

Missing or invalid credentials return `403`; a missing event or event recorded for another cabinet returns `404`; missing/invalid JPEG data returns `400`; an oversized upload returns `413`; and a second upload for an event that already has an image returns `409`.

## Report Camera Status

`POST /api/access-logs/{event_id}/photo-status/`

Use the same `X-API-Key` authentication and send `application/json` with `status` set to `pending` or `failed`. An optional `error` string (maximum 1000 characters) records a diagnostic. The event must belong to the authenticated device's cabinet. Reporting a failure only updates photo metadata; it does not alter the NFC access result.

```json
{
  "status": "failed",
  "error": "Camera did not respond"
}
```

The response contains `success`, `event_id`, `capture_status`, `captured_at`, and `error`. `captured_at` is set when a failed capture is reported or a JPEG is uploaded; it is null while pending. A later JPEG upload can complete a pending or failed capture, but cannot replace an already uploaded image.

## Privacy and Retention

Photo files use Django's configured `MEDIA_ROOT` storage and a server-generated `.jpg` filename in `access-log-photos/`. The development media route explicitly denies this directory. Images are served only by the authenticated photo image API or the staff-authorized Django Admin route, and responses are marked private/no-store; neither endpoint exposes a public media URL. Device keys are scoped to their mapped cabinet, students to their own logs, instructors to students in assigned sections, and administrators to all logs. Deleting an access log cascades to its photo metadata and removes the stored image. Retain or delete access logs and their associated photos according to the institution's access-log retention schedule; database backups and media backups should follow the same schedule.

Apply the schema with `python manage.py migrate` from `backend/`.