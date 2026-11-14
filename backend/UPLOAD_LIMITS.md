# TapTrack Upload Limits

The API validates both filename extension and file content before writing an upload to storage.

| Category | Maximum per file | Formats |
| --- | ---: | --- |
| Video | 500 MB | MP4, MOV, WebM |
| Image | 20 MB | JPG, JPEG, PNG, WebP |
| Document | 25 MB | PDF, DOCX, PPTX, XLSX |
| Audio | 50 MB | MP3, WAV |

A student submission may contain at most 5 files and 750 MB combined. These total limits apply to retained attachments plus newly submitted files. No video-duration limit is enforced.

## Server requirements

Django stores uploaded files larger than 2 MiB in its upload temp directory rather than process memory. The default is the operating system temp directory. Set `DJANGO_FILE_UPLOAD_TEMP_DIR` to a writable, monitored disk location if the default temp volume is too small; allow at least 750 MiB per concurrent maximum-size submission, plus headroom for multipart overhead and concurrent requests.

`DJANGO_FILE_UPLOAD_MAX_MEMORY_SIZE` can override the 2 MiB in-memory threshold. Keep it low in production. Do not raise `DATA_UPLOAD_MAX_MEMORY_SIZE` to accommodate files: Django's multipart upload handlers stream file parts separately, and the file policy checks sizes before persistent storage.

The reverse proxy and application server must also accept the request body and allow enough time for slow uploads. For Nginx, configure the site/server block with:

```nginx
client_max_body_size 800m;
client_body_timeout 600s;
proxy_send_timeout 600s;
proxy_read_timeout 600s;
```

Configure the WSGI/ASGI host with an equivalent request-body ceiling and timeout. Some managed hosts impose a lower hard request limit; if so, the 750 MB submission limit cannot be reached through that host without a resumable/chunked upload service.

Uploads remain private in configured Django storage. Do not expose `MEDIA_ROOT` paths publicly; authorized preview and download requests use the existing protected file endpoints.
