// Phase 21.3 validation — detailed commentary rendering.
// Pure, dependency-free. Runs a realistic, non-sensitive comparative report +
// GL through the FULL enrichment pipeline in BOTH commentary modes and reports:
//   total notes · GL-enriched notes · detailed notes · vendor/memo-rendered
//   counts · conservative-vs-detailed samples · leakage checks · fallback cases.
//
// Run: node scripts/phase-21-3-validation.mjs

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
  rec({ account: '51252 Janitorial Supplies', actual: 9000, budget: 5000 }),
  rec({ account: '51020 Utility-Building Water', actual: 3100, budget: 1000 }),
  rec({ account: '51013 Utility-Elect-Building', actual: 8000, budget: 4000 }),
  rec({ account: '51153 HVAC-Repairs', actual: 7000, budget: 3000 }),
  rec({ account: '51301 Landscaping Contract', actual: 6000, budget: 3000 }),
  rec({ account: '51051 Security Contract', actual: 7000, budget: 4000 }),
  rec({ account: '51256 Trash Removal', actual: 4000, budget: 1000 }),
  rec({ account: '51257 Recology Hauling', actual: 4000, budget: 1000 }),
  rec({ account: '51999 Misc', actual: 4000, budget: 1000 }),
  rec({ account: '51400 Fire Sprinkler Contract', actual: 12000, budget: 5000, accountType: 'unknown', category: 'neutral' }),
  rec({ account: '54200 Insurance', actual: 6000, budget: 5000 }),
  rec({ account: '54110 Real Estate Taxes', actual: 9000, budget: 4000 })
]

// GL columns mirror the real MRI layout (Vendor empty; vendor+memo fused into
// Description). Note: a Description that begins with a numeric token (line #/date)
// is treated as numeric by the matcher's detail summarizer and is NOT captured —
// so detailed rendering only fires on rows whose Description leads with text.
const GL = {
  fileName: '4. General Ledger.pdf',
  status: 'ok',
  classification: { type: 'General Ledger (GL)' },
  normalized: {
    columns: ['Account', 'Date', 'Reference', 'Vendor', 'Description', 'Amount'],
    rows: [
      ['51252 Janitorial Supplies', '01/05/2026', '3506', '', 'Janitorial supply TRINITY BUILDING SERVICES', '4000'],
      ['51020 Utility-Building Water', '01/15/2026', '', '', 'Monthly water CITY WATER DEPT', '2100'],
      ['51013 Utility-Elect-Building', '01/20/2026', '', '', 'Electric and gas PG&E', '4000'],
      ['51153 HVAC-Repairs', '01/06/2026', '', '', 'HVAC repair BAY CITY MECHANICAL SERVICE LLC', '4000'],
      ['51301 Landscaping Contract', '01/06/2026', '', '', 'Landscaping contract FOLIATE LLC', '3000'],
      ['51051 Security Contract', '01/06/2026', '', '', 'Security svc ARMADA SECURITY', '3000'],
      ['51256 Trash Removal', '01/16/2026', '', '', 'Monthly trash pickup', '3000'],
      ['51257 Recology Hauling', '01/17/2026', '', '', 'RECOLOGY GOLDEN GATE', '3000'],
      ['51999 Misc', '01/30/2026', '', '', 'Service', '3000'],
      ['51400 Fire Sprinkler Contract', '01/10/2026', '', '', 'Annual fire contract ACME FIRE LLC', '23200'],
      ['51400 Fire Sprinkler Contract', '01/22/2026', '', '', 'Annual fire contract ACME FIRE LLC', '-12500'],
      ['54200 Insurance', '01/12/2026', '', '', 'Annual premium BLUE SHIELD INSURANCE', '25000'],
      // Leading line-number blob — exercises the matcher's numeric-drop fallback.
      ['54110 Real Estate Taxes', '01/07/2026', '0134', '', '1304 2nd Installment SAN FRANCISCO TAX COLLECTOR', '5000']
    ]
  }
}

function baseNarrative() {
  return generateNarrative({
    fileId: 'base',
    fileName: 'Comparative Income Statement.xlsx',
    baseClassification: 'Base Variance Report',
    thresholds: { amount: 1000, percent: 10 },
    comparisonSets: [{ period: 'current', comparisons: COMPARISONS }]
  })
}

// Unique notes by account (a note can appear in both the High Variances roll-up
// and its expense/revenue section — count it once).
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
const DETAILED_RE = /GL detail includes|Related GL activity includes/

const conservative = enrichNarrative(baseNarrative(), { supporting: [GL] })
const detailed = enrichNarrative(baseNarrative(), { supporting: [GL], mode: 'detailed' })

const consNotes = allNotes(conservative)
const detNotes = allNotes(detailed)

const glNotes = detNotes.filter(isGL)
const detailedNotes = detNotes.filter((n) => DETAILED_RE.test(n.text))
const vendorRendered = detNotes.filter((n) => /includes .*from [A-Z]/.test(n.text))
const memoRendered = detNotes.filter((n) => /GL detail includes [a-z]/.test(n.text)) // memo phrases start lowercase

console.log('=== Phase 21.3 — Detailed Commentary Validation ===\n')
console.log(`Total notes:            ${detNotes.length}`)
console.log(`GL-enriched notes:      ${glNotes.length}`)
console.log(`Detailed notes:         ${detailedNotes.length}`)
console.log(`Vendor-rendered notes:  ${vendorRendered.length}`)
console.log(`Memo-rendered notes:    ${memoRendered.length}`)

console.log('\n--- Conservative vs Detailed (per account) ---')
for (let i = 0; i < consNotes.length; i++) {
  const c = consNotes[i]
  const d = detNotes[i]
  const changed = c.text !== d.text
  console.log(`\n• ${c.account}  ${changed ? '[DETAILED]' : '[fallback → conservative]'}`)
  console.log(`   conservative: ${c.text}`)
  if (changed) console.log(`   detailed:     ${d.text}`)
}

console.log('\n--- Default-unchanged check ---')
const md0 = narrativeToMarkdown(enrichNarrative(baseNarrative(), { supporting: [GL] }))
const mdC = narrativeToMarkdown(conservative)
console.log(`Default (no mode) === conservative Markdown: ${md0 === mdC}`)

console.log('\n--- Leakage checks (detailed Markdown) ---')
const md = narrativeToMarkdown(detailed)
const checks = [
  ['dates', /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/],
  ['references', /\bINV\b|\bAP \d|\bGS \d|#\s*\d/],
  ['raw-caps vendor blobs', /TRINITY BUILDING SERVICES|CITY WATER DEPT|ACME FIRE LLC|BLUE SHIELD INSURANCE|RECOLOGY GOLDEN GATE/],
  ['file name', /General Ledger\.pdf|Supporting file/],
  ['suppressed/raw GL $', /\$23,200|\$25,000|\$10,700/],
  ['causation', /\b(caused by|due to|because of|driven by|drove|resulting from|explains?)\b/i],
  ['account codes', /\b5\d{4}\b/]
]
for (const [label, re] of checks) {
  console.log(`  ${re.test(md) ? 'LEAK ✗' : 'clean ✓'}  ${label}`)
}

console.log('\n--- Fallback cases (detailed mode produced no detail) ---')
for (let i = 0; i < detNotes.length; i++) {
  if (isGL(detNotes[i]) && !DETAILED_RE.test(detNotes[i].text)) {
    console.log(`  ${detNotes[i].account}`)
  }
}
