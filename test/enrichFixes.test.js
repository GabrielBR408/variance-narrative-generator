// Regression tests — matching / status bug-fix pass.
// Runs on Node's built-in test runner (`node --test`), no extra dependencies.
//
// Covers the verified bugs fixed in this pass:
//   1a. contradicting explicit account codes block the exact-name tier
//   1b. a citation's rows/total come only from the best-scoring account entry
//       (no cross-account or roll-up + detail double-counting)
//   2.  citations rank by confidence (then richness), not by file name, so the
//       cap never drops the best evidence
//   3.  a revenue line whose GL nets to a credit is NOT an accrual true-up
//   4.  enrichment status counts the numerator and denominator over the same
//       note population (budget/prior-cited enriched lines are eligible)
//   5.  the GL-enrichment diagnostic scans revenue/expense notes, not just the
//       capped High Variances headline
//   6.  a short / benefit-style leading number ("401(k)", "350 Rhode Island")
//       is not an account code, so it can never exact-code match at 1.0

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildEvidenceIndex,
  matchAccount,
  scoreMatchDetailed,
  accountCode,
  diagnose,
  CONFIDENCE_FLOOR
} from '../src/lib/enrich/index.js'
import { enrichmentStatus } from '../src/lib/enrichmentStatus.js'
import { enrichmentDiagnostic, narrativeHasGLEnrichment } from '../src/lib/enrichmentDiagnostic.js'

// --- helpers (shared shape with test/enrich.test.js) -----------------------

function supporting({ fileName = 'GL.pdf', type = 'General Ledger (GL)', columns, rows }) {
  return { fileName, status: 'ok', classification: { type }, normalized: { columns, rows } }
}

// One index entry from a GL account label (single Account column).
function entryOf(label) {
  const [e] = buildEvidenceIndex([supporting({ columns: ['Account'], rows: [[label]] })])
  return e
}

// --- Fix 1a: contradicting explicit codes block name-based matching --------

test('exact-name tier is blocked when both sides carry different explicit codes', () => {
  // Same normalized name ("repairs maintenance") but different chart accounts.
  const r = scoreMatchDetailed('6010 Repairs & Maintenance', entryOf('7010 Repairs & Maintenance'))
  assert.equal(r.score, 0, 'a contradicting code must not name-match')
  assert.equal(r.method, null)
})

test('contradicting codes produce no citation end-to-end', () => {
  const idx = buildEvidenceIndex([
    supporting({ columns: ['Account', 'Amount'], rows: [['7010 Repairs & Maintenance', '9000']] })
  ])
  assert.deepEqual(matchAccount('6010 Repairs & Maintenance', idx), [])
})

test('the name tier still fires when only one side carries a code', () => {
  // A code-less base line against a coded GL label is not a contradiction.
  const r = scoreMatchDetailed('Repairs & Maintenance', entryOf('7010 Repairs & Maintenance'))
  assert.deepEqual(r, { score: 0.9, method: 'exact_name' })
  // And a matching code still wins the exact-code tier.
  assert.deepEqual(scoreMatchDetailed('6010 Repairs & Maintenance', entryOf('6010 Repairs & Maintenance')), {
    score: 1.0,
    method: 'exact_code'
  })
})

// --- Fix 1b: one citation = one account's rows (no double-counting) --------

test('a roll-up "Total …" row is never summed with the detail rows it rolls up', () => {
  // Two detail rows (0.9 exact name) plus their roll-up row (0.7 substring).
  // Merging all three summed $14,800 for $7,400 of real activity.
  const idx = buildEvidenceIndex([
    supporting({
      columns: ['Account', 'Amount'],
      rows: [
        ['Utility Expense Recovery', '4000'],
        ['Utility Expense Recovery', '3400'],
        ['Total Utility Expense Recovery Detail', '7400']
      ]
    })
  ])
  const [cite] = matchAccount('Utility Expense Recovery', idx)
  assert.equal(cite.confidence, 0.9, 'the best-scoring account entry wins the citation')
  assert.deepEqual(cite.sourceRows, [0, 1], 'the roll-up row is not merged into the citation')
  assert.equal(cite.detail.total, 7400, 'the total reflects real activity, not activity + its roll-up')
  assert.equal(cite.detail.count, 2)
})

test('rows from a different account entry are never summed into the citation', () => {
  // The exact-code account has $8,000 of activity; a weaker substring match on a
  // different label used to be merged in, claiming $20,000.
  const idx = buildEvidenceIndex([
    supporting({
      columns: ['Account', 'Amount'],
      rows: [
        ['6010 Repairs & Maintenance', '8000'],
        ['Total Repairs & Maintenance', '12000']
      ]
    })
  ])
  const [cite] = matchAccount('6010 Repairs & Maintenance', idx)
  assert.equal(cite.confidence, 1.0)
  assert.equal(cite.matchMethod, 'exact_code')
  assert.deepEqual(cite.sourceRows, [0])
  assert.equal(cite.detail.total, 8000, 'only the exact-code account contributes to the total')
})

