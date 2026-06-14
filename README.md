# Variance Narrative Generator

## Source of truth

GitHub repository.

## Development

Claude Code.

## Current Phase

Phase 6 complete — File Classification. Each uploaded file is given a best-guess document type and a confidence score using only surface signals (filename, extension, upload role). Classification is deterministic and content-free: files are never opened, parsed, OCR'd, classified by AI, calculated on, persisted, or logged. It is advisory only — it never blocks an upload and is shaped to allow a manual override later.

Phase 5 (still in place) — real file transport (browser → multipart/form-data → backend → in-memory receipt → placeholder response).

Do not reconstruct project from chat history.
