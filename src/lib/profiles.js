// --- Per-property threshold profiles ---------------------------------------
// A manager runs different properties with different materiality ("1045
// Sansome" flags at $2,500/15%, "350 RI North" at $1,000/10%). This module owns
// EVERYTHING about named threshold profiles — the stored shape, localStorage
// persistence, list edits, and the deterministic auto-match that picks a
// profile from an uploaded base report — as pure, framework-free functions so
// the rules run identically in the app and under `node --test`.
//
// Boundaries: profiles capture ONLY the Variance-Detail threshold settings
// ({ dollarThreshold, percentThreshold }, the form's string values). The Style
// controls live in a separate state slice (App's `style`, not `variance`), so
// they deliberately do NOT ride along — a profile is about materiality, not
// prose. No variance math, no narratives, no network. Persistence is a single
// JSON localStorage key; every read/write is guarded so private mode, disabled
// storage, corrupt payloads, and non-browser environments (tests, SSR) all
// degrade to "no profiles" instead of throwing.

// Storage key follows the app's existing namespace precedent
// ('cheo:privacyDisclosureAck' in App.jsx).
export const PROFILES_STORAGE_KEY = 'cheo:thresholdProfiles'

// Sensible caps: enough for any realistic portfolio, small enough that the
// dropdown and the stored JSON stay trivial.
export const MAX_PROFILES = 20
export const MAX_PROFILE_NAME_LENGTH = 60

// The Variance-Detail fields a profile snapshots (App's DEFAULT_VARIANCE keys).
const PROFILE_SETTINGS_FIELDS = ['dollarThreshold', 'percentThreshold']

// Canonical profile name: trimmed, capped, re-trimmed (the cap can expose
// trailing whitespace). '' means "not a usable name".
export function cleanProfileName(name) {
  return String(name ?? '')
    .trim()
    .slice(0, MAX_PROFILE_NAME_LENGTH)
    .trim()
}

// Snapshot just the profiled fields, as strings — the same representation the
// Variance-Detail form holds, so applying a profile writes exactly what typing
// the numbers would have.
function profileSettings(settings) {
  const src = settings && typeof settings === 'object' ? settings : {}
  const out = {}
  for (const key of PROFILE_SETTINGS_FIELDS) {
    const v = src[key]
    out[key] = v === null || v === undefined ? '' : String(v)
  }
  return out
}

// --- Persistence ------------------------------------------------------------

// Read the saved profile list. Anything unexpected — no storage object (Node,
// SSR), storage that throws (private mode), a corrupt/non-array payload, junk
// entries inside an otherwise valid array — yields a clean result rather than
// an exception: junk entries are dropped, everything else falls back to [].
// Entries are re-sanitized on the way in (names cleaned, settings reduced to
// the profiled fields, case-insensitive duplicates dropped, list capped) so a
// hand-edited or stale payload can never smuggle a bad shape into the app.
export function loadProfiles() {
  try {
    const storage = globalThis.localStorage
    if (!storage) return []
    const raw = storage.getItem(PROFILES_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const out = []
    const seen = new Set()
    for (const entry of parsed) {
      if (out.length >= MAX_PROFILES) break
      if (!entry || typeof entry !== 'object') continue
      const name = cleanProfileName(entry.name)
      if (!name) continue
      const key = name.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ name, settings: profileSettings(entry.settings) })
    }
    return out
  } catch {
    return []
  }
}

// Persist the list. Returns true on success; false when storage is missing or
// throws (quota, private mode) — the in-memory list still works for the
// session either way, so callers never need to surface this.
export function saveProfiles(list) {
  try {
    const storage = globalThis.localStorage
    if (!storage) return false
    storage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(Array.isArray(list) ? list : []))
    return true
  } catch {
    return false
  }
}

// --- List edits (pure) -------------------------------------------------------

// Add or update a profile. Names are trimmed/capped and unique
// case-insensitively: saving "1045 sansome" over "1045 Sansome" REPLACES it
// (adopting the new casing) rather than duplicating. A rejected edit (blank
// name, or a brand-new name past the MAX_PROFILES cap) returns the input list
// unchanged — same reference, so callers can detect rejection cheaply.
export function upsertProfile(list, name, settings) {
  const profiles = Array.isArray(list) ? list : []
  const clean = cleanProfileName(name)
  if (!clean) return profiles
  const profile = { name: clean, settings: profileSettings(settings) }
  const key = clean.toLowerCase()
  const idx = profiles.findIndex(
    (p) => p && typeof p.name === 'string' && p.name.toLowerCase() === key
  )
  if (idx >= 0) {
    const next = profiles.slice()
    next[idx] = profile
    return next
  }
  if (profiles.length >= MAX_PROFILES) return profiles
  return [...profiles, profile]
}

