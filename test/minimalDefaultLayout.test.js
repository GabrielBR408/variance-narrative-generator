// Minimal-default-layout tests.
//
// WHY THIS EXISTS: this phase moved every control/note/preview except the upload
// area + Generate into one collapsed "Settings & instructions" disclosure. These
// tests render the ACTUAL components (via react-dom/server) the same way
// renderEnrichmentStatus.test.js does — JSX is bundled with esbuild into a temp
// ESM module — so a regression where the panel stops collapsing, a control stops
// rendering, or a relocated element leaks back into the default view fails CI.
//
// Static markup can't fire DOM events, so:
//   • collapse/expand is proven by the conditional render (children present only
//     when open) and the aria-expanded attribute,
//   • control bindings are proven by rendering with a known state object and
//     asserting the rendered control reflects it (value/checked), which is the
//     static-render equivalent of "this control reads the same state it did
//     before". The control sources themselves are untouched by this phase.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { writeFile, unlink } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'

import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as esbuild from 'esbuild'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..')

function appSrc() {
  return readFileSync(join(repoRoot, 'src/App.jsx'), 'utf8')
}

// Bundle a real .jsx component (and its local import graph) into a temp ESM
// module, import it, and return its exports. npm deps stay external so the same
// React instance is used. (Identical to renderEnrichmentStatus.test.js.)
async function loadComponent(relPath) {
  const entry = join(repoRoot, relPath)
  const res = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    jsx: 'automatic',
    logLevel: 'silent',
    external: ['react', 'react-dom', 'react-dom/server', 'docx', 'exceljs', 'mammoth', 'xlsx', 'pdfjs-dist', '@anthropic-ai/sdk']
  })
  const tmp = join(repoRoot, `.render-test-${randomBytes(6).toString('hex')}.mjs`)
  await writeFile(tmp, res.outputFiles[0].text, 'utf8')
  try {
    return await import(pathToFileURL(tmp).href)
  } finally {
    await unlink(tmp).catch(() => {})
  }
}

const DEFAULT_STYLE = {
  reportStyle: 'Detailed',
  tone: 'Neutral',
  length: 'Standard',
  abbreviateDollars: false,
  dollarReferences: 'Detail'
}
const DEFAULT_VARIANCE = {
  dollarThreshold: '1000',
  percentThreshold: '10',
  include: { glResearch: true, suggestedCauses: true, questions: true, priorComparison: true },
  ignore: { zeroVariances: true, smallRepeatItems: true }
}

// --- 1. The disclosure: collapsed by default, expands on demand -------------

test('SettingsPanel is collapsed by default — trigger present, contents not rendered', async () => {
  const { default: SettingsPanel } = await loadComponent('src/components/SettingsPanel.jsx')
  const html = renderToStaticMarkup(
    React.createElement(SettingsPanel, null, React.createElement('div', null, 'RELOCATED_CONTENT'))
  )
  // A real, keyboard-reachable disclosure trigger with aria-expanded=false.
  assert.match(html, /<button[^>]*aria-expanded="false"/)
  assert.match(html, /Settings &amp; instructions/)
  // Collapsed → the children are not in the DOM at all.
  assert.doesNotMatch(html, /RELOCATED_CONTENT/)
})

