// --- Hub share helper -------------------------------------------------------
// Pure, DOM-light logic behind the hub's "Share" button so it can be unit
// tested without a browser. The UI (Hub.jsx) owns the button + toast; this owns
// the decision tree:
//   1. navigator.share  → native OS share sheet (mobile / installed PWAs)
//   2. navigator.clipboard.writeText → copy the URL, show "Link copied"
//   3. neither available → degrade silently (never throw)
// A user cancelling the native sheet surfaces as an AbortError; that is a normal
// outcome, not a failure, so it is swallowed and reported as 'cancelled'.

// Branding matches the hub copy (header "ChiefEO Tool", tagline "Pick a tool.").
export const SHARE_TITLE = 'ChiefEO Tool'
export const SHARE_TEXT = 'Check out ChiefEO'

// Returns one of: 'shared' | 'cancelled' | 'copied' | 'unavailable'.
// Deps are injected so tests can pass fakes; defaults read the real browser
// globals. Guarded so a non-secure context or a missing API can never throw.
export async function shareHub(nav, loc) {
  const navigator_ = nav || (typeof navigator !== 'undefined' ? navigator : undefined)
  const location_ = loc || (typeof window !== 'undefined' ? window.location : undefined)
  const url = (location_ && location_.href) || ''
  const payload = { title: SHARE_TITLE, text: SHARE_TEXT, url }

  if (navigator_ && typeof navigator_.share === 'function') {
    try {
      await navigator_.share(payload)
      return 'shared'
    } catch (err) {
      // User dismissed the share sheet — expected, stay silent.
      if (err && err.name === 'AbortError') return 'cancelled'
      // Any other share failure (e.g. NotAllowedError) falls through to copy.
    }
  }

  if (
    navigator_ &&
    navigator_.clipboard &&
    typeof navigator_.clipboard.writeText === 'function' &&
    url
  ) {
    try {
      await navigator_.clipboard.writeText(url)
      return 'copied'
    } catch {
      return 'unavailable'
    }
  }

  return 'unavailable'
}
