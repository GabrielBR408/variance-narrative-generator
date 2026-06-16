import React from 'react'

const FIELDS = [
  { key: 'audience', label: 'Audience', options: ['Owner', 'Asset Manager', 'Internal'] },
  { key: 'reportStyle', label: 'Report Style', options: ['Executive', 'Detailed', 'Narrative'] },
  { key: 'tone', label: 'Tone', options: ['Neutral', 'Formal', 'Plain'] },
  { key: 'length', label: 'Length', options: ['Standard', 'Brief', 'Expanded'] },
  // Phase 21.3: opt-in detailed GL commentary. Conservative (default) keeps the
  // current owner-facing output; Detailed may add a sanitized vendor/memo phrase.
  { key: 'commentaryDetail', label: 'Commentary detail', options: ['Conservative', 'Detailed'] }
]

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
        {FIELDS.map((f) => (
          <label className="field" key={f.key}>
            <span className="field-label">{f.label}</span>
            <select className="field-control" value={style[f.key]} onChange={(e) => set(f.key, e.target.value)}>
              {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
        ))}

        <label className="field field--check">
          <input
            type="checkbox"
            checked={style.learnFromUploads}
            onChange={(e) => set('learnFromUploads', e.target.checked)}
          />
          <span className="field-label">Learn from uploaded reports</span>
        </label>

        <label className="field field--col">
          <span className="field-label">Optional notes</span>
          <textarea
            className="field-control field-control--area"
            rows={3}
            placeholder="Anything specific you want reflected in the narrative."
            value={style.notes}
            onChange={(e) => set('notes', e.target.value)}
          />
        </label>
      </div>
    </details>
  )
}
