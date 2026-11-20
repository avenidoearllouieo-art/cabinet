# TapTrack Upload Limits

The API validates both filename extension and file content before writing an upload to storage. Direct student video uploads use Tigris multipart; the video bytes do not pass through Render.

| Category | Maximum per file | Formats |
| --- | ---: | --- |
| Video attachment sent through Django | 500 MB | MP4, MOV, WebM |
| Student video sent directly to Tigris | 5 GiB | MP4, MOV, WebM |
| Image | 20 MB | JPG, JPEG, PNG, WebP |
| Document | 25 MB | PDF, DOCX, PPTX, XLSX |
| Audio | 50 MB | MP3, WAV |

A student submission may contain at most 5 files and 10 GiB combined. These total limits apply to retained attachments, completed drafts, and active multipart sessions. The default Tigris part size is 32 MiB (multipart non-final parts must be at least 5 MiB). No video-duration limit is enforced.

## Server requirements

Django stores ordinary uploads larger than 2 MiB in its upload temp directory rather than process memory. The default is the operating system temp directory. Set `DJANGO_FILE_UPLOAD_TEMP_DIR` to a writable location with capacity for the small uploads proxied through Django. Large student videos use browser-to-Tigris multipart parts and do not consume Render request-body disk.

`DJANGO_FILE_UPLOAD_MAX_MEMORY_SIZE` can override the 2 MiB in-memory threshold. Keep it low in production. Do not raise `DATA_UPLOAD_MAX_MEMORY_SIZE` to accommodate files: Django's multipart upload handlers stream file parts separately, and the file policy checks sizes before persistent storage.

The reverse proxy and application server must accept ordinary multipart request bodies. Large video size does not require raising Render or Django request limits because those bytes go directly to Tigris. For a self-managed Nginx deployment, configure small/ordinary multipart requests with:

```nginx
client_max_body_size 800m;
client_body_timeout 600s;
proxy_send_timeout 600s;
proxy_read_timeout 600s;
```

Configure the WSGI/ASGI host with an equivalent request-body ceiling and timeout for ordinary uploads. The student video upload session is capped by `TAPTRACK_MAX_STUDENT_VIDEO_BYTES` and the aggregate submission cap by `TAPTRACK_MAX_STUDENT_SUBMISSION_BYTES`.

Uploads remain private in configured Django storage. Do not expose `MEDIA_ROOT` paths publicly. Django authenticates and authorizes multipart sessions, and only issues short-lived presigned part URLs for a server-generated key. Completed parts are verified against Tigris before a `TemporaryUpload` row is created. Preview and download URLs are also short-lived and issued only after role/ownership authorization.

Run `python backend/manage.py cleanup_tigris_multipart_uploads --dry-run` to inspect stale sessions, then schedule `python backend/manage.py cleanup_tigris_multipart_uploads` at least daily using an existing operations scheduler. Tigris documents `ListMultipartUploads` and `AbortMultipartUpload` for cleanup; no public access is needed.
