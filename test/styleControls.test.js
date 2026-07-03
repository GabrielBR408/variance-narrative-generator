// Style controls tests — Phase 23.
// Runs on Node's built-in test runner (`node --test`), no DOM, no extra deps.
//
// Covers:
//   • the STYLE INSTRUCTIONS block carries every active Style setting in plain
//     English, and the composed system prompt keeps the fixed base rules,
//   • the dollar-abbreviation formatter ($5,000 → $5K, $1,200,000 → $1.2M) and
//     its no-op identity when the toggle is off.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildStyleInstructions, buildSystemPrompt } from '../server/llm.js'
import { generateNarrative } from '../src/lib/narrative/index.js'
import {
  abbreviateDollarAmount,
  abbreviateDollarsInText,
  applyDollarAbbreviation
} from '../src/lib/narrative/dollarAbbrev.js'

// The App defaults (mirrors DEFAULT_STYLE in src/App.jsx).
const DEFAULT_STYLE = {
  reportStyle: 'Detailed',
  tone: 'Neutral',
  length: 'Standard',
  abbreviateDollars: false,
  dollarReferences: 'Detail'
}

// --- 1. STYLE INSTRUCTIONS block -------------------------------------------

test('buildStyleInstructions is labelled and reflects the default settings', () => {
  const block = buildStyleInstructions(DEFAULT_STYLE)
  assert.match(block, /^STYLE INSTRUCTIONS:/)
  assert.match(block, /Detailed style/)
  assert.match(block, /Neutral tone/)
  assert.match(block, /Standard length/)
  assert.match(block, /Do not abbreviate dollar values/)
  assert.match(block, /Reference the actual, budget, and variance figures/)
})

test('Report Style appears in the prompt for each option', () => {
  assert.match(buildStyleInstructions({ ...DEFAULT_STYLE, reportStyle: 'Concise' }), /Concise style/)
  assert.match(buildStyleInstructions({ ...DEFAULT_STYLE, reportStyle: 'Detailed' }), /Detailed style/)
})

test('Tone appears in the prompt and Cautious enables hedging language', () => {
  const neutral = buildStyleInstructions({ ...DEFAULT_STYLE, tone: 'Neutral' })
  assert.match(neutral, /Neutral tone/)
  assert.match(neutral, /without hedging/)

  const cautious = buildStyleInstructions({ ...DEFAULT_STYLE, tone: 'Cautious' })
  assert.match(cautious, /Cautious tone/)
  assert.match(cautious, /appears to/)
  assert.match(cautious, /may reflect/)
  assert.match(cautious, /consistent with/)
})

test('Length appears in the prompt for each option', () => {
  assert.match(buildStyleInstructions({ ...DEFAULT_STYLE, length: 'Brief' }), /Brief length/)
  assert.match(buildStyleInstructions({ ...DEFAULT_STYLE, length: 'Standard' }), /Standard length/)
  assert.match(buildStyleInstructions({ ...DEFAULT_STYLE, length: 'Verbose' }), /Verbose length/)
})

test('Abbreviate Dollar Values appears in the prompt both ways', () => {
  assert.match(buildStyleInstructions({ ...DEFAULT_STYLE, abbreviateDollars: true }), /Abbreviate dollar values/)
  assert.match(buildStyleInstructions({ ...DEFAULT_STYLE, abbreviateDollars: false }), /Do not abbreviate dollar values/)
})

test('Dollar Value References appears in the prompt both ways', () => {
  assert.match(
    buildStyleInstructions({ ...DEFAULT_STYLE, dollarReferences: 'Minimum' }),
    /only the variance figure/
  )
  assert.match(
    buildStyleInstructions({ ...DEFAULT_STYLE, dollarReferences: 'Detail' }),
    /actual, budget, and variance figures/
  )
})

test('a fully non-default style is reflected in one combined block', () => {
  const block = buildStyleInstructions({
    reportStyle: 'Concise',
    tone: 'Cautious',
    length: 'Verbose',
    abbreviateDollars: true,
    dollarReferences: 'Minimum'
  })
  assert.match(block, /Concise style/)
  assert.match(block, /Cautious tone/)
  assert.match(block, /Verbose length/)
  assert.match(block, /Abbreviate dollar values/)
  assert.match(block, /only the variance figure/)
})

test('missing or partial style falls back to the App defaults', () => {
  const block = buildStyleInstructions({})
  assert.match(block, /Detailed style/)
  assert.match(block, /Neutral tone/)
  assert.match(block, /Standard length/)
  assert.match(block, /Do not abbreviate dollar values/)
  assert.match(block, /actual, budget, and variance figures/)
  // Also tolerant of an entirely absent argument.
  assert.match(buildStyleInstructions(), /^STYLE INSTRUCTIONS:/)
})

test('buildSystemPrompt keeps the base rules and appends the style block', () => {
  const prompt = buildSystemPrompt({ ...DEFAULT_STYLE, reportStyle: 'Concise' })
  // Base prompt rule still present.
  assert.match(prompt, /variance commentary for a commercial real estate owner report/)
  // Style block appended.
  assert.match(prompt, /STYLE INSTRUCTIONS:/)
  assert.match(prompt, /Concise style/)
})

// --- 2. Dollar abbreviation formatter --------------------------------------

