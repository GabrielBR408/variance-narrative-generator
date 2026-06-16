// --- Commentary detail mode — Phase 21.4 -----------------------------------
// Single source of truth for the app's commentary detail level. Phase 21.4 makes
// DETAILED the normal output (the conservative phrasing was too basic); the
// Conservative level stays selectable in the UI and as a programmatic mode.
//
// Pure and dependency-free so it can be imported by both the React app and tests
// without pulling in JSX. The enrichment library (enrichNarrative) keeps its own
// backward-compatible default of 'conservative' for programmatic callers; the
// APP resolves Detailed by default through this helper.

// The default Style-panel value (label shown in the dropdown).
export const DEFAULT_COMMENTARY_DETAIL = 'Detailed'

// Map a Style-panel value to an enrichment `mode`. Anything other than an
// explicit 'Conservative' resolves to detailed, so a missing/unknown value still
// gives the new default behavior.
export function commentaryModeFromStyle(style) {
  return style && style.commentaryDetail === 'Conservative' ? 'conservative' : 'detailed'
}
