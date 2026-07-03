import { useEffect } from 'react'

// --- Minimal dialog accessibility for the disclosure modals ----------------
// The modals render aria-modal dialogs but (pre-fix) never moved focus or
// listened for Escape, so keyboard users were stranded behind them. This hook
// adds the three basics, dependency-free (no focus-trap library):
//   • focus moves INTO the dialog when it opens (its primary button, or the
//     dialog itself as a fallback),
//   • Escape invokes the dialog's dismiss action,
//   • focus returns to the element that triggered the dialog when it closes.
// The dialogs are conditionally rendered (they exist only while open), so both
// effects are mount/unmount scoped.
//   dialogRef : ref to the dialog container element
//   onEscape  : the dialog's close/cancel action (a stable callback)
export function useDialogA11y({ dialogRef, onEscape }) {
  useEffect(() => {
    const trigger = document.activeElement
    const node = dialogRef.current
    if (node) (node.querySelector('button') || node).focus()
    return () => {
      if (trigger && typeof trigger.focus === 'function') trigger.focus()
    }
    // Mount-only: the dialog exists only while open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key !== 'Escape') return
      e.preventDefault()
      onEscape()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onEscape])
}
