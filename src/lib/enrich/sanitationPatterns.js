// --- Shared render-safety patterns ----------------------------------------
// Canonical, single-source copies of the "forbidden content" regexes used by
// the render-safety gate (detailEvidence.js) and the detail reconstructor
// (reconstructDetail.js). These two modules previously each defined their own
// copies, which had drifted apart over time; this module is the one place the
// gate's patterns live so the two callers can never silently diverge again.
//
// Scope note: contribution.js deliberately uses BROADER token/description
// filters (a bare-keyword reference matcher plus a long-code clause, and a money
// matcher that also catches a bare "$" or "(<digit"). Those serve a different
// purpose — ranking-time token filtering, not the render-safety reject gate —
// so they are intentionally NOT unified here. Only the truly identical DATE_RE
// is shared with contribution.js.

// A date in m/d, m/d/yy(yy), or ISO yyyy-mm-dd form.
export const DATE_RE = /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b|\b\d{4}-\d{2}-\d{2}\b/

// A bookkeeping reference: a known reference keyword immediately followed by a
// number (inv 123, PO 45, JE7…), or a "#<number>" token.
export const REFERENCE_RE = /\b(inv|invoice|chk|check|ck|ref|po|ap|ar|doc|gs|cm|je)\b\s*\d|#\s*\d/i

// A money figure: "$<digit>" or a thousands/decimal amount like 1,200.00.
export const MONEY_RE = /\$\s*\d|\d[\d,]*\.\d{2}\b/

// "General Ledger" page-header bleed. Two forms for two safe usages of the SAME
// pattern: the plain form for membership tests (.test()), and a global form for
// stripping every occurrence via .replace(). (Using a /g regex with .test() is a
// stateful-lastIndex footgun, so the test form is deliberately non-global.)
export const PAGE_BLEED_RE = /general\s+ledger/i
export const PAGE_BLEED_STRIP_RE = /general\s+ledger/gi
