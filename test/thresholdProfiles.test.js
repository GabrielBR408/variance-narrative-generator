// Per-property threshold profile tests.
// Runs on Node's built-in test runner (`node --test`), no extra dependencies.
//
// Exercises src/lib/profiles.js: the pure list edits (upsert/remove, trimming,
// case-insensitive uniqueness, caps), localStorage persistence that must
// tolerate missing/corrupt/throwing storage (stubbed via globalThis), and the
// deterministic matchProfile auto-match (filename hit, metadata-row hit,
// longest-match preference, ambiguous tie → null, junk-input safety).

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  PROFILES_STORAGE_KEY,
  MAX_PROFILES,
  MAX_PROFILE_NAME_LENGTH,
  cleanProfileName,
  loadProfiles,
  saveProfiles,
  upsertProfile,
  removeProfile,
  matchProfile,
  rowsForMatch,
  appliedProfileNotice
} from '../src/lib/profiles.js'

const THRESHOLDS = { dollarThreshold: '2500', percentThreshold: '15' }

// --- localStorage stubbing --------------------------------------------------
// Node 22 has no global localStorage by default; these helpers install a fake
// (or an explicit absence) and always restore the original global afterwards.
const ORIGINAL_DESCRIPTOR = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

function stubStorage(impl) {
  Object.defineProperty(globalThis, 'localStorage', {
    value: impl,
    configurable: true,
    writable: true
  })
}

function restoreStorage() {
  if (ORIGINAL_DESCRIPTOR) Object.defineProperty(globalThis, 'localStorage', ORIGINAL_DESCRIPTOR)
  else delete globalThis.localStorage
}

// Minimal in-memory Storage stand-in — just the two methods the module uses.
function fakeStorage(initial = {}) {
  const data = { ...initial }
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = String(v)
    },
    _data: data
  }
}

// --- upsertProfile -----------------------------------------------------------

test('upsertProfile adds a trimmed profile holding only the threshold fields', () => {
  const next = upsertProfile([], '  1045 Sansome  ', {
    ...THRESHOLDS,
    include: { glResearch: true }, // non-profiled variance state must be stripped
    percentThreshold: 15 // numbers are stored as the form's strings
  })
  assert.deepEqual(next, [
    { name: '1045 Sansome', settings: { dollarThreshold: '2500', percentThreshold: '15' } }
  ])
})

test('upsertProfile replaces case-insensitively instead of duplicating', () => {
  const one = upsertProfile([], '1045 Sansome', THRESHOLDS)
  const two = upsertProfile(one, '1045 SANSOME', { dollarThreshold: '9000', percentThreshold: '5' })
  assert.equal(two.length, 1)
  assert.equal(two[0].name, '1045 SANSOME') // latest casing wins
  assert.equal(two[0].settings.dollarThreshold, '9000')
})

test('upsertProfile rejects a blank name — returns the SAME list reference', () => {
  const list = [{ name: 'A Property', settings: THRESHOLDS }]
  assert.equal(upsertProfile(list, '   ', THRESHOLDS), list)
  assert.equal(upsertProfile(list, null, THRESHOLDS), list)
})

test('upsertProfile caps names at 60 characters', () => {
  const next = upsertProfile([], 'x'.repeat(200), THRESHOLDS)
  assert.equal(next[0].name.length, MAX_PROFILE_NAME_LENGTH)
})

test('upsertProfile refuses a 21st profile but still updates existing ones', () => {
  let list = []
  for (let i = 1; i <= MAX_PROFILES; i++) list = upsertProfile(list, `Property ${i}`, THRESHOLDS)
  assert.equal(list.length, MAX_PROFILES)
  // A brand-new name past the cap is rejected (same reference back).
  assert.equal(upsertProfile(list, 'One Too Many', THRESHOLDS), list)
  // Updating an EXISTING profile still works at the cap.
  const updated = upsertProfile(list, 'Property 7', { dollarThreshold: '1', percentThreshold: '2' })
  assert.equal(updated.length, MAX_PROFILES)
  assert.equal(updated.find((p) => p.name === 'Property 7').settings.dollarThreshold, '1')
})

// --- removeProfile -----------------------------------------------------------

