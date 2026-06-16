// Phase 21.2 metrics — GL detail render-safety funnel.
// Pure, dependency-free. Runs the Phase 21.1 reconstruction over a corpus of
// REAL MRI Description blobs (captured from `4. General Ledger.pdf`), then the
// Phase 21.2 render-safety selector, and reports the funnel:
//   reconstructed vendor/memo (21.1)  →  render-safe vendor/memo (21.2)
// plus top accepted vendors, top rejection reasons, and accept/reject examples.
//
// Run: node scripts/phase-21-2-metrics.mjs

import { reconstructDetail } from '../src/lib/enrich/reconstructDetail.js'
import { selectDetailEvidence } from '../src/lib/enrich/detailEvidence.js'

// Real captured MRI GL Description blobs (Vendor column came back empty). This
// mirrors the spread the live ledger produces: clean vendors, fused codes,
// stray amounts, page-header bleed, generic one-word names, and accruals.
const CORPUS = [
  { account: '54110 Real Estate Taxes', desc: '1304 4/7/2026 0134 001 2nd Installment 25-26 SAN FRANCISCO TAX COLLECTOR' },
  { account: '54110 Real Estate Taxes', desc: '1305 4/7/2026 0134 032 2nd Installment 25-26 SAN 3,615.91 FRANCISCO TAX COLLECTOR General Ledger' },
  { account: '51252 Janitorial Supplies', desc: '3506 4/26 Janitorial supply TRINITY BUILDING SERVICES' },
  { account: '51252 Janitorial Supplies', desc: '3507 4/26 Janitorial supply TRINITY BUILDING SERVICES' },
  { account: '51013 Utility-Elect-Building', desc: '1315 4/20/2026 2/9-3/10/26 7867 Elec & gas PG&E' },
  { account: '51153 HVAC-Repairs', desc: '1302 4/6/2026 3/26 HVAC Repair BAY CITY MECHANICAL SERVICE LLC' },
  { account: '51501 Plumbing Repairs', desc: "1326 4/27/2026 8/25 Plumbing rx (remaining) HEISE'S PLUMBING" },
  { account: '51256 Trash Removal', desc: '1310 4/20/2026 3/26 Trash svc RECOLOGY GOLDEN GATE' },
  { account: '51301 Landscaping Contract', desc: '1303 4/6/2026 4/26 Landscaping Contract FOLIATE LLC' },
  { account: '51051 Security Contract', desc: '1298 4/6/2026 3/26 Security Svc ARMADA SECURITY' },
  { account: '51020 Utility-Building Water', desc: '1311 4/20/2026 3/26 Water svc SFPUC WATER DEPT' },
  { account: '51055 Pest Control', desc: '1299 4/6/2026 3/26 Pest control CRANE PEST CONTROL' },
  { account: '51160 Building Repairs', desc: '1330 4/28/2026 4/26 Repair PAC INTEGRATIONS' },
  { account: '54210 Franchise Tax', desc: '1340 4/29/2026 0134 2025 FRANCHISE TAX BOARD' },
  { account: '54110 Real Estate Taxes', desc: '04/26 Property Insurance Expense' },
  { account: '40460 Lease Term Concessions', desc: 'Rentup CON Lease Term Concession' },
  { account: '51999 Misc', desc: '1350 4/30/2026 0134 Service' },
  { account: '51999 Misc', desc: '1351 4/30/2026 IPA' },
  { account: '51160 Building Repairs', desc: '1360 5/1/2026 4/26 Repair TWO ONE WORKPLACE L.FERRARI' },
  { account: '51252 Janitorial Supplies', desc: '3520 4/27 INV 88421 Janitorial supply TRINITY BUILDING SERVICES' }
]

function pct(n, d) {
  return d === 0 ? '0%' : `${((n / d) * 100).toFixed(0)}%`
}

const rows = CORPUS.map(({ account, desc }) => {
  const reconstructed = reconstructDetail({ vendor: '', description: desc, account })
  const evidence = selectDetailEvidence({ reconstructed, account })
  return { account, desc, reconstructed, evidence }
})

const total = rows.length
const reconVendor = rows.filter((r) => r.reconstructed.vendor != null).length
const reconMemo = rows.filter((r) => r.reconstructed.cleanMemo != null).length
const safeVendor = rows.filter((r) => r.evidence.vendorRenderable).length
const safeMemo = rows.filter((r) => r.evidence.memoRenderable).length

const acceptedVendors = {}
for (const r of rows) {
  if (r.evidence.vendorRenderable) acceptedVendors[r.evidence.vendor] = (acceptedVendors[r.evidence.vendor] || 0) + 1
}
const reasonCounts = {}
for (const r of rows) {
  for (const reason of r.evidence.rejectionReasons) reasonCounts[reason] = (reasonCounts[reason] || 0) + 1
}
const confDist = {}
for (const r of rows) confDist[r.evidence.evidenceConfidence] = (confDist[r.evidence.evidenceConfidence] || 0) + 1

const sortDesc = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1])

console.log('=== Phase 21.2 — GL Detail Render-Safety Funnel ===')
console.log(`Corpus: ${total} real MRI Description blobs\n`)
console.log('Funnel:')
console.log(`  Reconstructed vendor (21.1):  ${reconVendor}/${total} (${pct(reconVendor, total)})`)
console.log(`  Render-safe vendor   (21.2):  ${safeVendor}/${total} (${pct(safeVendor, total)})`)
console.log(`  Reconstructed memo   (21.1):  ${reconMemo}/${total} (${pct(reconMemo, total)})`)
console.log(`  Render-safe memo     (21.2):  ${safeMemo}/${total} (${pct(safeMemo, total)})`)
console.log(`\nEvidence confidence: ${sortDesc(confDist).map(([k, v]) => `${k} ${v}`).join(' · ')}`)

console.log('\nTop accepted vendors:')
for (const [v, n] of sortDesc(acceptedVendors).slice(0, 8)) console.log(`  ${n}×  ${v}`)

console.log('\nTop rejection reasons:')
for (const [reason, n] of sortDesc(reasonCounts).slice(0, 8)) console.log(`  ${n}×  ${reason}`)

console.log('\nExamples — ACCEPTED:')
for (const r of rows.filter((x) => x.evidence.vendorRenderable || x.evidence.memoRenderable).slice(0, 5)) {
  console.log(`  vendor=${JSON.stringify(r.evidence.vendor)} memo=${JSON.stringify(r.evidence.memo)} conf=${r.evidence.evidenceConfidence}`)
  console.log(`    ← ${r.desc}`)
}

console.log('\nExamples — REJECTED:')
for (const r of rows.filter((x) => !x.evidence.vendorRenderable && !x.evidence.memoRenderable)) {
  console.log(`  reasons=[${r.evidence.rejectionReasons.join(', ')}] conf=${r.evidence.evidenceConfidence}`)
  console.log(`    ← ${r.desc}`)
}
