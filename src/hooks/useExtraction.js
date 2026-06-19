import { useState, useEffect, useRef } from 'react'
import { classifyFile } from '../lib/classify.js'
import { extractFile } from '../lib/extract/extract.js'
import { augmentWithOcr } from '../lib/ocr/augment.js'
import { fileKey } from '../lib/fileKey.js'

// Extraction pipeline (Phase 7): classify (Phase 6) → extract → normalize →
// preview. Owns the in-memory extraction map (fileKey → extraction result; in
// memory only, discarded with the session, never persisted) and re-runs whenever
// the uploaded files change. Each file is opened at most once; removed files are
// pruned so their content is released. Extracted verbatim from App() — returns
// the `extractions` map so App can read it and pass it where needed.
export function useExtraction({ baseReport, supportingFiles }) {
  const [extractions, setExtractions] = useState({})
  const startedRef = useRef(new Set()) // keys already sent to the extractor

  useEffect(() => {
    const current = []
    if (baseReport) current.push({ file: baseReport, role: 'baseReport' })
    supportingFiles.forEach((f) => current.push({ file: f, role: 'supportingFile' }))
    const keys = new Set(current.map(({ file }) => fileKey(file)))

    // Drop extractions for files that are no longer present.
    setExtractions((prev) => {
      let changed = false
      const next = {}
      for (const k of Object.keys(prev)) {
        if (keys.has(k)) next[k] = prev[k]
        else changed = true
      }
      return changed ? next : prev
    })
    for (const k of [...startedRef.current]) if (!keys.has(k)) startedRef.current.delete(k)

    // Kick off extraction for any newly added file.
    current.forEach(({ file, role }) => {
      const id = fileKey(file)
      if (startedRef.current.has(id)) return
      startedRef.current.add(id)

      const classification = classifyFile({ name: file.name, role })
      setExtractions((prev) => ({
        ...prev,
        [id]: { fileId: id, fileName: file.name, classification, status: 'pending' }
      }))

      extractFile({ file, fileId: id, classification })
        // OCR fallback: a SCANNED supporting PDF (image-only, no text layer) is
        // rendered and read by Claude vision into the same GL table the
        // text/position parsers emit. A no-op for every other file, and on any
        // failure the original (empty) extraction is kept — nothing surfaced.
        .then((res) => augmentWithOcr(res, file, { role }))
        .then((res) => setExtractions((prev) => (id in prev ? { ...prev, [id]: res } : prev)))
        .catch(() =>
          setExtractions((prev) =>
            id in prev
              ? {
                  ...prev,
                  [id]: { fileId: id, fileName: file.name, classification, status: 'error', message: 'Something went wrong while reading this file.', confidence: 0 }
                }
              : prev
          )
        )
    })
  }, [baseReport, supportingFiles])

  return extractions
}
