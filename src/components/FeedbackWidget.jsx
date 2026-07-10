import React, { useRef, useState } from 'react'
import { trackSend } from '../lib/track.js'
import { APP_VERSION, COMMIT_SHA } from '../lib/buildInfo.js'
import { useDialogA11y } from '../hooks/useDialogA11y.js'

// Floating "Feedback" pill + bottom sheet (VNG only — this component is only
// ever rendered by App.jsx, which the src/main.jsx pathname switch mounts
// solely for /vng, so the widget can never appear on the hub landing or the
// proxied tool paths). Reports post to the same Supabase table as every other
// analytics event: app='vng', event='feedback', shared session_id, and the
// internal-traffic flag applied inside track.js itself — but through the
// AWAITABLE trackSend variant, because this is the one call site where the UI
// tells the user the send succeeded. The success screen shows only when the
// endpoint actually accepted the row; a failed or timed-out send keeps the
// draft and shows an inline retry message instead of a false "thank you".
//
// Keyboard access mirrors DisclosureModal via useDialogA11y: focus moves into
// the sheet on open (the message textarea — it's the field the user came to
// fill), Tab is trapped inside, Escape dismisses (cooperatively: it defers to
// any dialog stacked above via the defaultPrevented protocol in the hook), and
// focus returns to the pill on close. A dismissed draft is kept so an
// accidental Escape doesn't eat a half-written report; state is reset only
// after a successful send.
const FEEDBACK_TYPES = [
  { value: 'bug', label: "Something's broken" },
  { value: 'idea', label: 'Idea / request' },
  { value: 'other', label: 'Other' }
]

// Hard cap on the message length. keepalive fetch bodies are capped at ~64 KB
// by browsers; an unbounded paste used to make the send fail (silently, before
// the honest-send fix). 2,000 characters is plenty for a report and keeps the
// request nowhere near the cap.
const MAX_MESSAGE_LENGTH = 2000

export default function FeedbackWidget({ screen }) {
  const [open, setOpen] = useState(false)
  const [sent, setSent] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendFailed, setSendFailed] = useState(false)
  const [feedbackType, setFeedbackType] = useState('bug')
  const [message, setMessage] = useState('')
  const pillRef = useRef(null)
  // Synchronous reentrancy guard: `sending` state lands a render late, so a
  // double-activation (double click / Enter+click) used to post twice.
  const inFlightRef = useRef(false)

  function handleClose() {
    if (sent) {
      setFeedbackType('bug')
      setMessage('')
      setSent(false)
    }
    setSendFailed(false)
    setOpen(false)
    // useDialogA11y also restores focus to the trigger on unmount; this keeps
    // the pill focused even when the sheet was opened programmatically.
    if (pillRef.current) pillRef.current.focus()
  }

  async function handleSend() {
    const trimmed = message.trim()
    if (!trimmed || inFlightRef.current) return
    inFlightRef.current = true
    setSending(true)
    setSendFailed(false)
    // trackSend resolves true only when the endpoint accepted the row; false on
    // HTTP error, network failure, or its 10 s timeout. It never rejects.
    const ok = await trackSend('vng', 'feedback', {
      feedback_type: feedbackType,
      message: trimmed,
      version: APP_VERSION,
      commit: COMMIT_SHA,
      screen
    })
    inFlightRef.current = false
    setSending(false)
    if (ok) setSent(true)
    else setSendFailed(true) // draft is kept — the user can retry as-is
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
        <FeedbackSheet
          sent={sent}
          sending={sending}
          sendFailed={sendFailed}
          feedbackType={feedbackType}
          setFeedbackType={setFeedbackType}
          message={message}
          setMessage={setMessage}
          screen={screen}
          onSend={handleSend}
          onClose={handleClose}
        />
      )}
    </>
  )
}

// The sheet is a separate component so useDialogA11y mounts exactly when the
// dialog opens (hooks can't be conditional inside FeedbackWidget itself).
function FeedbackSheet({
  sent,
  sending,
  sendFailed,
  feedbackType,
  setFeedbackType,
  message,
  setMessage,
  screen,
  onSend,
  onClose
}) {
  const dialogRef = useRef(null)
  const textareaRef = useRef(null)
  useDialogA11y({ dialogRef, onEscape: onClose, initialFocusRef: textareaRef })

  return (
    <div
      className="feedback-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="feedback-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-title"
        ref={dialogRef}
        tabIndex={-1}
      >
        {sent ? (
          <div className="feedback-success">
            <h2 id="feedback-title" className="feedback-title">Feedback sent — thank you!</h2>
            <p className="feedback-success-body">
              Your report was tagged to version {APP_VERSION} (build {COMMIT_SHA}), so we can
              trace it to exactly what you were using.
            </p>
            <button type="button" className="feedback-send" onClick={onClose} autoFocus>
              Done
            </button>
          </div>
        ) : (
          <>
            <h2 id="feedback-title" className="feedback-title">Send feedback</h2>
            {/* Toggle buttons (aria-pressed), not role="radio": radios require
                the roving-tabindex/arrow-key pattern, which plain buttons in a
                labelled group don't. */}
            <div className="feedback-types" role="group" aria-label="Feedback type">
              {FEEDBACK_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  aria-pressed={feedbackType === t.value}
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
              maxLength={MAX_MESSAGE_LENGTH}
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
            {sendFailed && (
              <p className="feedback-error" role="alert">
                Couldn&rsquo;t send — please try again.
              </p>
            )}
            <div className="feedback-actions">
              <button
                type="button"
                className="feedback-send"
                onClick={onSend}
                disabled={!message.trim() || sending}
              >
                {sending ? 'Sending…' : 'Send feedback'}
              </button>
              <button type="button" className="feedback-cancel" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
