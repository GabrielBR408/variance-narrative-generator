// Style-controls isolation diagnostic — CI assertions.
// Runs the diagnostic harness (LLM stubbed to always succeed, rate limiter
// removed from the equation) and asserts the three pairwise verdicts and the
// enrichment-isolation guarantees. Pure: no network, no DOM, no file writes.
// See scripts/style-controls-diagnostic.mjs and docs/diagnostics/style-controls-report.md.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { runDiagnostic } from '../scripts/style-controls-diagnostic.mjs'

test('every flagged line is ENRICHED via the LLM stub (independent of the rate limit / fallback)', () => {
  const d = runDiagnostic()
  assert.equal(d.allEnriched, true)
  for (const run of d.runs) {
    assert.ok(run.lines.length > 0, `${run.id} produced no flagged lines`)
    for (const line of run.lines) {
      assert.ok(line.enriched, `${run.id} · ${line.key} was not LLM-enriched`)
      assert.match(line.text, /\[ENRICHED\]/)
    }
  }
})

test('Run 1 vs Run 2 are identical (Report Style / Length / Dollar Reference vary; Abbreviate off both)', () => {
  const d = runDiagnostic()
  assert.equal(d.verdicts.run1_vs_run2.identical, true)
})

test('Run 3 vs Run 4 are identical — Cautious + Abbreviate path ignores Report Style / Length / Dollar Reference', () => {
  const d = runDiagnostic()
  assert.equal(d.verdicts.run3_vs_run4.identical, true)
})

test('Run 1 vs Run 3 differ — Abbreviate Dollar Values is the lone Style control with a deterministic effect', () => {
  const d = runDiagnostic()
  assert.equal(d.verdicts.run1_vs_run3.identical, false)
})

test('core answer is NO: under Cautious + Abbreviate, Report Style / Length / Dollar Reference do not change output', () => {
  const d = runDiagnostic()
  assert.equal(d.coreAnswerYes, false)
})

test('the real style engine still encoded each run distinctly in the LLM system prompt', () => {
  const d = runDiagnostic()
  // The settings ARE captured at the prompt layer — they just never reach the
  // rendered narrative once the LLM response is held constant.
  assert.equal(d.promptsAllDistinct, true)
  assert.equal(d.run3vs4PromptDiffers, true)
})
