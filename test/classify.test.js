// Deterministic commentary classifier tests — Phase 19A.
// Runs on Node's built-in test runner (`node --test`), no extra dependencies.
//
// Drives classifyGLCommentary directly with synthetic GL-detail summaries and
// variance fields, covering every confidence band, every category boundary, the
// ratio thresholds (dominated / concentrated / recurring), the bounded recurring
// population, the conflict-resolution precedence, and purity.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { classifyGLCommentary } from '../src/lib/enrich/classify.js'

// Build a detail summary like summarizeDetail produces. `total` may be null to
// model ambiguous amounts; maxTxn defaults to the implied single amount.
function detail({ count, total = null, maxTxn = null }) {
  return { count, total, maxTxn, topVendor: null, topVendorCount: 0 }
}

// Classify a budgeted (comparison present, non-zero) high-confidence note unless
// overridden — the common case, so each test states only what it varies.
function classify(over = {}) {
  return classifyGLCommentary({
    detail: over.detail,
    comparison: 'comparison' in over ? over.comparison : 5000,
    comparisonType: over.comparisonType ?? 'budget',
    confidence: over.confidence ?? 0.9,
    thick: over.thick ?? true
  }).type
}

// --- confidence bands ------------------------------------------------------

test('thin (not thick) evidence is always G regardless of confidence', () => {
  assert.equal(classify({ thick: false, confidence: 1.0, detail: detail({ count: 1, total: 5000, maxTxn: 5000 }) }), 'G')
})

test('confidence below 0.70 is G', () => {
  assert.equal(classify({ confidence: 0.69, detail: detail({ count: 1, total: 5000, maxTxn: 5000 }) }), 'G')
})

test('confidence 0.70–0.85 is capped at F when the total is reliable', () => {
  assert.equal(classify({ confidence: 0.70, detail: detail({ count: 1, total: 5000, maxTxn: 5000 }) }), 'F')
  assert.equal(classify({ confidence: 0.84, detail: detail({ count: 1, total: 5000, maxTxn: 5000 }) }), 'F')
})

test('confidence 0.70–0.85 with no reliable total degrades to G', () => {
  assert.equal(classify({ confidence: 0.80, detail: detail({ count: 3, total: null }) }), 'G')
})

test('confidence ≥ 0.85 unlocks specific categories', () => {
  assert.equal(classify({ confidence: 0.85, detail: detail({ count: 1, total: 5000, maxTxn: 5000 }) }), 'A')
})

// --- A one-time ------------------------------------------------------------

test('A: a single transaction (with or without a reliable total)', () => {
  assert.equal(classify({ detail: detail({ count: 1, total: 5000, maxTxn: 5000 }) }), 'A')
  assert.equal(classify({ detail: detail({ count: 1, total: null }) }), 'A')
})

// --- B one-time-dominated --------------------------------------------------

test('B: one transaction dominates (ratio ≥ 0.80)', () => {
  assert.equal(classify({ detail: detail({ count: 4, total: 10000, maxTxn: 8500 }) }), 'B') // 0.85
})

test('B boundary: ratio just under 0.80 is not B', () => {
  // count 4, ratio 0.79 → neither B nor C (ratio > 0.60) nor I (count ≠ 2) → F
  assert.equal(classify({ detail: detail({ count: 4, total: 10000, maxTxn: 7900 }) }), 'F')
})

// --- C recurring -----------------------------------------------------------

test('C: 3..12 evenly-spread transactions (ratio ≤ 0.60)', () => {
  assert.equal(classify({ detail: detail({ count: 4, total: 4000, maxTxn: 1000 }) }), 'C') // 0.25
  assert.equal(classify({ detail: detail({ count: 12, total: 12000, maxTxn: 1500 }) }), 'C')
})

test('C upper bound: a count above 12 is no longer recurring → F', () => {
  assert.equal(classify({ detail: detail({ count: 13, total: 13000, maxTxn: 1100 }) }), 'F')
})

test('C lower bound: count 2 is never recurring', () => {
  // count 2, ratio 0.25 (< 0.60 concentrated floor) → F
  assert.equal(classify({ detail: detail({ count: 2, total: 4000, maxTxn: 1000 }) }), 'F')
})

// --- I concentrated --------------------------------------------------------

test('I: exactly two transactions, larger ≥ 0.60 of the total', () => {
  assert.equal(classify({ detail: detail({ count: 2, total: 10000, maxTxn: 7000 }) }), 'I') // 0.70
})

test('I precedence: count 2 with ratio ≥ 0.80 is B, not I', () => {
  assert.equal(classify({ detail: detail({ count: 2, total: 10000, maxTxn: 8500 }) }), 'B')
})

test('I floor: count 2 with ratio < 0.60 is F', () => {
  assert.equal(classify({ detail: detail({ count: 2, total: 10000, maxTxn: 5500 }) }), 'F') // 0.55
})

// --- D unbudgeted ----------------------------------------------------------

test('D: zero or absent budget overrides the GL shape', () => {
  assert.equal(classify({ comparison: 0, detail: detail({ count: 1, total: 5000, maxTxn: 5000 }) }), 'D')
  assert.equal(classify({ comparison: null, detail: detail({ count: 4, total: 4000, maxTxn: 1000 }) }), 'D')
})

test('D does not apply to a prior-period basis (not "unbudgeted")', () => {
  assert.equal(classify({ comparison: 0, comparisonType: 'prior', detail: detail({ count: 1, total: 5000, maxTxn: 5000 }) }), 'A')
})

// --- E credit / true-up ----------------------------------------------------

test('E: a net credit (negative total)', () => {
  assert.equal(classify({ detail: detail({ count: 1, total: -3000, maxTxn: 3000 }) }), 'E')
  assert.equal(classify({ detail: detail({ count: 3, total: -3000, maxTxn: 1200 }) }), 'E')
})

test('E precedence: a credit on an unbudgeted line is D (structural first)', () => {
  assert.equal(classify({ comparison: 0, detail: detail({ count: 1, total: -3000, maxTxn: 3000 }) }), 'D')
})

// --- F fallback / gaps -----------------------------------------------------

test('F: count ≥ 3 in the 0.60–0.80 ratio gap', () => {
  assert.equal(classify({ detail: detail({ count: 3, total: 1000, maxTxn: 700 }) }), 'F') // 0.70
})

test('unreliable total disables B/C/E/I and degrades to F count form', () => {
  assert.equal(classify({ detail: detail({ count: 5, total: null }) }), 'F')
})

// --- purity ----------------------------------------------------------------

test('classifier is pure: identical inputs yield the identical category', () => {
  const args = { detail: detail({ count: 2, total: 10000, maxTxn: 7000 }), comparison: 5000, comparisonType: 'budget', confidence: 0.9, thick: true }
  assert.equal(classifyGLCommentary(args).type, classifyGLCommentary(args).type)
})
