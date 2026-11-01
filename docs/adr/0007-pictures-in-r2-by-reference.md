# 0007. Pictures live in R2, notes keep a media reference

Date: 2026-11-01
Status: Accepted

## Context
Pictures were stored as base64 inside notes: capped near 400 KB, copied into every sync row, and for pictures dropped into the rich-text editor a temporary link that did not survive a reload. The spec asked for R2.

## Decision
A picture is shrunk to WebP in the browser, hashed (SHA-256), saved in IndexedDB and referenced from the note as `media:<sha256>`. A background job uploads it straight to a private R2 bucket with a short-lived presigned PUT, and the server confirms the object (HEAD, size check) before recording it in `media_objects`. Reads ask the server for a presigned GET after an ownership check; the device keeps the downloaded copy, so everything works offline. Keys are `u/<user>/<sha256>`, so one account stores a picture once and cannot name another account's. Presigning is our own SigV4 (about 50 lines, checked against Amazon's published example) instead of the AWS SDK. When R2 is not configured, or nobody is signed in, pictures stay inline as before and are moved out later. MCP sends stored pictures back as a link, and keeps `image_url` as a plain link without downloading it.

## Consequences
Notes stay small and sync fast; pictures are unlimited by the old 400 KB cap (15 MB each, 200 MB per account). A picture is only visible on another device once its upload finished (the viewer retries a few times). Deleting a note does not delete its picture; a cleanup job is a later task. The bucket needs a CORS rule, documented in the dev guide.