// Remove by name, case-insensitively. Unknown name → the input list unchanged
// (same reference).
export function removeProfile(list, name) {
  const profiles = Array.isArray(list) ? list : []
  const key = cleanProfileName(name).toLowerCase()
  if (!key) return profiles
  const next = profiles.filter(
    (p) => !(p && typeof p.name === 'string' && p.name.toLowerCase() === key)
  )
  return next.length === profiles.length ? profiles : next
}

// --- Auto-match --------------------------------------------------------------
// When a base report finishes extracting, the right profile can usually be
// inferred: the property name appears in the FILENAME ("1045 Sansome May
// Variance.pdf") or in the report's leading METADATA rows (real statements
// print the property above the table). The rule, fully deterministic:
//
//   1. Normalize everything — lowercase, punctuation → spaces — into tokens.
//   2. A profile is a candidate when ALL of its significant name tokens appear
//      among the filename tokens + the text cells of the first MATCH_ROW_LIMIT
//      rows. (Stop-words and 1-letter tokens are not significant — "The 350"
//      must not match on "the".)
//   3. Most matched tokens wins; equal token counts fall back to the longer
//      combined token text ("350 RI North" beats "350 RI" but loses nothing to
//      it). A genuine tie between different profiles is ambiguous → NO match,
//      because silently applying the wrong property's thresholds is worse than
//      applying none.
//
// Never throws — junk input of any shape returns null.

// How many leading rows to scan for the property name. Report metadata
// (database, property, basis, period stamps) lives in the first few rows;
// scanning further would start matching on account descriptions.
const MATCH_ROW_LIMIT = 15

// Tokens too generic to identify a property on their own.
const STOP_TOKENS = new Set(['the', 'a', 'an', 'and', 'of', 'at', 'llc', 'lp', 'inc', 'co'])

function tokenize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean)
}

// A profile name's identifying tokens: normalized, de-duplicated, stop-words
// and single letters dropped (bare digits like a building number "5" stay —
// they carry real signal alongside a street token).
function significantTokens(name) {
  const seen = new Set()
  for (const t of tokenize(name)) {
    if (STOP_TOKENS.has(t)) continue
    if (t.length < 2 && !/^\d$/.test(t)) continue
    seen.add(t)
  }
  return [...seen]
}

// Every token visible to the matcher: the filename plus the text cells of the
// first MATCH_ROW_LIMIT rows. Rows may be arrays of cells or bare values;
// only string/number cells contribute (dates, objects, nulls are skipped).
function haystackTokens({ fileName, rows } = {}) {
  const tokens = new Set()
  for (const t of tokenize(fileName)) tokens.add(t)
  const scan = Array.isArray(rows) ? rows.slice(0, MATCH_ROW_LIMIT) : []
  for (const row of scan) {
    const cells = Array.isArray(row) ? row : [row]
    for (const cell of cells) {
      if (typeof cell !== 'string' && typeof cell !== 'number') continue
      for (const t of tokenize(cell)) tokens.add(t)
    }
  }
  return tokens
}

// Pick the profile the base file belongs to, or null. See the rule above.
export function matchProfile(list, source) {
  try {
    const profiles = Array.isArray(list) ? list : []
    if (!profiles.length) return null
    const hay = haystackTokens(source && typeof source === 'object' ? source : {})
    if (!hay.size) return null

    let best = null
    let bestTokens = 0
    let bestLength = 0
    let tied = false
    for (const profile of profiles) {
      if (!profile || typeof profile.name !== 'string') continue
      const tokens = significantTokens(profile.name)
      if (!tokens.length) continue
      if (!tokens.every((t) => hay.has(t))) continue
      const length = tokens.join('').length
      if (tokens.length > bestTokens || (tokens.length === bestTokens && length > bestLength)) {
        best = profile
        bestTokens = tokens.length
        bestLength = length
        tied = false
      } else if (tokens.length === bestTokens && length === bestLength) {
        tied = true
      }
    }
    return tied ? null : best
  } catch {
    return null
  }
}

// The row source matchProfile should scan for an extraction record. The RAW
// grid (extracted.tables[0].rows) still carries the leading report-metadata
// rows where the property name lives; the normalizer deliberately drops those
// before the header (normalize.js, Phase 13B), so `normalized.rows` is only a
// fallback. Never throws; junk → [].
export function rowsForMatch(extraction) {
  try {
    const raw =
      extraction && extraction.extracted && Array.isArray(extraction.extracted.tables)
        ? extraction.extracted.tables[0] && extraction.extracted.tables[0].rows
        : null
    if (Array.isArray(raw) && raw.length) return raw
    const normalized = extraction && extraction.normalized && extraction.normalized.rows
    return Array.isArray(normalized) ? normalized : []
  } catch {
    return []
  }
}

// The one notice line the UI shows on an auto-match. Kept here so the exact
// wording is unit-tested alongside the rule that produces it.
export function appliedProfileNotice(name) {
  return `Applied profile '${name}' for this property.`
}
