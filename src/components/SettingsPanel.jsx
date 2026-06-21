import React, { useId, useState } from 'react'

// --- Settings & instructions — minimal-default-layout phase ----------------
// A single, real disclosure panel that holds everything that is NOT part of the
// minimal default view (all Style/Variance controls, the upload guidance, and
// the live previews). It is collapsed on first load so the default page shows
// only the upload area and Generate.
//
// This is a button-triggered disclosure (not a native <details>) so the open
// state is explicit and fully keyboard-accessible: the trigger carries
// aria-expanded / aria-controls and gets a visible focus ring. Children are
// rendered only when open, so a collapsed panel keeps its contents out of the
// DOM. No control state lives here — every control inside is driven by lifted
// state in App, so generation behaves identically whether the panel is open or
// closed.
//
// `defaultOpen` exists purely as a test seam for the static-render harness; the
// app always mounts it collapsed (the default).
export default function SettingsPanel({ title = 'Settings & instructions', defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen)
  const bodyId = useId()

  return (
    <section className="step step--settings">
      <button
        type="button"
        className="settings-toggle"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="settings-toggle-label">{title}</span>
        <span className="settings-toggle-icon" aria-hidden="true">{open ? '–' : '+'}</span>
      </button>

      {open && (
        <div className="settings-body" id={bodyId} role="region" aria-label={title}>
          {children}
        </div>
      )}
    </section>
  )
}
