// --- GL detail reconstruction — Phase 21.1 --------------------------------
// A post-extraction, pure layer that recovers a structured { vendor, cleanMemo }
// from the single dirty Description blob the GL parser produces, WITHOUT touching
// extraction (extract/pdfTable.js), matching, or the original fields.
//
// On real MRI ledgers the typed Vendor column comes back empty (the layout has
// no Vendor header band), so the vendor name and memo are fused into Description
// alongside line numbers, dates, service-period stamps, codes, stray amounts, and
// "General Ledger" page-header bleed, e.g.:
//   "1304 4/7/2026 0134 001 2nd Installment 25-26 SAN FRANCISCO TAX COLLECTOR"
// This module mines that string deterministically:
//   vendor      → "San Francisco Tax Collector"
//   cleanMemo   → "2nd Installment 25-26"
//
// Hard rules: reconstruct ONLY when the typed vendor is empty; preserve the
// original description verbatim (`originalDescription`); pure & deterministic;
// reject-on-doubt; never let a date / reference / money token / page-bleed
// survive into vendor or memo; cap vendor and memo length. NOTHING here is
// rendered — it only attaches metadata (Phase 21.1 is reconstruction only).

// Tokens that must never survive into a reconstructed vendor or memo — the
// shared render-safety set (see sanitationPatterns.js). PAGE_BLEED_STRIP_RE is
// the global form used for stripping every page-header occurrence below.
import {
  DATE_RE,
  REFERENCE_RE as REFERENCE_LIKE_RE,
  MONEY_RE,
  PAGE_BLEED_STRIP_RE as PAGE_BLEED_RE
} from './sanitationPatterns.js'

export const VENDOR_MAX_LEN = 40
export const MEMO_MAX_LEN = 60

// A corporate / entity suffix that strongly marks the tail of a vendor name.
const SUFFIX_RE = /^(llc|inc|inc\.|co|co\.|corp|corp\.|lp|llp|ltd|ltd\.|company|services?|service|collector|associates|group|systems?|mechanical|plumbing|electric|security|properties|partners)$/i

// A token that belongs to a trailing VENDOR run: ALL-CAPS word (≥2 letters, may
// carry & ' . - / digits), or a known corporate suffix. Lowercase memo words
// (e.g. "Repair", "svc", "supply") are NOT vendor tokens, so the run stops there.
function isVendorToken(tok) {
  const t = String(tok)
  if (SUFFIX_RE.test(t)) return true
  if (!/[A-Z]/.test(t)) return false
  // ALL-CAPS (letters are upper); allow &, ', ., -, /, digits within.
  return /^[A-Z0-9&'./-]+$/.test(t) && /[A-Z]{2,}|&/.test(t)
}

// Deterministic title-casing for a vendor: keep short vowel-less acronyms
// (e.g. "PG&E") and corporate suffixes (LLC/INC) upper; otherwise Word Case.
function titleCaseVendor(s) {
  return String(s)
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      if (/^(LLC|INC|CO|CORP|LP|LLP|LTD)\.?$/i.test(w)) return w.toUpperCase()
      const letters = w.replace(/[^A-Za-z]/g, '')
      // Acronym kept as-is: contains "&" (e.g. PG&E, AT&T) or a short, all-caps,
      // vowel-less token (e.g. IBM, GTE).
      const isAcronym = /[A-Z]/.test(w) && (/&/.test(w) || (letters.length > 0 && letters.length <= 4 && !/[AEIOU]/i.test(letters)))
      if (isAcronym) return w
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    })
    .join(' ')
}

// True when a candidate string is clean enough to render-eligible later (no
// date / reference / money token).
function isClean(s) {
  const t = String(s)
  return !DATE_RE.test(t) && !REFERENCE_LIKE_RE.test(t) && !MONEY_RE.test(t)
}

