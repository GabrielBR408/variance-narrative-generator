import React from 'react'
import { STYLE_ACTIVE_FIELDS } from '../lib/uiControls.js'

// --- Style panel — Phase 23 (Style controls) ------------------------------
// Every Style control is now active and wired into the generated narrative.
// Four render as dropdowns (Report Style, Tone, Length, Dollar Value
// References); "Abbreviate Dollar Values" renders as a checkbox toggle. The
// selections live in App state (DEFAULT_STYLE) and flow to the LLM as plain-
// English style instructions, plus a deterministic dollar-abbreviation pass on
// the finished narrative. The control list lives in src/lib/uiControls.js so the
// panel and the tests share one source. (The earlier reader-segment and
// commentary-level dropdowns were removed — UI, state, and request wiring.)

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
        {STYLE_ACTIVE_FIELDS.map((f) =>
          f.type === 'toggle' ? (
            <label className="field field--toggle" key={f.key}>
              <span className="field-label">{f.label}</span>
              <input
                className="field-toggle"
                type="checkbox"
                checked={!!style[f.key]}
                onChange={(e) => set(f.key, e.target.checked)}
              />
            </label>
          ) : (
            <label className="field" key={f.key}>
              <span className="field-label">{f.label}</span>
              <select className="field-control" value={style[f.key]} onChange={(e) => set(f.key, e.target.value)}>
                {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
          )
        )}
      </div>
    </details>
  )
}
