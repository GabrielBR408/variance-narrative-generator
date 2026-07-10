// --- Shared UI formatting helpers ------------------------------------------
// Small presentation utilities shared across components so the same value never
// renders two slightly different ways.

// Human-readable byte size: "512 B", "1.4 KB", "2.3 MB". Returns '—' for a
// non-number (defensive — real File.size is always a number).
export function prettySize(bytes) {
  if (typeof bytes !== 'number') return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Human-readable file type. Users were shown the raw MIME string
// ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") —
// this maps the types the app accepts to plain names, falls back to the
// file extension uppercased, and to 'File' when there is neither.
// Exported for reuse: ResultPanel's received-file metadata shows the same raw
// MIME and should adopt this helper (that file is owned elsewhere).
const MIME_TYPE_LABELS = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel spreadsheet',
  'application/vnd.ms-excel': 'Excel spreadsheet',
  'text/csv': 'CSV',
  'application/csv': 'CSV',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word document',
  'application/msword': 'Word document'
}

export function friendlyFileType(mime, name) {
  const m = typeof mime === 'string' ? mime.split(';')[0].trim().toLowerCase() : ''
  if (MIME_TYPE_LABELS[m]) return MIME_TYPE_LABELS[m]
  const n = typeof name === 'string' ? name : ''
  const dot = n.lastIndexOf('.')
  const ext = dot > 0 && dot < n.length - 1 ? n.slice(dot + 1) : ''
  // Extension fallback goes through the same map keys' spirit: known office
  // extensions get their plain names, anything else is just the extension.
  const byExt = { pdf: 'PDF', xlsx: 'Excel spreadsheet', xls: 'Excel spreadsheet', csv: 'CSV', docx: 'Word document', doc: 'Word document' }
  if (byExt[ext.toLowerCase()]) return byExt[ext.toLowerCase()]
  return ext ? ext.toUpperCase() : 'File'
}
