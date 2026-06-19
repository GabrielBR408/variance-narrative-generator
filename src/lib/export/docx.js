// --- Narrative export — Phase 11 (DOCX) -----------------------------------
// Turns ONE generated narrative (the `result.narrative` object returned by the
// generate flow) into a deterministic, owner-readable Word document. It is the
// DOCX sibling of src/lib/export/markdown.js and reads the exact same narrative
// object, so the Markdown and Word exports can never describe different numbers.
//
// Hard boundaries (Phase 11): browser-only, deterministic, pure. No server-side
// document generation, no storage, no persistence, no network, no AI/LLM. The
// function only re-formats text the narrative engine already produced — it never
// invents a value, re-sums a figure, or emits raw JSON. Source-row traceability
// stays on the narrative object; the owner-facing document does not print it.
//
// Dependency: `docx` (https://www.npmjs.com/package/docx). Chosen because it is
// the de-facto standard for OOXML generation in pure JavaScript, runs in the
// browser (Packer.toBlob) with no server or native bindings, and ships its own
// zip layer — so we add one focused dependency rather than hand-rolling the
// .docx OOXML/zip format. Packer.toBuffer is used only by the Node test suite.
//
// Input shape (from src/lib/narrative/generateNarrative.js):
//   { fileId, fileName, classification, thresholds, periods: [
//       { period, periodLabel, executiveSummary, highVariances, missingData,
//         revenueNotes, expenseNotes, sourceRows }, ... ] }

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel
} from 'docx'

import { OWNER_SECTIONS as SECTIONS, CONTEXT_SECTION } from '../narrative/sectionDefs.js'
import { metaEntries, notesOf } from './exportShared.js'

// Document title. Distinct from the Markdown export's "Variance Narrative"
// heading per the Phase 11 spec, which names the Word document explicitly.
export const DOCX_TITLE = 'Variance Narrative Summary'

const EMPTY_NARRATIVE_NOTE =
  'No comparable variance data was found in the base report, so there is nothing to narrate.'
const EMPTY_SECTION_NOTE = 'None.'

// Header lines: file, classification, thresholds. Each is included only when
// present so the document never asserts a value the narrative did not carry.
function metadataLines(narrative) {
  return metaEntries(narrative).map((m) => `${m.label}: ${m.value}`)
}

// --- intermediate, framework-free block model ------------------------------
// A pure description of the document as an ordered list of typed blocks. This
// is what the test suite asserts against (sections present, Current/YTD order,
// no raw JSON) without unzipping OOXML, and what buildDocxDocument renders into
// docx paragraphs. One source of structure → the two can never drift.
//
// Block kinds: 'title' | 'meta' | 'period' | 'section' | 'bullet' | 'empty'.

function sectionBlocks(period, { key, title }) {
  const blocks = [{ kind: 'section', text: title }]
  const notes = notesOf(period, key)
  if (notes.length === 0) {
    blocks.push({ kind: 'empty', text: EMPTY_SECTION_NOTE })
  } else {
    for (const n of notes) blocks.push({ kind: 'bullet', text: n.text })
  }
  return blocks
}

// Context Notes (NQ-3C) renders after the fixed five, but ONLY when non-empty, so
// a narrative with nothing to re-home produces a byte-identical document.
// (CONTEXT_SECTION is shared.)

function periodBlocks(period) {
  const blocks = [{ kind: 'period', text: period?.periodLabel || 'Current' }]
  for (const section of SECTIONS) blocks.push(...sectionBlocks(period, section))
  if (notesOf(period, CONTEXT_SECTION.key).length > 0) {
    blocks.push(...sectionBlocks(period, CONTEXT_SECTION))
  }
  return blocks
}

// Build the deterministic block list for one narrative. Pure: identical input
// always yields an identical array.
export function narrativeToDocxBlocks(narrative) {
  const blocks = [{ kind: 'title', text: DOCX_TITLE }]

  for (const line of metadataLines(narrative)) {
    blocks.push({ kind: 'meta', text: line })
  }

  const periods = Array.isArray(narrative?.periods) ? narrative.periods : []
  if (periods.length === 0) {
    blocks.push({ kind: 'empty', text: EMPTY_NARRATIVE_NOTE })
    return blocks
  }

  for (const period of periods) blocks.push(...periodBlocks(period))
  return blocks
}

// --- docx rendering --------------------------------------------------------

function blockToParagraph(block) {
  switch (block.kind) {
    case 'title':
      return new Paragraph({ text: block.text, heading: HeadingLevel.TITLE })
    case 'meta':
      return new Paragraph({ children: [new TextRun({ text: block.text, bold: true })] })
    case 'period':
      return new Paragraph({ text: block.text, heading: HeadingLevel.HEADING_1 })
    case 'section':
      return new Paragraph({ text: block.text, heading: HeadingLevel.HEADING_2 })
    case 'bullet':
      return new Paragraph({ text: block.text, bullet: { level: 0 } })
    case 'empty':
    default:
      return new Paragraph({ children: [new TextRun({ text: block.text, italics: true })] })
  }
}

// Build a `docx` Document from one narrative. Deterministic structure; the only
// non-determinism docx adds is internal zip metadata at pack time.
export function buildDocxDocument(narrative) {
  const children = narrativeToDocxBlocks(narrative).map(blockToParagraph)
  return new Document({ sections: [{ children }] })
}

// Browser export: produce a Blob the page can download with no server round
// trip. Async because docx's packer zips asynchronously.
export function narrativeToDocxBlob(narrative) {
  return Packer.toBlob(buildDocxDocument(narrative))
}

// Node-only helper for the test suite — produces the same document as a Buffer
// so tests can assert on a real, valid .docx without a browser.
export function narrativeToDocxBuffer(narrative) {
  return Packer.toBuffer(buildDocxDocument(narrative))
}
