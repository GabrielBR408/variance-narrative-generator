// --- Root hub (chiefeotool.com/) ------------------------------------------
// A simple, clean landing page: a list of tool buttons. Adding another tool is a
// one-line entry in TOOLS below — no layout work. External tools (e.g. the GL
// Down Driller, hosted as its own Vercel project) are reached through the
// vercel.json rewrites; an in-app tool would link to its SPA route (e.g. /vng).

import React from 'react'
import chiefeoLogo from '../assets/chiefeo-logo.png'

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
    label: 'Owner Report Generator',
    href: '/orgen',
    desc: 'Monthly owner report: cover, income statement w/ commentary, balance sheet & cash flow, backups.'
  }
]

export default function Hub() {
  return (
    <main className="page hub">
      <img className="brand-logo" src={chiefeoLogo} alt="ChiefEO" />
      <h1 className="hub-title">ChiefEO Tools</h1>
      <p className="hub-tagline">Pick a tool.</p>

      <div className="hub-tools">
        {TOOLS.map((t) => (
          <a key={t.href} className="hub-tool" href={t.href}>
            <span className="hub-tool-label">{t.label}</span>
            <span className="hub-tool-desc">{t.desc}</span>
          </a>
        ))}
      </div>
    </main>
  )
}
