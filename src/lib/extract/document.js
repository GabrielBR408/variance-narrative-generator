// --- DOCX parser — Phase 7 ------------------------------------------------
// Extracts paragraph text from a .docx using mammoth's browser build. Plain
// text only: no styling, no formatting, no embedded images, no formulas.
//
// mammoth returns the document as one text blob; we split it into paragraphs
// (blank-line separated) and keep up to maxBlocks so a long document can't
// spike memory. Errors throw a `reason` the orchestrator maps to a message.

import mammoth from 'mammoth/mammoth.browser.js'

function fail(reason, message) {
  return Object.assign(new Error(message || reason), { reason })
}

export async function extractDocument(file, maxBlocks) {
  const arrayBuffer = await file.arrayBuffer()

  let result
  try {
    result = await mammoth.extractRawText({ arrayBuffer })
  } catch {
    // mammoth throws on non-docx / corrupt zip containers.
    throw fail('corrupt')
  }

  const raw = (result && result.value) || ''
  const paragraphs = raw
    .split(/\r?\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  const totalBlocks = paragraphs.length
  const text = paragraphs.slice(0, maxBlocks)

  return {
    text,
    tables: [],
    metadata: {
      paragraphs: totalBlocks,
      paragraphsRead: text.length,
      truncated: totalBlocks > text.length
    }
  }
}
