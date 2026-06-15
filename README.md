# Variance Narrative Generator

## Source of truth

GitHub repository.

## Development

Claude Code.

## Current Phase

Phase 7 complete — Extraction + Normalization. Uploaded files are opened in the browser and their content is read into one consistent in-memory shape, ready for future variance work. PDFs yield text (no OCR), spreadsheets (XLSX/XLS/CSV) yield rows and columns, and DOCX files yield paragraphs. Each result is normalized to `{ rows, columns, accounts, dates, values }` with an extraction confidence, and shown in a collapsed, capped preview. Phase 7 stops at extraction: no variance calculations, threshold logic, narratives, model calls, recommendations, export, or persistence. Extracted content lives in memory for the session only — it is never saved, sent, or logged. Unsupported files show "extraction unavailable".

Extraction layer lives in `src/lib/extract/` (`extract.js` orchestrator, `pdf.js`, `spreadsheet.js`, `document.js`, `normalize.js`); the preview UI is `src/components/ExtractionPreview.jsx`. Parser logic is isolated from the UI.

Phase 6 (still in place) — File Classification. Each uploaded file is given a best-guess document type and a confidence score using only surface signals (filename, extension, upload role). Classification is deterministic and content-free, advisory only, and feeds the Phase 7 pipeline.

Phase 5 (still in place) — real file transport (browser → multipart/form-data → backend → in-memory receipt → placeholder response).

Do not reconstruct project from chat history.