test('SettingsPanel reveals its contents when expanded (aria-expanded=true)', async () => {
  const { default: SettingsPanel } = await loadComponent('src/components/SettingsPanel.jsx')
  const html = renderToStaticMarkup(
    React.createElement(SettingsPanel, { defaultOpen: true }, React.createElement('div', null, 'RELOCATED_CONTENT'))
  )
  assert.match(html, /<button[^>]*aria-expanded="true"/)
  assert.match(html, /RELOCATED_CONTENT/)
  // The expanded body is exposed as a labelled region wired to the trigger.
  assert.match(html, /aria-controls="/)
  assert.match(html, /role="region"/)
})

// --- 2. Default view shows ONLY the upload area + confirmation --------------

test('SourceFiles renders only the upload area + file confirmation', async () => {
  const { default: SourceFiles } = await loadComponent('src/components/SourceFiles.jsx')
  const noop = () => {}
  const baseReport = { name: 'income-statement.xlsx', size: 2048 }
  const html = renderToStaticMarkup(
    React.createElement(SourceFiles, {
      baseReport,
      setBaseReport: noop,
      supportingFiles: [],
      setSupportingFiles: noop
    })
  )
  // Stays: upload caption, dropzone text, and the uploaded-file confirmation.
  assert.match(html, /Upload your files/)
  assert.match(html, /Drag &amp; drop files here/)
  assert.match(html, /income-statement\.xlsx/)
  // Part B: the short default-view upload-guidance line is present near the
  // dropzone (visible without opening the Settings & instructions panel).
  assert.match(html, /Upload a variance report, plus a year-to-date GL and detailed budget\./)
  assert.match(html, /the variance commentary will be more limited\./)
  // Moved out: the upload note, the "What can I add here?" helper, and the
  // preview cards must no longer live in the upload area.
  assert.doesNotMatch(html, /comparative income statement/)
  assert.doesNotMatch(html, /What can I add here\?/)
  assert.doesNotMatch(html, /Extraction Preview/)
  assert.doesNotMatch(html, /Variance Preview/)
  assert.doesNotMatch(html, /Narrative Preview/)
})

// --- 3. Relocated content still renders inside the (opened) panel -----------

test('UploadGuidance carries the moved upload note and category helper', async () => {
  const { default: UploadGuidance } = await loadComponent('src/components/UploadGuidance.jsx')
  const html = renderToStaticMarkup(React.createElement(UploadGuidance))
  assert.match(html, /comparative income statement/)
  assert.match(html, /What can I add here\?/)
  assert.match(html, /General Ledger \(GL\)/)
})

// --- 4. Relocated controls are still present and bound to the same state ----

test('StylePanel still reflects the style state it is given (toggle + select bound)', async () => {
  const { default: StylePanel } = await loadComponent('src/components/StylePanel.jsx')
  const noop = () => {}

  // Toggle ON → the checkbox renders checked; OFF → it does not.
  const on = renderToStaticMarkup(
    React.createElement(StylePanel, { style: { ...DEFAULT_STYLE, abbreviateDollars: true }, setStyle: noop })
  )
  assert.match(on, /type="checkbox"[^>]*checked/)

  const off = renderToStaticMarkup(
    React.createElement(StylePanel, { style: { ...DEFAULT_STYLE, abbreviateDollars: false }, setStyle: noop })
  )
  assert.doesNotMatch(off, /type="checkbox"[^>]*checked/)

  // A select reflects the bound value (Concise option is selected).
  const concise = renderToStaticMarkup(
    React.createElement(StylePanel, { style: { ...DEFAULT_STYLE, reportStyle: 'Concise' }, setStyle: noop })
  )
  assert.match(concise, /<option[^>]*selected[^>]*>Concise<\/option>|<option[^>]*value="Concise"[^>]*selected/)
})

test('VarianceDetail still reflects the variance thresholds it is given', async () => {
  const { default: VarianceDetail } = await loadComponent('src/components/VarianceDetail.jsx')
  const noop = () => {}
  const html = renderToStaticMarkup(
    React.createElement(VarianceDetail, {
      variance: { ...DEFAULT_VARIANCE, dollarThreshold: '2500' },
      setVariance: noop,
      periodScope: 'both',
      setPeriodScope: noop,
      periodScopeOffered: false
    })
  )
  // The dollar-threshold input is bound to the passed state.
  assert.match(html, /value="2500"/)
  // The disabled "Coming soon" groups are still here (nothing removed).
  assert.match(html, /Coming soon/)
})

// --- 5. App composition: the right things are inside vs. outside the panel --

test('App nests every relocated element inside the single SettingsPanel', () => {
  const src = appSrc()
  // Exactly one settings disclosure.
  assert.equal((src.match(/<SettingsPanel/g) || []).length, 1)

  // The relocated controls/notes/previews are rendered between the SettingsPanel
  // open and close tags.
  const panel = src.slice(src.indexOf('<SettingsPanel'), src.indexOf('</SettingsPanel>'))
  for (const el of ['<StylePanel', '<VarianceDetail', '<UploadGuidance', '<PreviewBasis', '<ExtractionPreview', '<VariancePreview', '<NarrativeSummary']) {
    assert.ok(panel.includes(el), `${el} should be inside the Settings & instructions panel`)
  }
})

test('App keeps the upload area, Generate, and results OUTSIDE the panel', () => {
  const src = appSrc()
  const panelStart = src.indexOf('<SettingsPanel')
  const panelEnd = src.indexOf('</SettingsPanel>')
  const outside = (tag) => {
    const i = src.indexOf(tag)
    assert.ok(i !== -1, `${tag} should be rendered`)
    assert.ok(i < panelStart || i > panelEnd, `${tag} should be outside the Settings panel`)
  }
  // SourceFiles (upload) is before the panel; Generate + Result are after it, so
  // Generate is reachable and works whether the panel is open or closed.
  outside('<SourceFiles')
  outside('<GeneratePanel')
  outside('<ResultPanel')
  assert.ok(src.indexOf('<SourceFiles') < panelStart, 'upload area comes before the panel')
  assert.ok(src.indexOf('<GeneratePanel') > panelEnd, 'Generate comes after the panel')
})
