// --- GL detail evidence selection — Phase 21.2 ----------------------------
// A pure, post-reconstruction layer that decides whether the reconstructed
// vendor / memo metadata (Phase 21.1) is SAFE to render in a future detailed
// mode. It changes NOTHING that owners see today: it only reads the existing
// reconstructed metadata and emits an additive `detailEvidence` verdict. No
// template reads it, so narrative output is byte-identical.
//
// Architecture (the approved pipeline position):
//   extract → match → summarize → reconstruct (21.1) → SELECT (21.2) → [future render]
//
// Phase 21.1 recovers a best-effort { vendor, cleanMemo } from the dirty GL
// Description blob. That layer is intentionally permissive (raw recovery), so
// some recovered fields still carry codey fragments, generic one-word names, or
// stray tokens. This module is the GATE: it applies reject-on-doubt sanitation
// and renderability scoring on top, WITHOUT mutating the reconstructed input.
//
// Output contract (exactly these fields):
//   { vendorRenderable, memoRenderable, vendor, memo, evidenceConfidence,
//     rejectionReasons }
//   - vendor / memo are the render-safe strings (null when not renderable)
//   - evidenceConfidence ∈ 'high' | 'medium' | 'low' | 'none'
//   - rejectionReasons is a deterministic list of '<field>:<reason>' codes
//
// Hard rules: pure & deterministic; reject-on-doubt; never let a date,
// reference/check number, dollar amount, page-header bleed, long numeric code,
// or raw account code survive into a renderable field; reject generic one-word
// vendors; reject generic memos unless paired with a high-confidence vendor;
// enforce length caps; NEVER mutate the reconstructed metadata.

import { DATE_RE, REFERENCE_RE, MONEY_RE, PAGE_BLEED_RE } from './sanitationPatterns.js'

// Render-safety length caps (mirror the Phase 21.1 reconstruction caps; we
// re-check here so the gate is self-contained and reject-on-doubt).
export const VENDOR_RENDER_MAX_LEN = 40
export const MEMO_RENDER_MAX_LEN = 60

// Forbidden tokens that must never survive into a renderable vendor or memo.
// The date/reference/money/page-bleed patterns are the shared render-safety set
// (see sanitationPatterns.js); imported so this gate and reconstructDetail.js
// can never drift apart.
// A long digit run (≥4) is a code, check number, or stray ID — never a name.
const LONG_CODE_RE = /\d{4,}/

// Generic vendor names that carry no owner value on their own (whole-string,
// case-insensitive). These slip through the raw recovery layer but must not be
// shown as if they were a real vendor.
const GENERIC_VENDOR = new Set(['service', 'services', 'ipa', 'account', 'general ledger', 'expense', 'accrual'])

// Generic memo words. A memo built ENTIRELY from these reduces to noise and is
// rejected — UNLESS it is paired with a high-confidence renderable vendor, in
// which case "Invoice" / "Payment" beside a real vendor is acceptable context.
const GENERIC_MEMO = new Set(['service', 'services', 'expense', 'accrual', 'invoice', 'payment'])

// Pull the leading account code (e.g. "54110" from "54110 Real Estate Taxes")
// so we can reject a field that merely echoes the raw account number.
function accountCodeOf(account) {
  const m = String(account || '').match(/^\s*(\d{3,})\b/)
  return m ? m[1] : null
}

// Collect the deterministic forbidden-content rejection reasons for one field.
function forbiddenReasons(value, accountCode, field) {
  const s = String(value)
  const reasons = []
  if (DATE_RE.test(s)) reasons.push(`${field}:date`)
  if (REFERENCE_RE.test(s)) reasons.push(`${field}:reference`)
  if (MONEY_RE.test(s)) reasons.push(`${field}:money`)
  if (PAGE_BLEED_RE.test(s)) reasons.push(`${field}:page-bleed`)
  if (LONG_CODE_RE.test(s)) reasons.push(`${field}:long-code`)
  if (accountCode && new RegExp(`\\b${accountCode}\\b`).test(s)) reasons.push(`${field}:account-code`)
  return reasons
}

function isGenericVendor(vendor) {
  return GENERIC_VENDOR.has(String(vendor).trim().toLowerCase().replace(/[.,]+$/, ''))
}

// A memo is generic when EVERY word in it is a generic memo word.
function isGenericMemo(memo) {
  const tokens = String(memo)
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z&]/g, ''))
    .filter(Boolean)
  return tokens.length > 0 && tokens.every((t) => GENERIC_MEMO.has(t))
}

// Select render-safe evidence from a Phase 21.1 reconstructed summary. Pure:
// reads the reconstructed metadata (and the account name, for the raw-account-
// code guard) and never mutates either. `contribution` is accepted for forward
// compatibility but is not required — selection is string-quality only.
export function selectDetailEvidence({ reconstructed = null, contribution = null, account = '' } = {}) { // eslint-disable-line no-unused-vars -- contribution reserved by the approved input contract
  const r = reconstructed || {}
  const vendorIn = r.vendor != null ? String(r.vendor).trim() : ''
  const memoIn = r.cleanMemo != null ? String(r.cleanMemo).trim() : ''
  const sourceConfidence = String(r.extractionConfidence || 'none')
  const accountCode = accountCodeOf(account)

  const rejectionReasons = []

  // --- vendor gate (evaluated first; the memo gate may depend on it) ---------
  let vendorRenderable = false
  let vendorOut = null
  if (vendorIn) {
    const reasons = forbiddenReasons(vendorIn, accountCode, 'vendor')
    if (vendorIn.length > VENDOR_RENDER_MAX_LEN) reasons.push('vendor:length')
    if (isGenericVendor(vendorIn)) reasons.push('vendor:generic')
    if (reasons.length === 0) {
      vendorRenderable = true
      vendorOut = vendorIn
    } else {
      rejectionReasons.push(...reasons)
    }
  }

  // --- memo gate -------------------------------------------------------------
  // A high-confidence vendor "pairs" the memo: it lets an otherwise-generic
  // memo (e.g. "Invoice") through as supporting context. Requires both a
  // render-safe vendor AND a high-confidence reconstruction source.
  const pairedWithHighConfVendor = vendorRenderable && sourceConfidence === 'high'
  let memoRenderable = false
  let memoOut = null
  if (memoIn) {
    const reasons = forbiddenReasons(memoIn, accountCode, 'memo')
    if (memoIn.length > MEMO_RENDER_MAX_LEN) reasons.push('memo:length')
    if (isGenericMemo(memoIn) && !pairedWithHighConfVendor) reasons.push('memo:generic-unpaired')
    if (reasons.length === 0) {
      memoRenderable = true
      memoOut = memoIn
    } else {
      rejectionReasons.push(...reasons)
    }
  }

  // --- evidence confidence (deterministic) -----------------------------------
  //   none   — nothing was reconstructed to evaluate
  //   high   — vendor AND memo both render-safe from a high-confidence source
  //   medium — at least one field render-safe
  //   low    — candidates existed but every one was rejected
  let evidenceConfidence
  if (!vendorIn && !memoIn) evidenceConfidence = 'none'
  else if (vendorRenderable && memoRenderable && sourceConfidence === 'high') evidenceConfidence = 'high'
  else if (vendorRenderable || memoRenderable) evidenceConfidence = 'medium'
  else evidenceConfidence = 'low'

  return {
    vendorRenderable,
    memoRenderable,
    vendor: vendorOut,
    memo: memoOut,
    evidenceConfidence,
    rejectionReasons
  }
}
