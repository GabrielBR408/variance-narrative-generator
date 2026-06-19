// --- PDF line grouping & report detection — shared primitives -------------
// The position-aware line grouping and the variance-report signature check are
// needed by BOTH the variance reconstructor (pdfTable.js) and the General Ledger
// reconstructors (pdfGL.js). They live here, in a dependency-free module, so the
// two reconstructors can share them without importing each other (which would be
// a cycle). pdfTable.js re-exports the public ones, so every existing import of
// pdfTable.js keeps working unchanged.
//
// DETERMINISTIC only — no OCR, no AI/ML, no persistence.

// Bound how many data rows any reconstructor emits so a large document can't
// spike memory. Not a storage limit — nothing is ever stored.
export const MAX_TABLE_ROWS = 500

// Header / metadata signatures used only to decide whether a PDF *looks like* a
// variance report. Detection never changes how a row is parsed.
const HEADER_HINTS = [
  /\bactual\b/i,
  /\bbudget\b/i,
  /\bvariance\b/i,
  /year[\s-]*to[\s-]*date|\bytd\b/i
]

// Horizontal position of a pdf.js text item (transform[4] = x translation).
// Items without a usable transform sort to the far left so they keep their
// relative arrival order via the stable sort.
function itemX(item) {
  const t = item && item.transform
  return Array.isArray(t) && t.length >= 5 && Number.isFinite(t[4]) ? t[4] : -Infinity
}

// Group pdf.js text items into visual lines, KEEPING each cell's horizontal
// position: returns an array of lines, each an array of { str, x } sorted
// left-to-right. This is the position-aware counterpart of groupItemsIntoLines,
// added in Phase 18A so the GL reconstructor can assign numeric cells to the
// Debit / Credit / Balance columns by their x-band (a blank debit or credit
// cell collapses the token count, so order alone is not enough).
//
// Why order matters: pdf.js returns text items in content-stream order, which
// for a report's right-aligned numeric columns is not guaranteed to be visual
// left-to-right — two adjacent cells (e.g. Current Budget and Current Variance)
// can arrive swapped. The downstream row parser maps cells strictly by their
// position in the line, so sorting by x makes every line read left-to-right. The
// sort is stable, so already-ordered lines (the common case) are unchanged.
export function groupItemsIntoLineCells(items = []) {
  const lines = []
  let current = []

  const flush = () => {
    if (current.length === 0) return
    const cells = current
      .slice()
      .sort((a, b) => itemX(a) - itemX(b))
      .map((it) => ({ str: it && typeof it.str === 'string' ? it.str : '', x: itemX(it) }))
      .filter((c) => c.str)
    if (cells.length) lines.push(cells)
    current = []
  }

  for (const item of Array.isArray(items) ? items : []) {
    const str = item && typeof item.str === 'string' ? item.str : ''
    if (str) current.push(item)
    if (item && item.hasEOL) flush()
  }
  flush()

  return lines
}

// Collapse position-aware line cells into a single normalized line string
// (whitespace collapsed, trimmed). Shared so the string and cell views always
// derive from the same grouping.
export function cellsToLine(cells) {
  return cells
    .map((c) => c.str)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Group pdf.js text items into normalized visual line STRINGS (the shape the
// variance reconstructor and the report-signature detection consume). Derived
// from groupItemsIntoLineCells so the two views can never drift.
export function groupItemsIntoLines(items = []) {
  return groupItemsIntoLineCells(items)
    .map(cellsToLine)
    .filter(Boolean)
}

// True when the text body carries the signatures of a variance report header.
export function detectVarianceReport(lines = []) {
  const blob = lines.join(' \n ')
  return HEADER_HINTS.every((re) => re.test(blob))
}