test('abbreviateDollarAmount formats thousands and millions', () => {
  assert.equal(abbreviateDollarAmount(5000), '$5K')
  assert.equal(abbreviateDollarAmount(1200000), '$1.2M')
  assert.equal(abbreviateDollarAmount(3400000), '$3.4M')
  assert.equal(abbreviateDollarAmount(1500), '$1.5K')
  assert.equal(abbreviateDollarAmount(-2000000), '-$2M')
})

test('abbreviateDollarsInText rewrites $5,000 → $5K and $1,200,000 → $1.2M', () => {
  assert.equal(abbreviateDollarsInText('Utilities was over by $5,000 this period.'), 'Utilities was over by $5K this period.')
  assert.equal(abbreviateDollarsInText('Taxes rose $1,200,000 year-to-date.'), 'Taxes rose $1.2M year-to-date.')
})

test('abbreviateDollarsInText leaves figures under $1,000 unchanged', () => {
  assert.equal(abbreviateDollarsInText('A small $614.87 swing.'), 'A small $614.87 swing.')
})

test('a value that rounds up across a unit boundary is promoted to the next tier', () => {
  assert.equal(abbreviateDollarAmount(999999), '$1M') // never "$1000K"
  assert.equal(abbreviateDollarAmount(999950), '$1M')
  assert.equal(abbreviateDollarAmount(999940), '$999.9K') // below the boundary, stays K
  assert.equal(abbreviateDollarAmount(999999999), '$1B') // never "$1000M"
})

test('billions get their own tier', () => {
  assert.equal(abbreviateDollarAmount(1_500_000_000), '$1.5B') // never "$1500M"
  assert.equal(abbreviateDollarAmount(-2_000_000_000), '-$2B')
  assert.equal(abbreviateDollarsInText('Portfolio value of $1,500,000,000.'), 'Portfolio value of $1.5B.')
})

// --- 3. applyDollarAbbreviation: on vs off ---------------------------------

// The REAL engine shape: executiveSummary is an ARRAY of note objects (see
// buildExecutiveSummary in sections.js), never a bare string — the old string
// fixture masked a bug where the summary was left unabbreviated.
function sampleNarrative() {
  return {
    fileId: 'f1',
    fileName: 'f.pdf',
    classification: {},
    thresholds: {},
    periods: [
      {
        period: 'current',
        periodLabel: 'Current',
        executiveSummary: [{ text: 'Total variance of $1,200,000 for the period.', sourceRows: [] }],
        highVariances: [{ account: 'Taxes', varianceAmount: 5000, text: 'Real Estate Taxes exceeded budget by $5,000.' }],
        revenueNotes: [],
        expenseNotes: [],
        missingData: [],
        sourceRows: []
      }
    ]
  }
}

test('applyDollarAbbreviation is a no-op (same reference) when toggled off', () => {
  const narrative = sampleNarrative()
  const result = applyDollarAbbreviation(narrative, false)
  assert.equal(result, narrative)
  // The text is untouched.
  assert.equal(result.periods[0].highVariances[0].text, 'Real Estate Taxes exceeded budget by $5,000.')
})

test('applyDollarAbbreviation rewrites narrative text when toggled on', () => {
  const narrative = sampleNarrative()
  const result = applyDollarAbbreviation(narrative, true)
  // A new object is returned; the source narrative is not mutated.
  assert.notEqual(result, narrative)
  assert.equal(narrative.periods[0].highVariances[0].text, 'Real Estate Taxes exceeded budget by $5,000.')
  // Dollar figures are abbreviated in both the summary and the note text.
  assert.equal(result.periods[0].executiveSummary[0].text, 'Total variance of $1.2M for the period.')
  assert.equal(result.periods[0].highVariances[0].text, 'Real Estate Taxes exceeded budget by $5K.')
  // Structured fields (varianceAmount) are never reformatted.
  assert.equal(result.periods[0].highVariances[0].varianceAmount, 5000)
})

test('the ENGINE-emitted executive summary (an array of notes) is abbreviated', () => {
  // The engine emits executiveSummary as an array of note objects; the string
  // branch alone left "$105,000" beside "$40K" bullets.
  const narrative = generateNarrative({
    fileId: 'f1', fileName: 'f.pdf', baseClassification: 'Base',
    thresholds: { amount: 1000, percent: 10 },
    comparisonSets: [{
      period: 'current',
      comparisons: [{
        account: 'Repairs Expense', actual: 145000, budget: 40000, prior: null,
        varianceAmount: 105000, variancePercent: 262.5, comparisonType: 'budget',
        thresholdTriggered: true, category: 'unfavorable', accountType: 'expense',
        missingData: false, confidence: 90, sourceRows: [1]
      }]
    }]
  })
  assert.ok(Array.isArray(narrative.periods[0].executiveSummary), 'engine emits an array')
  const result = applyDollarAbbreviation(narrative, true)
  assert.match(result.periods[0].executiveSummary[0].text, /\$105K/)
  assert.doesNotMatch(result.periods[0].executiveSummary[0].text, /\$105,000/)
})

test('context notes are abbreviated alongside the other sections', () => {
  const narrative = sampleNarrative()
  narrative.periods[0].contextNotes = [
    { account: 'Prepaid Insurance', text: 'Prepaid Insurance exceeded budget by $40,000 (30.0%).' }
  ]
  const result = applyDollarAbbreviation(narrative, true)
  assert.equal(result.periods[0].contextNotes[0].text, 'Prepaid Insurance exceeded budget by $40K (30.0%).')
})
