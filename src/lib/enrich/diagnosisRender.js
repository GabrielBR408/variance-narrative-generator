// --- Diagnosis consumption — NQ-5B (first visible diagnosis rendering) ------
// Turns the NQ-5A/5A.1 diagnosis metadata into ONE owner-facing explanation
// sentence (S2), for a small allow-list of natures. This is the only place a
// diagnosis influences rendered text. It is deliberately separate from
// templates.js (which is NOT modified): NQ-5B augments wording without touching
// the existing template engine, the planner, exports, sections, variance math,
// or matching.
//
// Hard boundaries (carried from the rest of enrichment):
//   • Augments wording only — the variance observation sentence (S1, with its
//     dollar/percent figures) is preserved verbatim by the caller; this module
//     only supplies the replacement S2.
//   • Fixed, owner-approved sentences: NO figures, NO vendor/file names, NO
//     causal or certainty language. Each is a single sentence (S1 + S2 ≤ 2).
//   • Gated by confidence: only 'high' or 'medium' diagnoses render; 'low' (or
//     absent) → null, so the caller keeps the exact legacy wording.
//   • Only the four approved natures render; every other nature → null (legacy).
//
// Pure and deterministic: same diagnosis → same sentence. Reads nothing but the
// diagnosis object.

// The owner wording per renderable nature (NQ-5B approved copy). One sentence
// each; causation-free by construction.
const NATURE_SENTENCE = {
  OFFSET_TIMING:
    'Related account activity appears broader than the reported variance, suggesting offsetting entries, timing, or account-level movement also affected the result.',
  MAPPING_PASSTHROUGH:
    'Recoveries or billbacks may lag expense recognition and should be reviewed against tenant recovery billing.',
  TIMING_PHASING:
    'Budgeted activity did not post during the period, suggesting a timing difference or deferred work rather than permanent savings.',
  ACCRUAL_TRUEUP:
    'Recorded activity appears consistent with accrual timing, reversals, or correcting entries rather than recurring operating activity.'
}

// Belt-and-suspenders reject net: never emit causal/certainty language even if
// the copy table is edited later. Mirrors the guards in templates.js /
// commentaryIntent.js.
const CAUSAL_RE =
  /\b(caused by|due to|because of|driven by|drove|resulting from|result of|attributable to|will|definitely|certainly|must)\b/i

// Only render when the diagnosis is confident enough to speak.
function confident(confidence) {
  return confidence === 'high' || confidence === 'medium'
}

// The owner S2 for a diagnosis, or null to keep the legacy wording. Null whenever
// the diagnosis is absent, its nature is outside the approved set, its confidence
// is below medium, or (defensively) the copy ever tripped the causal guard.
export function diagnosisSentence(diagnosis) {
  if (!diagnosis || typeof diagnosis !== 'object') return null
  if (!confident(diagnosis.confidence)) return null
  const sentence = NATURE_SENTENCE[diagnosis.nature]
  if (!sentence) return null
  if (CAUSAL_RE.test(sentence)) return null
  return sentence
}

// The set of natures NQ-5B renders, exported for tests/tooling.
export const RENDERABLE_NATURES = Object.freeze(Object.keys(NATURE_SENTENCE))
