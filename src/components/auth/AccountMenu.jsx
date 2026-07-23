/**
 * src/components/auth/AccountMenu.jsx
 *
 * Minimal signed-in account control for the shared shell. When a user is
 * authenticated it renders a small avatar/initial button in the corner;
 * clicking it opens a dropdown with the signed-in identity + a Sign out
 * button. Logged out (or still loading) it renders nothing — the shell shows
 * the ReferralBanner instead.
 *
 * Reactivity: reads useOptionalAuth() (fed by AuthProvider's
 * onAuthStateChange), so signing out flips the UI back to the logged-out
 * state with no page reload. signOut() calls supabase.auth.signOut() via the
 * existing getSupabase() client.
 *
 * Scope: essentials only — identity + Sign out. No profile page, referral UI,
 * or password change (future phase).
 */

import React, { useEffect, useRef, useState } from 'react'
import { useOptionalAuth } from '../../hooks/useOptionalAuth'
import { signOut } from '../../lib/auth/actions'

/** Prefer a Google display name/avatar from user_metadata; fall back to email. */
function identityFrom(user) {
  const meta = (user && user.user_metadata) || {}
  const email = user?.email || ''
  const displayName =
    meta.full_name || meta.name || meta.user_name || email || 'Account'
  const avatarUrl = meta.avatar_url || meta.picture || null
  const initial = (displayName || email || '?').trim().charAt(0).toUpperCase()
  return { email, displayName, avatarUrl, initial }
}

const palette = {
  ink: '#1e3a5f',
  accent: '#1d4ed8',
  border: '#c9dcf5',
}

const styles = {
  wrap: {
    position: 'fixed',
    top: '10px',
    right: '12px',
    zIndex: 900,
    fontFamily:
      'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  },
  trigger: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '36px',
    height: '36px',
    padding: 0,
    borderRadius: '50%',
    border: `1px solid ${palette.border}`,
    background: '#eef4ff',
    color: palette.accent,
    fontWeight: 700,
    fontSize: '15px',
    cursor: 'pointer',
    overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  backdrop: { position: 'fixed', inset: 0, zIndex: 899, background: 'transparent' },
  menu: {
    position: 'absolute',
    top: '44px',
    right: 0,
    zIndex: 901,
    minWidth: '220px',
    maxWidth: '280px',
    background: '#fff',
    color: palette.ink,
    border: `1px solid ${palette.border}`,
    borderRadius: '8px',
    boxShadow: '0 10px 28px rgba(15, 23, 42, 0.18)',
    padding: '10px',
  },
  name: {
    fontSize: '13px',
    fontWeight: 700,
    margin: '2px 4px 0',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  email: {
    fontSize: '12px',
    color: '#5b6b7f',
    margin: '0 4px 8px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  sep: { height: '1px', background: '#e8eef7', margin: '4px 0 8px' },
  signOut: {
    width: '100%',
    padding: '8px 10px',
    fontSize: '13px',
    fontWeight: 600,
    color: palette.ink,
    background: '#f5f8fd',
    border: `1px solid ${palette.border}`,
    borderRadius: '6px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'left',
  },
}

export default function AccountMenu() {
  const { isLoggedIn, user, loading } = useOptionalAuth()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const wrapRef = useRef(null)

  // Close on Escape while open.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  // While auth state resolves, or when logged out: render nothing (the shell
  // shows the ReferralBanner in the logged-out case).
  if (loading || !isLoggedIn || !user) return null

  const { email, displayName, avatarUrl, initial } = identityFrom(user)

  const doSignOut = async () => {
    if (busy) return
    setBusy(true)
    await signOut() // supabase.auth.signOut(); AuthProvider flips state reactively
    // No manual reset needed — onAuthStateChange unmounts this menu.
    setOpen(false)
    setBusy(false)
  }

  return (
    <div style={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        style={styles.trigger}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account: ${displayName}`}
        title={displayName}
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt="" style={styles.avatarImg} referrerPolicy="no-referrer" />
        ) : (
          initial
        )}
      </button>

      {open && (
        <>
          <div style={styles.backdrop} onClick={() => setOpen(false)} aria-hidden="true" />
          <div style={styles.menu} role="menu" aria-label="Account menu">
            {displayName && displayName !== email && (
              <div style={styles.name} title={displayName}>{displayName}</div>
            )}
            <div style={styles.email} title={email}>{email}</div>
            <div style={styles.sep} />
            <button
              type="button"
              style={styles.signOut}
              onClick={doSignOut}
              disabled={busy}
              role="menuitem"
            >
              {busy ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
