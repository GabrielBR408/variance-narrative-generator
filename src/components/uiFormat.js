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
