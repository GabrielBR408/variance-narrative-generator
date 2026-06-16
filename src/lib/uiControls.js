// --- UI control inventory — Phase 22.2 ------------------------------------
// Single source of truth for which Style / Variance controls are ACTIVE (wired to
// real output) versus shown-but-disabled ("Coming soon"). Kept as pure data (no
// JSX) so the panels and the test suite read the exact same lists and can never
// drift. Removed controls (Learn-from-uploads, free-text Notes, Narrative Detail)
// are intentionally absent here and from the panels/state/request wiring.

// Active Style control: changes real output (drives the enrichment commentary mode).
export const STYLE_ACTIVE_FIELDS = [
  { key: 'commentaryDetail', label: 'Commentary detail', options: ['Conservative', 'Detailed'] }
]

// Style controls shown but not yet wired — rendered disabled and tagged "Coming soon".
export const STYLE_COMING_SOON_FIELDS = [
  { key: 'audience', label: 'Audience', options: ['Owner', 'Asset Manager', 'Internal'] },
  { key: 'reportStyle', label: 'Report Style', options: ['Executive', 'Detailed', 'Narrative'] },
  { key: 'tone', label: 'Tone', options: ['Neutral', 'Formal', 'Plain'] },
  { key: 'length', label: 'Length', options: ['Standard', 'Brief', 'Expanded'] }
]

// Variance "Include" filters — planned, not yet wired (disabled, "Coming soon").
export const VARIANCE_INCLUDE_FILTERS = [
  { key: 'glResearch', label: 'GL Research' },
  { key: 'suggestedCauses', label: 'Suggested Causes' },
  { key: 'questions', label: 'Questions' },
  { key: 'priorComparison', label: 'Prior Comparison' }
]

// Variance "Ignore" filters — planned, not yet wired (disabled, "Coming soon").
export const VARIANCE_IGNORE_FILTERS = [
  { key: 'zeroVariances', label: 'Zero Variances' },
  { key: 'smallRepeatItems', label: 'Small Repeat Items' }
]
