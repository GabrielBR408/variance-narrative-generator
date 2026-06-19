// --- Commentary detail mode — Phase 21.4 / Fix B --------------------------
// Single source of truth for the app's commentary detail level. Phase 21.4 made
// DETAILED the normal output (the conservative phrasing was too basic); the
// conservative/concise level stays selectable through the active Style panel.
//
// Fix B (wiring): the active Style panel exposes `reportStyle` ('Concise' |
// 'Detailed') — see src/lib/uiControls.js STYLE_ACTIVE_FIELDS. The old control
// (`commentaryDetail`) was removed in Phase 23 but this mapper kept reading it,
// so it ALWAYS resolved to 'detailed' and the Report Style selection never
// reached the deterministic narrative. We now read `reportStyle` directly:
//   Concise  → 'conservative'  (tight, single-statement evidence wording)
//   Detailed → 'detailed'      (fuller explanation per variance)
//
// Pure and dependency-free so it can be imported by both the React app and tests
// without pulling in JSX. The enrichment library (enrichNarrative) keeps its own
// backward-compatible default of 'conservative' for programmatic callers; the
// APP resolves Detailed by default through this helper.

// The default Style-panel report style (matches App DEFAULT_STYLE.reportStyle).
export const DEFAULT_COMMENTARY_DETAIL = 'Detailed'

// Map the active Style panel's `reportStyle` to an enrichment `mode`. A
// 'Concise' report style resolves to the conservative (terser) commentary;
// anything else — including a missing/unknown style — resolves to detailed, so
// the app's default behavior is preserved.
export function commentaryModeFromStyle(style) {
  return style && style.reportStyle === 'Concise' ? 'conservative' : 'detailed'
}
