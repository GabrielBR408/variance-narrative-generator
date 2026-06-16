import React from 'react'
import { STYLE_ACTIVE_FIELDS, STYLE_COMING_SOON_FIELDS } from '../lib/uiControls.js'

// --- Style panel — Phase 2 / 22.2 -----------------------------------------
// Only controls that actually affect output are interactive. Commentary detail
// drives the enrichment mode (Conservative vs Detailed). The remaining style
// selects are planned but NOT yet wired, so Phase 22.2 renders them disabled and
// clearly labelled "Coming soon" rather than implying control they don't have.
// (Audience / Report Style / Tone / Length would shape narrative wording, which
// is intentionally deferred.) "Learn from uploads" and the free-text notes field
// were removed entirely — UI, state, and request wiring. The control lists live
// in src/lib/uiControls.js so the panels and the tests share one source.

export default function StylePanel({ style, setStyle }) {
  const set = (key, value) => setStyle((prev) => ({ ...prev, [key]: value }))

  return (
    <details className="step step--panel">
      <summary>
        <span className="step-eyebrow">Step 2</span>
        <span className="step-title">Style</span>
        <span className="step-note">Control how the report reads.</span>
      </summary>
      <div className="panel-body">
        {STYLE_ACTIVE_FIELDS.map((f) => (
          <label className="field" key={f.key}>
            <span className="field-label">{f.label}</span>
            <select className="field-control" value={style[f.key]} onChange={(e) => set(f.key, e.target.value)}>
              {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
        ))}

        {STYLE_COMING_SOON_FIELDS.map((f) => (
          <label className="field field--coming-soon" key={f.key}>
            <span className="field-label">
              {f.label}
              <span className="coming-soon-tag">Coming soon</span>
            </span>
            <select className="field-control" value={f.options[0]} disabled aria-disabled="true">
              {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
        ))}
      </div>
    </details>
  )
}