test('removeProfile removes case-insensitively; unknown name is a no-op (same reference)', () => {
  const list = [
    { name: '1045 Sansome', settings: THRESHOLDS },
    { name: '350 RI North', settings: THRESHOLDS }
  ]
  const next = removeProfile(list, '1045 sansome')
  assert.deepEqual(next.map((p) => p.name), ['350 RI North'])
  assert.equal(removeProfile(list, 'Nowhere Plaza'), list)
})

// --- persistence tolerance ---------------------------------------------------

test('loadProfiles returns [] in a non-browser environment (no localStorage)', () => {
  stubStorage(undefined)
  try {
    assert.deepEqual(loadProfiles(), [])
  } finally {
    restoreStorage()
  }
})

test('loadProfiles returns [] on corrupt or non-array payloads', () => {
  for (const raw of ['{not json', '"a string"', '{"name":"obj"}', '42']) {
    stubStorage(fakeStorage({ [PROFILES_STORAGE_KEY]: raw }))
    try {
      assert.deepEqual(loadProfiles(), [], `payload: ${raw}`)
    } finally {
      restoreStorage()
    }
  }
})

test('loadProfiles returns [] when storage itself throws (private mode)', () => {
  stubStorage({
    getItem: () => {
      throw new Error('denied')
    }
  })
  try {
    assert.deepEqual(loadProfiles(), [])
  } finally {
    restoreStorage()
  }
})

test('loadProfiles drops junk entries and case-insensitive duplicates, keeps good ones', () => {
  const payload = JSON.stringify([
    null,
    'string',
    { settings: THRESHOLDS }, // no name
    { name: '   ', settings: THRESHOLDS }, // blank name
    { name: '1045 Sansome', settings: { dollarThreshold: '2500', percentThreshold: '15', junk: 1 } },
    { name: '1045 SANSOME', settings: THRESHOLDS }, // duplicate of the above
    { name: '350 RI North' } // missing settings → defaults to empty strings
  ])
  stubStorage(fakeStorage({ [PROFILES_STORAGE_KEY]: payload }))
  try {
    assert.deepEqual(loadProfiles(), [
      { name: '1045 Sansome', settings: { dollarThreshold: '2500', percentThreshold: '15' } },
      { name: '350 RI North', settings: { dollarThreshold: '', percentThreshold: '' } }
    ])
  } finally {
    restoreStorage()
  }
})

test('save → load round-trips a list; saveProfiles reports storage failures as false', () => {
  const storage = fakeStorage()
  stubStorage(storage)
  try {
    const list = [{ name: '55 Grant', settings: { dollarThreshold: '500', percentThreshold: '5' } }]
    assert.equal(saveProfiles(list), true)
    assert.deepEqual(loadProfiles(), list)
  } finally {
    restoreStorage()
  }
  // Throwing setItem (quota / private mode) → false, no exception.
  stubStorage({
    setItem: () => {
      throw new Error('quota')
    }
  })
  try {
    assert.equal(saveProfiles([]), false)
  } finally {
    restoreStorage()
  }
  // No storage at all → false.
  stubStorage(undefined)
  try {
    assert.equal(saveProfiles([]), false)
  } finally {
    restoreStorage()
  }
})

// --- matchProfile ------------------------------------------------------------

const PROFILES = [
  { name: '1045 Sansome', settings: { dollarThreshold: '2500', percentThreshold: '15' } },
  { name: '350 RI North', settings: { dollarThreshold: '1000', percentThreshold: '10' } }
]

test('matchProfile hits on the filename (punctuation/case ignored)', () => {
  const hit = matchProfile(PROFILES, { fileName: '1045-SANSOME_May-2026_Variance.PDF', rows: [] })
  assert.equal(hit && hit.name, '1045 Sansome')
})

test('matchProfile hits on the property name in the leading metadata rows', () => {
  const rows = [
    ['Database:', 'lpcnorcal'],
    ['350 RI North, LLC'],
    ['Comparative Income Statement', '', ''],
    ['Period = May 2026', '', 'Accrual']
  ]
  const hit = matchProfile(PROFILES, { fileName: 'variance report.xlsx', rows })
  assert.equal(hit && hit.name, '350 RI North')
})

