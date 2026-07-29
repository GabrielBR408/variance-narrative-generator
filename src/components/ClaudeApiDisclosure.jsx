import { useEffect, useState } from 'react'

// Compliance Phase 1 — the "your input goes to the Anthropic Claude API"
// notice. VENDORED per repo: each ChiefEO tool is its own codebase, so this
// file has sibling copies in owner-report-generator and chiefeo-inspector.
// Edits here do not propagate — keep the copies in sync by hand.
//
// Informational ONLY. It never gates the action it sits next to: the tool runs
// whether or not the notice has been read or dismissed.
//
// Dismissal has two deliberately different levels:
//   • the X button — in-memory only, so the notice returns on a fresh load
//   • "Don't show again", checked at dismiss time — writes localStorage, so it
//     stays hidden until storage is cleared
// (The Phase 1 spec asked both for a persisted dismissal AND for the notice to
// reappear after a refresh; those only reconcile as two levels, so the mount
// check reads localStorage and the X alone deliberately does not write it.)
//
// Props:
//   message     full notice copy; the literal "ToS §5.2" inside it is rendered
//               as the outbound link, so the wording stays verbatim
//   storageKey  per-tool localStorage key for the persisted dismissal
//   tosHref     ToS deep link (new tab)
//   variant     'banner' — persistent, shown from mount
//               'action' — revealed by a trigger; parent owns `open`/`onClose`
//   open        action variant only: whether the trigger has fired
//   onClose     action variant only: called when the user dismisses

const LINK_TOKEN = 'ToS §5.2'

function readPersisted(key) {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    // Private mode / storage disabled — treat as "never dismissed".
    return false
  }
}

function writePersisted(key) {
  try {
    localStorage.setItem(key, '1')
  } catch {
    // Storage unavailable — the notice simply returns on the next load.
  }
}

export default function ClaudeApiDisclosure({
  message,
  storageKey,
  tosHref = 'https://chiefeotool.com/tos#5-2',
  variant = 'banner',
  open = true,
  onClose
}) {
  // Lazy initial read so a persisted dismissal never flashes the notice.
  const [persisted, setPersisted] = useState(() => readPersisted(storageKey))
  const [dismissed, setDismissed] = useState(false)
  const [dontShowAgain, setDontShowAgain] = useState(false)

  // The action variant is re-opened by its trigger, so clear a previous
  // in-memory dismiss and let the next trigger show it again. For the banner
  // variant `open` is constant true, so this runs once and hides nothing.
  useEffect(() => {
    if (open) setDismissed(false)
  }, [open])

  function handleDismiss() {
    if (dontShowAgain) {
      writePersisted(storageKey)
      setPersisted(true)
    }
    setDismissed(true)
    if (onClose) onClose()
  }

  if (persisted || dismissed || !open) return null

  // Keep the approved copy verbatim while still linking the ToS reference.
  const at = message.indexOf(LINK_TOKEN)
  const before = at === -1 ? message : message.slice(0, at)
  const after = at === -1 ? '' : message.slice(at + LINK_TOKEN.length)

  return (
    <div
      className={`claude-disclosure claude-disclosure--${variant}`}
      role={variant === 'action' ? 'status' : 'note'}
    >
      <p className="claude-disclosure__text">
        {before}
        {at !== -1 && (
          <a
            className="claude-disclosure__link"
            href={tosHref}
            target="_blank"
            rel="noopener noreferrer"
          >
            {LINK_TOKEN}
          </a>
        )}
        {after}
      </p>
      <label className="claude-disclosure__optout">
        <input
          type="checkbox"
          checked={dontShowAgain}
          onChange={(e) => setDontShowAgain(e.target.checked)}
        />
        Don&rsquo;t show again
      </label>
      <button
        type="button"
        className="claude-disclosure__close"
        onClick={handleDismiss}
        aria-label="Dismiss notice"
      >
        &times;
      </button>
    </div>
  )
}
