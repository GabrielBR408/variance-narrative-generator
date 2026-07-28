// --- Root hub (chiefeotool.com/) ------------------------------------------
// A simple, clean landing page: a list of tool buttons. Adding another tool is a
// one-line entry in TOOLS below — no layout work. External tools (e.g. the GL
// Down Driller, hosted as its own Vercel project) are reached through the
// vercel.json rewrites; an in-app tool would link to its SPA route (e.g. /vng).

import React from 'react'
import chiefeoLogo from '../assets/chiefeo-logo.png'
import { shareHub } from '../lib/share.js'

// One entry per tool button. `href` may be a rewritten external path
// (/downdriller, /orgen) or an in-app route (/vng). Add more here as tools come
// online — nothing else needs to change.
const TOOLS = [
  {
    label: 'GL Down Driller',
    href: '/downdriller',
    desc: 'Drill into general-ledger detail behind a variance.'
  },
  {
    label: 'ChiefEO Inspector',
    href: '/chiefeoinspector',
    desc: 'Talk through a property inspection → auto-drafted, editable report → PDF/Word.'
  },
  {
    label: 'Stacking Plan (Beta)',
    href: '/stacking',
    desc: 'Drop a rent roll → instant stacking plan. Recolor, edit suites, export PNG/PDF/PPTX/Excel.'
  },
  {
    label: 'Variance Narrative Generator (Beta)',
    href: '/vng',
    desc: 'Turns a budget-vs-actual statement into owner-ready variance narratives.'
  },
  {
    label: 'Owner Report Generator (Beta)',
    href: '/orgen',
    desc: 'Compiles monthly owner reports.'
  },
  {
    label: 'Utilities Forecaster (Beta)',
    href: '/utilities-forecaster',
    desc: 'Estimate a building’s annual/monthly utility costs from RSF, tenant mix, and rates — with a formula-driven Excel export.'
  }
]

export default function Hub() {
  // Brief confirmation after a clipboard-fallback copy (or a copy failure).
  // Null hides the toast; a string shows it, auto-dismissing after a moment.
  const [toast, setToast] = React.useState(null)
  const toastTimer = React.useRef(null)

  React.useEffect(() => () => clearTimeout(toastTimer.current), [])

  const flashToast = (msg) => {
    clearTimeout(toastTimer.current)
    setToast(msg)
    toastTimer.current = setTimeout(() => setToast(null), 2400)
  }

  const onShare = async () => {
    // shareHub never throws: native share sheet where available, else copy the
    // link to the clipboard, else no-op. Only the copy paths need a toast — the
    // native sheet and a user-cancel are their own feedback.
    const result = await shareHub()
    if (result === 'copied') flashToast('Link copied')
    else if (result === 'unavailable') flashToast('Copy the link from your browser')
  }

  return (
    <main className="page hub">
      <img className="brand-logo" src={chiefeoLogo} alt="ChiefEO" />
      <h1 className="hub-title">ChiefEO Tool</h1>
      <p className="hub-tagline">Pick a tool.</p>

      <div className="hub-tools">
        {TOOLS.map((t) => (
          <a key={t.href} className="hub-tool" href={t.href}>
            <span className="hub-tool-label">{t.label}</span>
            <span className="hub-tool-desc">{t.desc}</span>
          </a>
        ))}
      </div>

      <div className="hub-share-row">
        <button type="button" className="hub-share" onClick={onShare}>
          <span aria-hidden="true" className="hub-share-icon">⤴</span>
          Share
        </button>
        {toast && (
          <span className="hub-share-toast" role="status">{toast}</span>
        )}
      </div>
    </main>
  )
}
