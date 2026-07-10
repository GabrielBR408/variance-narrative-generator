import { useEffect } from 'react'

// --- Minimal dialog accessibility for the disclosure modals ----------------
// The modals render aria-modal dialogs but (pre-fix) never moved focus or
// listened for Escape, so keyboard users were stranded behind them. This hook
// adds the basics, dependency-free (no focus-trap library):
//   • focus moves INTO the dialog when it opens (a caller-chosen element, its
//     primary button, or the dialog itself as a fallback),
//   • Tab / Shift+Tab cycle WITHIN the dialog (aria-modal promised a modal,
//     but Tab used to walk into the obscured page behind the overlay),
//   • Escape invokes the dialog's dismiss action — unless a dialog stacked on
//     top already consumed the event (see the ordering note below),
//   • focus returns to the element that triggered the dialog when it closes,
//     with a real fallback when that trigger can no longer take focus.
// The dialogs are conditionally rendered (they exist only while open), so the
// effects are mount/unmount scoped.
//   dialogRef       : ref to the dialog container element
//   onEscape        : the dialog's close/cancel action (a stable callback).
//                     Pass null/undefined for a dialog that must NOT close on
//                     Escape (e.g. the privacy notice, where dismissal would
//                     imply consent) — the trap and focus handling still apply.
//   initialFocusRef : optional ref to the element that should receive focus on
//                     open (e.g. a textarea); falls back to the first button.

// What counts as keyboard-focusable inside a dialog (and in the page when we
// need a restore fallback). Deliberately simple — the dialogs are small and
// all of their content is visible while they are open.
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(', ')

// True when `el` can actually receive focus right now. `disabled` matters: a
// disabled trigger's focus() silently no-ops and focus drops to <body>, which
// strands keyboard users (the Generate button is disabled mid-generation when
// the disclosure modal closes — exactly that case).
function canReceiveFocus(el) {
  return Boolean(
    el &&
    typeof el.focus === 'function' &&
    !el.disabled &&
    (typeof document === 'undefined' || document.contains(el))
  )
}

export function useDialogA11y({ dialogRef, onEscape, initialFocusRef } = {}) {
  // Initial focus on open + focus restore on close.
  useEffect(() => {
    const trigger = document.activeElement
    const node = dialogRef.current
    if (node) {
      const preferred = initialFocusRef && initialFocusRef.current
      ;(preferred || node.querySelector('button') || node).focus()
    }
    return () => {
      // Restore focus to the trigger — but only when it can actually take it.
      // A disabled or removed trigger silently drops focus to <body>; prefer
      // the first focusable element in the main content instead, and touch
      // document.body only as a last resort.
      if (canReceiveFocus(trigger)) {
        trigger.focus()
        return
      }
      const main = document.querySelector('main') || document.body
      const fallback = main && main.querySelector(FOCUSABLE_SELECTOR)
      if (canReceiveFocus(fallback)) fallback.focus()
      else if (document.body && typeof document.body.focus === 'function') document.body.focus()
    }
    // Mount-only: the dialog exists only while open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Focus trap: Tab / Shift+Tab cycle within the dialog. aria-modal="true"
  // tells assistive tech the page behind is inert, but it does NOT trap the
  // keyboard — without this, Tab walked into the obscured page.
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key !== 'Tab') return
      const node = dialogRef.current
      if (!node) return
      const focusables = Array.from(node.querySelectorAll(FOCUSABLE_SELECTOR))
      if (focusables.length === 0) {
        // Nothing focusable inside — park focus on the dialog itself
        // (tabIndex={-1} on the container makes this legal).
        e.preventDefault()
        node.focus()
        return
      }
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement
      // Wrap at the ends; also pull focus back in if it somehow escaped.
      if (e.shiftKey) {
        if (active === first || !node.contains(active)) {
          e.preventDefault()
          last.focus()
        }
      } else if (active === last || !node.contains(active)) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [dialogRef])

  // Escape closes the dialog — cooperatively, so ONE keypress never closes a
  // whole stack of dialogs.
  //
  // Ordering (verified against the DOM spec: listeners on the same target and
  // phase fire in the order they were added): every dialog registers its
  // document-level keydown listener when it OPENS, so a dialog opened on top
  // of another has the LATER-firing listener. Each handler therefore
  // (a) skips events another dialog already consumed (e.defaultPrevented) and
  // (b) calls e.preventDefault() when it handles Escape, marking the event
  // consumed for everyone else. The one dialog that can realistically sit
  // UNDER another — the first-visit privacy notice, whose listener would fire
  // first — opts out of Escape entirely (onEscape: null, consent must be
  // explicit), so the topmost open dialog is always the one that acts.
  useEffect(() => {
    if (!onEscape) return undefined
    function onKeyDown(e) {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      e.preventDefault()
      onEscape()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onEscape])
}
