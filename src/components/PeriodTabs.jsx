import React from 'react'

// --- Shared period toggle --------------------------------------------------
// The Current / YTD (and beyond) tablist shown above a multi-period narrative or
// variance table. Extracted so the Variance preview, the Result panel, and the
// Narrative Summary preview all render the exact same markup and behavior.
//
// Props:
//   tabs     — [{ period, label }] in display order
//   active   — the active period key
//   onSelect — (period) => void, called when a tab is clicked
//
// Callers keep their own "only show when more than one period" guard, matching
// the prior behavior where the tablist appeared solely for multi-period results.
export default function PeriodTabs({ tabs, active, onSelect }) {
  return (
    <div className="variance-periods" role="tablist" aria-label="Comparison period">
      {tabs.map((t) => (
        <button
          key={t.period}
          type="button"
          role="tab"
          aria-selected={t.period === active}
          className={`variance-period${t.period === active ? ' variance-period--on' : ''}`}
          onClick={() => onSelect(t.period)}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
