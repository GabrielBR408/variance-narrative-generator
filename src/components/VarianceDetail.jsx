import React from 'react'

const INCLUDE = [
  { key: 'glResearch', label: 'GL Research' },
  { key: 'suggestedCauses', label: 'Suggested Causes' },
  { key: 'questions', label: 'Questions' },
  { key: 'priorComparison', label: 'Prior Comparison' }
]
const IGNORE = [
  { key: 'zeroVariances', label: 'Zero Variances' },
  { key: 'smallRepeatItems', label: 'Small Repeat Items' }
]

export default function VarianceDetail({ variance, setVariance }) {
  const set = (key, value) => setVariance((prev) => ({ ...prev, [key]: value }))
  const toggle = (group, key) =>
    setVariance((prev) => ({ ...prev, [group]: { ...prev[group], [key]: !prev[group][key] } }))

  return (
    <details className="step step--panel">
      <summary>
        <span className="step-eyebrow">Step 3</span>
        <span className="step-title">Variance Detail</span>
        <span className="step-note">Control what gets discussed.</span>
      </summary>
      <div className="panel-body">
        <label className="field">
          <span className="field-label">Threshold Logic</span>
          <select className="field-control" value={variance.thresholdLogic} onChange={(e) => set('thresholdLogic', e.target.value)}>
            <option value="AND">AND</option>
            <option value="OR">OR</option>
          </select>
        </label>

        <label className="field">
          <span className="field-label">Dollar Threshold</span>
          <input
            className="field-control"
            type="number"
            min="0"
            step="500"
            value={variance.dollarThreshold}
            onChange={(e) => set('dollarThreshold', e.target.value)}
          />
        </label>

        <label className="field">
          <span className="field-label">Percentage Threshold</span>
          <input
            className="field-control"
            type="number"
            min="0"
            max="100"
            step="1"
            value={variance.percentThreshold}
            onChange={(e) => set('percentThreshold', e.target.value)}
          />
        </label>

        <label className="field">
          <span className="field-label">Narrative Detail</span>
          <select className="field-control" value={variance.narrativeDetail} onChange={(e) => set('narrativeDetail', e.target.value)}>
            <option value="Standard">Standard</option>
            <option value="Concise">Concise</option>
            <option value="Thorough">Thorough</option>
          </select>
        </label>

        <fieldset className="checkgroup">
          <legend>Include</legend>
          {INCLUDE.map((c) => (
            <label className="field field--check" key={c.key}>
              <input type="checkbox" checked={variance.include[c.key]} onChange={() => toggle('include', c.key)} />
              <span className="field-label">{c.label}</span>
            </label>
          ))}
        </fieldset>

        <fieldset className="checkgroup">
          <legend>Ignore</legend>
          {IGNORE.map((c) => (
            <label className="field field--check" key={c.key}>
              <input type="checkbox" checked={variance.ignore[c.key]} onChange={() => toggle('ignore', c.key)} />
              <span className="field-label">{c.label}</span>
            </label>
          ))}
        </fieldset>
      </div>
    </details>
  )
}
