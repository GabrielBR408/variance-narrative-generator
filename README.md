# Variance Narrative Generator

A browser-first tool that turns variance reports and their supporting files into
plain-language variance narratives — a deterministic core, with optional AI
enrichment the user is told about in-app, exports (Copy / Markdown / DOCX /
Excel), and no uploaded-file persistence.

## Source of truth

GitHub repository. Do not reconstruct project state from chat history.

## Development

Claude Code.

## Status

- **Browser-first** — the workflow runs in the browser; the Node backend only
  receives uploads and returns results.
- **PWA** — installable, with a generated service worker (via `vite-plugin-pwa`).
- **Deterministic core** — the baseline narratives are produced by rule-based
  templates and logic, so the same inputs always yield the same output.
- **Optional AI enrichment** — cited commentary and OCR for scanned PDFs use
  the Anthropic API (`server/llm.js`, `server/ocr.js`); the user is told
  before any data is sent via the in-app disclosure modals, and the app falls
  back to the deterministic narrative when the AI is unavailable.
- **Export** — a successful generation offers Copy Narrative plus Markdown,
  DOCX, and Excel downloads, all rendered in the browser.
- **No uploaded-file persistence** — uploaded files and all derived data live
  in memory for the session only; nothing the user uploads is saved. Anonymous
  usage analytics and user-submitted feedback ARE stored (Supabase, via
  `src/lib/track.js`).
- **No auth** — there is no login or user accounts.
- **CI enabled** — every push and pull request runs tests and the build.

## Architecture

The processing pipeline moves an uploaded report through these stages:

```
Upload
  → Classification
    → Extraction
      → PDF Reconstruction
        → Normalization
          → Variance
            → Narrative
              → Export
```

- **Upload** — files enter via the browser and stream to the backend as
  multipart/form-data; bytes are counted and discarded, never stored.
- **Classification** — each file gets a best-guess document type and confidence
  from surface signals only (filename, extension, role); content-free and
  advisory.
- **Extraction** — files are opened in the browser: PDFs yield text (no OCR),
  spreadsheets (XLSX/XLS/CSV) yield rows and columns, DOCX yields paragraphs.
- **PDF Reconstruction** — tabular PDFs are reconstructed into rows/columns by
  ordering line items spatially, with Current/YTD comparison support.
- **Normalization** — every extraction is reshaped into one consistent in-memory
  form (`{ rows, columns, accounts, dates, values }`) with an extraction
  confidence.
- **Variance** — normalized data is analyzed: column detection, row alignment,
  variance calculation, and threshold logic (a line is flagged when it crosses
  either the dollar **or** the percent threshold).
- **Narrative** — significant variances are turned into plain-language narrative
  sections by deterministic templates and formatters.
- **Export** — browser-only. A successful generation offers Copy Narrative,
  Download Markdown, and Download DOCX; all three render the same deterministic
  narrative locally with no server, storage, or AI involved.

### Code map

- `src/App.jsx`, `src/components/` — UI shell, settings panels, previews, and
  result rendering.
- `src/lib/classify.js` — file classification.
- `src/lib/extract/` — extraction + normalization (`extract.js` orchestrator,
  `pdf.js`, `pdfTable.js`, `spreadsheet.js`, `document.js`, `normalize.js`).
- `src/lib/variance/` — variance engine (`detectColumns.js`, `alignRows.js`,
  `calculate.js`, `thresholds.js`, `summarize.js`, `index.js`).
- `src/lib/narrative/` — deterministic narrative engine (`templates.js`,
  `sections.js`, `formatters.js`, `generateNarrative.js`, `index.js`).
- `src/lib/export/` — browser-only export layer (`markdown.js`, `docx.js`,
  `exportState.js`); `src/components/ExportActions.jsx` renders the buttons.
- `server/generate.js` — backend `/generate` upload handler.
- `test/`, `tests/` — Node test-runner suites for variance, narrative, and PDF
  table reconstruction.
- `.github/workflows/ci.yml` — CI workflow.

## Completed phases

- **Phase 1 — Shell** — application skeleton.
- **Phase 2 — UI** — interface and settings panels.
- **Phase 3 — Upload + Generate plumbing** — wiring between upload, settings,
  and the generate action.
- **Phase 4 — Narrative orchestration shell** — placeholder generation flow.
- **Phase 5 — Transport** — real file transport (browser → multipart/form-data
  → backend → in-memory receipt → response).
- **Phase 6 — Classification** — deterministic, content-free document typing.
- **Phase 7 — Extraction + Normalization** — read file content into one
  consistent in-memory shape.
- **Phase 7.1 — PDF Table Reconstruction** — reconstruct PDF tables and support
  Current/YTD comparisons.
- **Phase 8 — Variance Engine** — column detection, row alignment, variance
  calculation, and thresholds.
- **Phase 9A — Deterministic Narrative Engine** — rule-based narrative
  generation from variance results.
- **Phase 10A — Export (Copy + Markdown)** — deterministic, browser-only Copy
  Narrative and Download Markdown actions.
- **Phase 11 — DOCX Export** — additive, browser-only Download DOCX (via the
  `docx` package) using the same generated narrative; Markdown export remains.
- **CI foundation enabled** — GitHub Actions runs `node --test` and
  `npm run build` on every push and pull request (Node 20).

## Scripts

```
npm install      # install dependencies
npm run dev      # start the Vite dev server
npm run build    # production build (also generates the PWA service worker)
npm run preview  # preview the production build
npm test         # run the test suite (node --test)
```

## Not yet implemented

Uploaded-file persistence and authentication are deliberately out of scope at
this stage. Export is browser-only (Copy / Markdown / DOCX / Excel) with no
server-side document generation or storage.