test('matchProfile only scans the first ~15 rows — a deep hit does not match', () => {
  const rows = Array.from({ length: 30 }, (_, i) =>
    i === 25 ? ['1045 Sansome'] : [`Account ${i}`, 100, 200]
  )
  assert.equal(matchProfile(PROFILES, { fileName: 'statement.pdf', rows }), null)
})

test('matchProfile prefers the most specific profile when several match', () => {
  const list = [
    { name: '350 RI', settings: { dollarThreshold: '1', percentThreshold: '1' } },
    { name: '350 RI North', settings: { dollarThreshold: '2', percentThreshold: '2' } }
  ]
  const hit = matchProfile(list, { fileName: '350 RI North May Variance.pdf', rows: [] })
  assert.equal(hit && hit.name, '350 RI North')
})

test('matchProfile treats an exact tie between different profiles as no match', () => {
  const list = [
    { name: '1045 Sansome', settings: THRESHOLDS },
    { name: 'Sansome 1045', settings: THRESHOLDS } // same tokens, same length
  ]
  assert.equal(matchProfile(list, { fileName: '1045 Sansome variance.pdf', rows: [] }), null)
})

test('matchProfile ignores stop-word-only names and requires ALL significant tokens', () => {
  const list = [
    { name: 'The Of At', settings: THRESHOLDS }, // no significant tokens → never matches
    { name: '350 RI North', settings: THRESHOLDS }
  ]
  // 'north' missing from the haystack → the partial 350/RI hit must not match.
  assert.equal(matchProfile(list, { fileName: 'the 350 RI variance.pdf', rows: [] }), null)
})

test('matchProfile never throws on junk input', () => {
  assert.equal(matchProfile(null, null), null)
  assert.equal(matchProfile(undefined, undefined), null)
  assert.equal(matchProfile('nope', { fileName: 42 }), null)
  assert.equal(matchProfile(PROFILES, undefined), null)
  assert.equal(matchProfile(PROFILES, { fileName: null, rows: 'rows' }), null)
  // Rows full of non-text junk (objects, nulls, nested arrays, dates) are skipped.
  const junkRows = [[{ a: 1 }, null, undefined], new Date(), [[['deep']]], [Symbol.iterator]]
  assert.equal(matchProfile(PROFILES, { fileName: '', rows: junkRows }), null)
  // Numeric cells still carry signal ("1045" as a number cell).
  const hit = matchProfile(PROFILES, { fileName: 'sansome.pdf', rows: [[1045, 'Sansome St']] })
  assert.equal(hit && hit.name, '1045 Sansome')
  // Junk in the LIST is skipped, not fatal.
  assert.equal(
    matchProfile([null, 7, { settings: {} }], { fileName: '1045 sansome.pdf', rows: [] }),
    null
  )
})

// --- rowsForMatch ------------------------------------------------------------

test('rowsForMatch prefers the raw grid (which keeps metadata rows) over normalized rows', () => {
  const extraction = {
    extracted: { tables: [{ rows: [['1045 Sansome, LLC'], ['Account', 'Actual']] }] },
    normalized: { rows: [['5010', 100]] }
  }
  assert.deepEqual(rowsForMatch(extraction), [['1045 Sansome, LLC'], ['Account', 'Actual']])
  // No raw grid → fall back to normalized rows.
  assert.deepEqual(rowsForMatch({ normalized: { rows: [['a']] } }), [['a']])
  // Junk → empty, never a throw.
  assert.deepEqual(rowsForMatch(null), [])
  assert.deepEqual(rowsForMatch({ extracted: { tables: 'x' }, normalized: 7 }), [])
})

// --- small helpers -----------------------------------------------------------

test('cleanProfileName trims, caps, and re-trims; notice wording is exact', () => {
  assert.equal(cleanProfileName('  55 Grant  '), '55 Grant')
  assert.equal(cleanProfileName(null), '')
  assert.equal(cleanProfileName(`${'y'.repeat(59)} z`).length, 59) // cap exposes a space → re-trimmed
  assert.equal(appliedProfileNotice('1045 Sansome'), "Applied profile '1045 Sansome' for this property.")
})
