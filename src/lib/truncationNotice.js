// --- Truncation notice helper --------------------------------------------
// Pure logic for the "some rows were not processed" warning. The extractor caps
// how many rows a file is read to (MAX_ROWS for a flat file, SECTIONED_GL_MAX_ROWS
// for an account-sectioned GL) and records metadata.truncated when a file
// exceeded that cap. Nothing rendered that flag before, so a real variance
// sitting past the cap was silently dropped. This distills the extraction items
// into a list the TruncationNotice component renders prominently.
//
// Presentation-free: returns plain data so it can be unit-tested without React.

// One notice per extraction whose content was capped. Reads the metadata the
// spreadsheet parser records (rowsRead / totalRows / truncated). Items that are
// still pending, failed, or read in full contribute nothing.
export function truncationNotices(items = []) {
  if (!Array.isArray(items)) return []
  const notices = []
  for (const ex of items) {
    const meta = ex && ex.extracted && ex.extracted.metadata
    if (!meta || !meta.truncated) continue
    const rowsRead = Number(meta.rowsRead)
    const totalRows = Number(meta.totalRows)
    if (!Number.isFinite(rowsRead) || !Number.isFinite(totalRows)) continue
    if (totalRows <= rowsRead) continue
    notices.push({
      fileName: ex.fileName || 'This file',
      rowsRead,
      totalRows
    })
  }
  return notices
}
