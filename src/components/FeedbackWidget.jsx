import React, { useEffect, useRef, useState } from 'react'
import { track } from '../lib/track.js'
import { APP_VERSION, COMMIT_SHA } from '../lib/buildInfo.js'

// Floating "Feedback" pill + bottom sheet (VNG only — this component is only
// ever rendered by App.jsx, which the src/main.jsx pathname switch mounts
// solely for /vng, so the widget can never appear on the hub landing or the
// proxied tool paths). Reports go through the same track() path as every
// other analytics event: app='vng', event='feedback', shared session_id, and
// the internal-traffic flag applied inside track() itself.
//
// Keyboard access mirrors DisclosureModal: focus moves into the sheet on open
// (the message textarea — it's the field the user came to fill), Escape
// dismisses, and focus returns to the pill on close. A dismissed draft is
// kept so an accidental Escape doesn't eat a half-written report; state is
// reset only after a successful send.
const FEEDBACK_TYPES = [
  { value: 'bug', label: "Something's broken" },
  { value: 'idea', label: 'Idea / request' },
  { value: 'other', label: 'Other' }
]

export default function FeedbackWidget({ screen }) {
  const [open, setOpen] = useState(false)
  const [sent, setSent] = useState(false)
  const [feedbackType, setFeedbackType] = useState('bug')
  const [message, setMessage] = useState('')
  const textareaRef = useRef(null)
  const pillRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    if (!sent && textareaRef.current) textareaRef.current.focus()
    function onKeyDown(e) {
      if (e.key !== 'Escape') return
      e.preventDefault()
      handleClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
    // Re-binding on `sent` keeps handleClose's closure current (it resets the
    // form only after a send).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sent])

  function handleClose() {
    if (sent) {
      setFeedbackType('bug')
      setMessage('')
      setSent(false)
    }
    setOpen(false)
    if (pillRef.current) pillRef.current.focus()
  }

  function handleSend() {
    const trimmed = message.trim()
    if (!trimmed) return
    track('vng', 'feedback', {
      feedback_type: feedbackType,
      message: trimmed,
      version: APP_VERSION,
      commit: COMMIT_SHA,
      screen
    })
    setSent(true)
  }

  return (
    <>
      <button
        type="button"
        ref={pillRef}
        className="feedback-pill"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        Feedback
      </button>

      {open && (
        <div
          className="feedback-overlay"
          onMouseDown={(e) => { if (e.target === e.currentTarget) handleClose() }}
        >
          <div
            className="feedback-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="feedback-title"
          >
            {sent ? (
              <div className="feedback-success">
                <h2 id="feedback-title" className="feedback-title">Feedback sent — thank you!</h2>
                <p className="feedback-success-body">
                  Your report was tagged to version {APP_VERSION} (build {COMMIT_SHA}), so we can
                  trace it to exactly what you were using.
                </p>
                <button type="button" className="feedback-send" onClick={handleClose} autoFocus>
                  Done
                </button>
              </div>
            ) : (
              <>
                <h2 id="feedback-title" className="feedback-title">Send feedback</h2>
                <div className="feedback-types" role="radiogroup" aria-label="Feedback type">
                  {FEEDBACK_TYPES.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      role="radio"
                      aria-checked={feedbackType === t.value}
                      className={`feedback-type-chip${feedbackType === t.value ? ' feedback-type-chip--active' : ''}`}
                      onClick={() => setFeedbackType(t.value)}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <textarea
                  ref={textareaRef}
                  className="feedback-message"
                  rows={4}
                  placeholder="What happened, or what would help?"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
                <div className="feedback-receipt">
                  <span className="feedback-receipt-label">Attached automatically</span>
                  <span className="feedback-receipt-items">
                    app: vng · v{APP_VERSION} · build {COMMIT_SHA} · screen: {screen}
                  </span>
                </div>
                <div className="feedback-actions">
                  <button
                    type="button"
                    className="feedback-send"
                    onClick={handleSend}
                    disabled={!message.trim()}
                  >
                    Send feedback
                  </button>
                  <button type="button" className="feedback-cancel" onClick={handleClose}>
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