// Strip the leading bookkeeping prefix the MRI memo region carries: a line
// number, the primary date, service-period stamps, and an "Rentup <CODE>"
// posting marker. Conservative — only removes leading tokens it recognizes.
function stripLeadingNoise(tokens) {
  const out = tokens.slice()
  // Leading line number (1–5 digits).
  if (out.length && /^\d{1,5}$/.test(out[0])) out.shift()
  // Leading "Rentup <2-4 CAPS code>" posting marker.
  if (out.length >= 2 && /^rentup$/i.test(out[0]) && /^[A-Z]{2,4}$/.test(out[1])) out.splice(0, 2)
  // Leading date and short period stamps (m/d, m/d/yyyy, m/d-m/d/yy, mm/dd ranges).
  while (out.length && (DATE_RE.test(out[0]) || /^\d{1,2}\/\d{1,2}(-\d{1,2}\/\d{1,2}(\/\d{2,4})?)?$/.test(out[0]) || /^\d{3,4}$/.test(out[0]))) {
    out.shift()
  }
  return out
}

// Reconstruct { vendor, cleanMemo, extractionConfidence, originalDescription }
// from one matched-account's typed fields. Never mutates its inputs.
export function reconstructDetail({ vendor = '', description = '', reference = '', account = '' } = {}) {
  const originalDescription = String(description)

  // 1. Only mine the description when the typed vendor is empty (the real case).
  //    A provided vendor is preserved untouched — we never overwrite real data.
  //    null / undefined / '' all count as empty (the typed Vendor column is empty
  //    on real MRI ledgers, where summarizeDetail yields `null`).
  if (vendor != null && String(vendor).trim() !== '') {
    return { vendor: String(vendor).trim(), cleanMemo: null, extractionConfidence: 'provided', originalDescription, reconstructed: false }
  }

  // 2. Remove page-header bleed before any parsing.
  const cleaned = originalDescription.replace(PAGE_BLEED_RE, ' ').replace(/\s+/g, ' ').trim()
  if (!cleaned || !/[A-Za-z]/.test(cleaned)) {
    return { vendor: null, cleanMemo: null, extractionConfidence: 'none', originalDescription, reconstructed: false }
  }

  const tokens = cleaned.split(/\s+/)

  // 3. Vendor = trailing run of vendor-ish tokens (≥1), capped to a few words.
  let v = tokens.length
  while (v > 0 && isVendorToken(tokens[v - 1]) && tokens.length - v < 6) v--
  let vendorOut = null
  let memoTokens = tokens
  if (v < tokens.length) {
    // Require at least one of the trailing tokens to be a "real" vendor word
    // (≥3 letters or a suffix) — a lone stray cap is not a vendor.
    const tail = tokens.slice(v)
    const realish = tail.some((t) => SUFFIX_RE.test(t) || t.replace(/[^A-Za-z]/g, '').length >= 3)
    if (realish) {
      const candidate = titleCaseVendor(tail.join(' '))
      if (candidate.length <= VENDOR_MAX_LEN && isClean(candidate)) vendorOut = candidate
      memoTokens = tokens.slice(0, v)
    }
  }

  // 4. Memo = the middle text, with leading bookkeeping noise stripped.
  let memoOut = stripLeadingNoise(memoTokens).join(' ').replace(/\s+/g, ' ').trim()
  if (memoOut.length > MEMO_MAX_LEN) memoOut = memoOut.slice(0, MEMO_MAX_LEN).trim()
  if (!memoOut || !isClean(memoOut) || !/[A-Za-z]/.test(memoOut)) memoOut = null

  // 5. Confidence tier (deterministic):
  //    high   — a vendor with a corporate suffix / known shape AND a clean memo
  //    medium — vendor via caps-tail heuristic OR a clean memo only
  //    low    — neither survived cleanly
  let extractionConfidence
  const vendorHasSuffix = vendorOut && tokens.slice(v).some((t) => SUFFIX_RE.test(t))
  if (vendorOut && memoOut && vendorHasSuffix) extractionConfidence = 'high'
  else if (vendorOut || memoOut) extractionConfidence = 'medium'
  else extractionConfidence = 'low'

  return {
    vendor: vendorOut,
    cleanMemo: memoOut,
    extractionConfidence,
    originalDescription,
    reconstructed: vendorOut != null || memoOut != null
  }
}
