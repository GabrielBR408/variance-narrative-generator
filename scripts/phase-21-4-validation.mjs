// Phase 21.4 validation — detailed-default + detail polish.
// Pure, dependency-free. Runs a realistic, non-sensitive comparative report + GL
// through the FULL enrichment pipeline in detailed mode (now the default) and
// reports: note/detail/vendor/memo/fallback counts, BEFORE→AFTER for the problem
// lines (raw reconstructed vs polished rendered), and leakage checks.
//
// Run: node scripts/phase-21-4-validation.mjs

import { enrichNarrative } from '../src/lib/enrich/index.js'
import { generateNarrative } from '../src/lib/narrative/index.js'
import { narrativeToMarkdown } from '../src/lib/export/markdown.js'

function rec({ account, actual, budget, accountType = 'expense', category = 'unfavorable' }) {
  const varianceAmount = actual - budget
  const variancePercent = budget === 0 ? null : (varianceAmount / Math.abs(budget)) * 100
  return {
    account, actual, budget, prior: null, varianceAmount, variancePercent,
    comparisonType: 'budget', thresholdTriggered: true, category, accountType,
    missingData: false, confidence: 90, sourceRows: [0]
  }
}

const COMPARISONS = [
  rec({ account: '51013 Utility-Elect-Building', actual: 8000, budget: 4000 }),       // Elec & gas / PG&E
  rec({ account: '51020 Utility-Building Water', actual: 3100, budget: 1000 }),        // SFPUC water dept
  rec({ account: '51061 Fire Alarm Monitoring', actual: 6000, budget: 3000 }),         // Pyro-comm / FA testing
  rec({ account: '51252 Janitorial Supplies', actual: 9000, budget: 5000 }),
  rec({ account: '51153 HVAC-Repairs', actual: 7000, budget: 3000 }),
  rec({ account: '40410 Rental Inc-Commercial', actual: 8000, budget: 5000, accountType: 'unknown', category: 'neutral' }), // Rent - Commercial (disproportionate)
  rec({ account: '40420 Rental Inc-Parking', actual: 6000, budget: 3000, accountType: 'unknown', category: 'neutral' }),
  rec({ account: '51999 Misc', actual: 4000, budget: 1000 })                            // generic → fallback
]

const GL = {
  fileName: '4. General Ledger.pdf',
  status: 'ok',
  classification: { type: 'General Ledger (GL)' },
  normalized: {
    columns: ['Account', 'Date', 'Reference', 'Vendor', 'Description', 'Amount'],
    rows: [
      ['51013 Utility-Elect-Building', '01/20/2026', '', '', 'Elec & gas PG&E', '4000'],
      ['51020 Utility-Building Water', '01/15/2026', '', '', 'Water SFPUC-WATER DEPARTMENT', '2100'],
      ['51061 Fire Alarm Monitoring', '01/06/2026', '', '', 'Annual FA testing PYRO-COMM SYSTEMS INC', '3000'],
      ['51252 Janitorial Supplies', '01/05/2026', '', '', 'Janitorial supply TRINITY BUILDING SERVICES', '4000'],
      ['51153 HVAC-Repairs', '01/06/2026', '', '', 'HVAC repair BAY CITY MECHANICAL SERVICE LLC', '4000'],
      ['40410 Rental Inc-Commercial', '01/12/2026', '', '', 'Rent - Commercial', '25000'],
      ['40420 Rental Inc-Parking', '01/12/2026', '', '', 'Rent - Parking', '3000'],
      ['51999 Misc', '01/30/2026', '', '', 'Service', '3000']
    ]
  }
}

function baseNarrative() {
  return generateNarrative({
    fileId: 'base', fileName: 'Comparative Income Statement.xlsx', baseClassification: 'Base Variance Report',
    thresholds: { amount: 1000, percent: 10 }, comparisonSets: [{ period: 'current', comparisons: COMPARISONS }]
  })
}

function allNotes(enriched) {
  const seen = new Map()
  for (const p of enriched.periods) {
    for (const k of ['highVariances', 'expenseNotes', 'revenueNotes']) {
      for (const n of p[k] || []) if (!seen.has(n.account)) seen.set(n.account, n)
    }
  }
  return [...seen.values()]
}

const isGL = (n) => Array.isArray(n.support) && n.support.some((s) => /general\s*ledger|\bgl\b/i.test(s.classificationType))
const DETAILED_RE = /Detail includes|Detail reflects/
const glSupport = (n) => n.support.find((s) => /general\s*ledger|\bgl\b/i.test(s.classificationType))

// Detailed is the default app mode (commentaryModeFromStyle); pass it explicitly.
const detailed = enrichNarrative(baseNarrative(), { supporting: [GL], mode: 'detailed' })
const notes = allNotes(detailed)
const glNotes = notes.filter(isGL)
const detailedNotes = notes.filter((n) => DETAILED_RE.test(n.text))
const vendorRendered = notes.filter((n) => /(?:includes|reflects).* from /.test(n.text))
const memoRendered = notes.filter((n) => DETAILED_RE.test(n.text) && !/ from /.test(n.text))
const fallbacks = glNotes.filter((n) => !DETAILED_RE.test(n.text))

console.log('=== Phase 21.4 — Detailed-Default + Polish Validation ===\n')
console.log(`Total notes:           ${notes.length}`)
console.log(`GL-enriched notes:     ${glNotes.length}`)
console.log(`Detailed notes:        ${detailedNotes.length}`)
console.log(`Vendor-rendered notes: ${vendorRendered.length}`)
console.log(`Memo-rendered notes:   ${memoRendered.length}`)
console.log(`Conservative fallback: ${fallbacks.length}  (${fallbacks.map((n) => n.account).join(', ')})`)

console.log('\n--- BEFORE (raw reconstructed) → AFTER (polished rendered) ---')
for (const n of notes) {
  if (!DETAILED_RE.test(n.text)) continue
  const ev = glSupport(n).detailEvidence || {}
  const rawVendor = ev.vendor || '—'
  const rawMemo = ev.memo || '—'
  console.log(`\n• ${n.account}`)
  console.log(`   raw:    vendor=${JSON.stringify(rawVendor)}  memo=${JSON.stringify(rawMemo)}`)
  console.log(`   after:  ${n.text.split('. ').slice(1).join('. ')}`)
}

console.log('\n--- Leakage checks (detailed Markdown) ---')
const md = narrativeToMarkdown(detailed)
const checks = [
  ['dates', /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/],
  ['references', /\bINV\b|\bAP \d|\bGS \d|#\s*\d/],
  ['raw-caps blobs', /SFPUC-WATER|PYRO-COMM|TRINITY BUILDING|BAY CITY MECHANICAL/],
  ['file name', /General Ledger\.pdf|Supporting file/],
  ['raw GL $', /\$25,000|\$23,200/],
  ['causation', /\b(caused by|due to|because of|driven by|drove|resulting from|explains?)\b/i],
  ['account codes', /\b(4|5)\d{4}\b/],
  ['repeated "related activity"', /related activity[^.]*related activity/i]
]
for (const [label, re] of checks) console.log(`  ${re.test(md) ? 'LEAK ✗' : 'clean ✓'}  ${label}`)
