// --- UI control inventory — Phase 23 (Style controls) ---------------------
// Single source of truth for which Style / Variance controls are ACTIVE (wired to
// real output) versus shown-but-disabled ("Coming soon"). Kept as pure data (no
// JSX) so the panels and the test suite read the exact same lists and can never
// drift. Removed controls (Audience, Learn-from-uploads, free-text Notes,
// Narrative Detail, Commentary detail) are intentionally absent here and from the
// panels/state/request wiring.

// Active Style controls — Phase 23. All five shape the LLM style instructions
// (see server/llm.js buildStyleInstructions). Each carries a `type`: 'select'
// renders as a dropdown; 'toggle' renders as a checkbox (On/Off). Order here is
// the render order in the Style panel.
export const STYLE_ACTIVE_FIELDS = [
  { key: 'reportStyle', label: 'Report Style', type: 'select', options: ['Concise', 'Detailed'] },
  { key: 'tone', label: 'Tone', type: 'select', options: ['Neutral', 'Cautious'] },
  { key: 'length', label: 'Length', type: 'select', options: ['Brief', 'Standard', 'Verbose'] },
  { key: 'abbreviateDollars', label: 'Abbreviate Dollar Values', type: 'toggle' },
  { key: 'dollarReferences', label: 'Dollar Value References', type: 'select', options: ['Minimum', 'Detail'] }
]

// No Style controls are deferred anymore — every Style control is active.
export const STYLE_COMING_SOON_FIELDS = []

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
