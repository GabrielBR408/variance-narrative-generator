// Detail polish + detailed-default tests — Phase 21.4.
// Runs on Node's built-in test runner (`node --test`), no extra dependencies.
// Covers: Detailed is the app default (Conservative still selectable), and the
// deterministic vendor/memo polish applied at render time.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { polishVendor, polishMemo } from '../src/lib/enrich/templates.js'
import { DEFAULT_COMMENTARY_DETAIL, commentaryModeFromStyle } from '../src/lib/enrich/commentaryMode.js'

// --- Detailed is the default; Conservative still works ----------------------

test('Detailed is the default commentary detail level', () => {
  assert.equal(DEFAULT_COMMENTARY_DETAIL, 'Detailed')
})

test('commentaryModeFromStyle maps the active reportStyle and defaults to detailed', () => {
  // Fix B: the mapper reads the LIVE Style-panel field (reportStyle), not the
  // removed/orphaned commentaryDetail. Missing/unknown still defaults to detailed.
  assert.equal(commentaryModeFromStyle(undefined), 'detailed')
  assert.equal(commentaryModeFromStyle({}), 'detailed')
  assert.equal(commentaryModeFromStyle({ reportStyle: 'Detailed' }), 'detailed')
  assert.equal(commentaryModeFromStyle({ reportStyle: 'Concise' }), 'conservative')
  // The orphaned legacy field must no longer drive the mode.
  assert.equal(commentaryModeFromStyle({ commentaryDetail: 'Conservative' }), 'detailed')
})

// --- vendor normalization ---------------------------------------------------

test('known vendors normalize to their canonical casing', () => {
  const cases = [
    ['pg&e', 'PG&E'],
    ['PG&E', 'PG&E'],
    ['Sfpuc-water Department', 'SFPUC Water Department'],
    ['SFPUC WATER DEPT', 'SFPUC Water Department'],
    ['Pyro-comm Systems INC.', 'Pyro-Comm Systems Inc.'],
    ['Bay City Mechanical Service LLC', 'Bay City Mechanical Service LLC'],
    ['Trinity Building Services', 'Trinity Building Services'],
    ['Recology Golden Gate', 'Recology Golden Gate'],
    ['Foliate LLC', 'Foliate LLC'],
    ['San Francisco Tax Collector', 'San Francisco Tax Collector'],
    ['Franchise Tax Board', 'Franchise Tax Board'],
    ['Pac Integrations', 'PAC Integrations'],
    ['Armada Security', 'Armada Security'],
    ["Heise's Plumbing", "Heise's Plumbing"]
  ]
  for (const [input, expected] of cases) {
    assert.equal(polishVendor(input), expected, `polishVendor(${JSON.stringify(input)})`)
  }
})

test('unknown vendors get conservative casing (hyphen parts + suffix), not aggressive rewrites', () => {
  assert.equal(polishVendor('ACME WIDGETS INC.'), 'Acme Widgets Inc.')
  assert.equal(polishVendor('blue-ridge supply co'), 'Blue-Ridge Supply Co.')
  // No known-vendor remap for an unfamiliar name — only casing changes.
  assert.equal(polishVendor('Northgate Mall Partners'), 'Northgate Mall Partners')
})

// --- memo normalization -----------------------------------------------------

test('common memo fragments normalize to cleaner wording', () => {
  const cases = [
    ['Elec & gas', 'electric and gas'],
    ['Rent - Commercial', 'commercial rent'],
    ['Rent - Parking', 'parking rent'],
    ['Annual FA testing', 'annual fire alarm testing'],
    ['water', 'water service'],
    ['HVAC repair', 'HVAC repair'],
    ['Janitorial supply', 'janitorial supplies']
  ]
  for (const [input, expected] of cases) {
    assert.equal(polishMemo(input), expected, `polishMemo(${JSON.stringify(input)})`)
  }
})

test('unknown memos read naturally mid-sentence (lowercased first letter), acronyms preserved', () => {
  assert.equal(polishMemo('Monthly water'), 'monthly water')
  assert.equal(polishMemo('Annual premium'), 'annual premium')
  assert.equal(polishMemo('HVAC overhaul'), 'HVAC overhaul') // leading acronym preserved
})

// --- determinism + safety ---------------------------------------------------

test('polish is deterministic and never introduces causal language', () => {
  for (const v of ['Sfpuc-water Department', 'Pyro-comm Systems INC.', 'unknown vendor llc']) {
    assert.equal(polishVendor(v), polishVendor(v))
  }
  for (const m of ['Elec & gas', 'Rent - Commercial', 'some memo']) {
    assert.equal(polishMemo(m), polishMemo(m))
    assert.doesNotMatch(polishMemo(m), /\b(caused by|due to|because of|driven by)\b/i)
  }
})

test('polish never emits an empty/garbage result for empty input', () => {
  assert.equal(polishVendor(''), '')
  assert.equal(polishVendor(null), '')
  assert.equal(polishMemo(''), '')
  assert.equal(polishMemo(undefined), '')
})