test('repeated rows of the SAME account still collapse into one citation', () => {
  // Genuinely-same-account rows (same code) keep merging — the fix only splits
  // different account entries apart.
  const idx = buildEvidenceIndex([
    supporting({
      columns: ['Account', 'Amount'],
      rows: [
        ['6010 Repairs & Maintenance', '5000'],
        ['6010 Repairs & Maintenance', '3000']
      ]
    })
  ])
  const [cite] = matchAccount('6010 Repairs & Maintenance', idx)
  assert.deepEqual(cite.sourceRows, [0, 1])
  assert.equal(cite.detail.total, 8000)
})

// --- Fix 2: citations rank by confidence, not file name --------------------

test('the citation cap never drops the best evidence in favor of weaker file names', () => {
  // Three weak 0.7 substring matches named a/b/c.pdf plus an exact-code 1.0 GL
  // named z-ledger.xlsx. The old file-name sort sliced z-ledger.xlsx away.
  const weak = (fileName) =>
    supporting({
      fileName,
      columns: ['Account', 'Amount'],
      rows: [['Total Utility Expense Recovery Detail', '100']]
    })
  const idx = buildEvidenceIndex([
    weak('a.pdf'),
    weak('b.pdf'),
    weak('c.pdf'),
    supporting({
      fileName: 'z-ledger.xlsx',
      columns: ['Account', 'Amount'],
      rows: [['5100 Utility Expense Recovery', '7366']]
    })
  ])
  const cites = matchAccount('5100 Utility Expense Recovery', idx)
  assert.equal(cites.length, 3, 'the cap still applies')
  assert.equal(cites[0].fileName, 'z-ledger.xlsx', 'the exact-code match ranks first')
  assert.equal(cites[0].confidence, 1.0)
  // Descending confidence; file name only breaks ties (a.pdf before b.pdf).
  assert.deepEqual(cites.slice(1).map((c) => c.fileName), ['a.pdf', 'b.pdf'])
  assert.ok(cites.every((c, i, all) => i === 0 || all[i - 1].confidence >= c.confidence))
})

// --- Fix 3: a revenue credit is not an accrual true-up ---------------------

function revenueNote(over = {}) {
  return {
    account: 'Rental Income',
    accountType: 'revenue',
    comparisonType: 'budget',
    varianceAmount: 8000,
    variancePercent: 40,
    actual: 28000,
    comparison: 20000,
    ...over
  }
}

test('a revenue line whose GL nets to a credit is diagnosed as normal income, not ACCRUAL_TRUEUP', () => {
  const d = diagnose({
    note: revenueNote(),
    detail: { count: 4, total: -8000, maxTxn: 2500, vendor: null, description: null },
    classifyType: 'A',
    contribution: { contributionType: 'aligned' },
    confidence: 1,
    thick: true,
    hasCitation: true
  })
  assert.notEqual(d.nature, 'ACCRUAL_TRUEUP', 'revenue posting as a credit is normal income')
  assert.equal(d.nature, 'REAL_SPEND')
  assert.equal(d.qualifiers.credit, false)
})

test('a negative reported actual on a revenue line is not a credit surprise either', () => {
  const d = diagnose({
    note: revenueNote({ actual: -5000, comparison: 4000, varianceAmount: -9000 }),
    hasCitation: false
  })
  assert.notEqual(d.nature, 'ACCRUAL_TRUEUP')
  assert.equal(d.qualifiers.credit, false)
})

test('an expense line with a net GL credit still diagnoses ACCRUAL_TRUEUP', () => {
  const d = diagnose({
    note: revenueNote({ account: 'Repairs and Maintenance', accountType: 'expense' }),
    detail: { count: 4, total: -8000, maxTxn: 2500, vendor: null, description: null },
    classifyType: 'E',
    confidence: 1,
    thick: true,
    hasCitation: true
  })
  assert.equal(d.nature, 'ACCRUAL_TRUEUP')
  assert.equal(d.qualifiers.credit, true)
})

// --- Fix 4: status numerator and denominator use the same population -------

// A budget-cited note the server-side enrichment DID enrich (server/llm.js
// _buildPackets targets every note with `support`, not just GL-cited ones).
function budgetCitedNote(account, llmEnriched) {
  const note = {
    account,
    varianceAmount: -4200,
    text: `${account} was under budget by $4,200.`,
    support: [{ fileName: 'Budget.xlsx', classificationType: 'Budget', confidence: 0.9 }]
  }
  if (llmEnriched) note.llmEnriched = true
  return note
}

function narrativeWith(notes) {
  return { periods: [{ period: 'current', highVariances: notes }] }
}

test('budget-cited enriched lines count as eligible — never the "nothing to enrich" fallback', () => {
  // Previously: enrichedCount 2, eligibleCount 0 (GL-only denominator) → every
  // branch failed through to the false "no supporting detail" status while the
  // report visibly carried AI-enriched lines.
  const narrative = narrativeWith([budgetCitedNote('Insurance', true), budgetCitedNote('Legal', true)])
  const s = enrichmentStatus({ narrative, reason: 'ok' })
  assert.equal(s.statusKind, 'enriched')
  assert.equal(s.eligibleCount, 2)
  assert.equal(s.enrichedCount, 2)
  assert.doesNotMatch(s.message, /no supporting|Add a GL file/i)
})

test('a mix of enriched and fallback budget-cited lines reports the honest partial state', () => {
  const narrative = narrativeWith([budgetCitedNote('Insurance', true), budgetCitedNote('Legal', false)])
  const s = enrichmentStatus({ narrative, reason: 'ok' })
  assert.equal(s.statusKind, 'partial')
  assert.equal(s.eligibleCount, 2)
  assert.equal(s.enrichedCount, 1)
  assert.equal(s.fallbackCount, 1)
})

test('enrichedCount can never exceed eligibleCount (an enriched line is eligible by definition)', () => {
  // Defensive: an llmEnriched line with no support metadata still counts in both.
  const odd = { account: 'Misc', text: 'Misc moved $2,000. [ENRICHED]', llmEnriched: true }
  const s = enrichmentStatus({ narrative: narrativeWith([odd]), reason: 'ok' })
  assert.ok(s.enrichedCount <= s.eligibleCount, `${s.enrichedCount} > ${s.eligibleCount}`)
  assert.equal(s.statusKind, 'enriched', 'a demonstrably enriched report never reads as "nothing to enrich"')
})

test('a narrative with no citations and no enrichment still reports the honest none state', () => {
  const s = enrichmentStatus({ narrative: narrativeWith([{ account: 'Misc', text: 'Misc moved $2,000.' }]), reason: 'ok' })
  assert.equal(s.statusKind, 'none')
  assert.equal(s.eligibleCount, 0)
})

// --- Fix 5: the diagnostic scans the same sections as the status helper ----

const glNote = { account: 'X', support: [{ classificationType: 'General Ledger (GL)' }] }
const bareNote = { account: 'Y' }

test('narrativeHasGLEnrichment sees GL citations in revenue/expense notes, not just High Variances', () => {
  // High Variances is capped at a few headline rows, so GL enrichment often
  // lives only in the section notes.
  const inExpense = { periods: [{ period: 'current', highVariances: [bareNote], expenseNotes: [glNote] }] }
  const inRevenue = { periods: [{ period: 'current', highVariances: [], revenueNotes: [glNote] }] }
  assert.equal(narrativeHasGLEnrichment(inExpense), true)
  assert.equal(narrativeHasGLEnrichment(inRevenue), true)
  const bareEverywhere = { periods: [{ period: 'current', highVariances: [bareNote], expenseNotes: [bareNote] }] }
  assert.equal(narrativeHasGLEnrichment(bareEverywhere), false)
})

test('GL enrichment living only in Expense Notes reports "GL enrichment active"', () => {
  const d = enrichmentDiagnostic({
    extractions: [
      { status: 'ok', classification: { type: 'Base Variance Report' } },
      { status: 'ok', classification: { type: 'General Ledger (GL)' } }
    ],
    narratives: [{ periods: [{ period: 'current', highVariances: [bareNote], expenseNotes: [glNote] }] }]
  })
  assert.equal(d.statusKind, 'active')
  assert.equal(d.status, 'GL enrichment active')
  assert.equal(d.narrativesEnriched, 1)
})

// --- Fix 6: short / benefit-style leading numbers are not account codes ----

test('accountCode rejects benefit-plan and address-style leading numbers', () => {
  assert.equal(accountCode('401(k) Match'), '', 'digits running into "(" are a label fragment')
  assert.equal(accountCode('350 Rhode Island CAM'), '', 'a short address number is not a code')
  assert.equal(accountCode('401 - Rent Income'), '', 'three digits are below the real-code minimum')
})

test('accountCode keeps real chart-of-accounts codes', () => {
  assert.equal(accountCode('5100 Utility Expense Recovery'), '5100')
  assert.equal(accountCode('51300 HVAC Contract'), '51300')
  assert.equal(accountCode('6250'), '6250') // bare code cell (NQ-6C.1 fallback)
  assert.equal(accountCode('5100-10 Utilities'), '5100-10')
})

test('"401(k) Match" no longer exact-code matches "401 - Rent Income" at 1.0', () => {
  const r = scoreMatchDetailed('401(k) Match', entryOf('401 - Rent Income'))
  assert.ok(r.score < CONFIDENCE_FLOOR, `expected below floor, got ${r.score}`)
  assert.equal(r.method, null)
})

test('address-style labels still match each other by name (legitimate match preserved)', () => {
  assert.deepEqual(scoreMatchDetailed('350 Rhode Island CAM', entryOf('350 Rhode Island CAM')), {
    score: 0.9,
    method: 'exact_name'
  })
})
