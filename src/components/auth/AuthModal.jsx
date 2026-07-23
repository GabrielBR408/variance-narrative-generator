/**
 * src/components/auth/AuthModal.jsx
 *
 * Minimal signup / login modal for chiefeotool.com (Phase 1 optional auth).
 * Built from lib/auth/actions.ts per docs/VITE_INTEGRATION.md. Self-styled
 * with inline styles (same palette as ReferralBanner) so it needs no CSS
 * framework and can drop into either the hub or the VNG app.
 *
 * Contract:
 * - Signup requires email verification: success shows "check your inbox",
 *   it does NOT log the user in. Login logs in immediately.
 * - actions never throw; they return { ok, message, code }. We render
 *   `message` and branch on `code` for the resend-verification affordance.
 * - Auth is optional — closing the modal always leaves full tool access.
 */

import React, { useState } from 'react'
import {
  signUpWithEmail,
  signInWithEmail,
  signInWithGoogle,
  resendVerification,
} from '../../lib/auth/actions'

/** Google "G" mark (official four-color), sized for an inline button. */
function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.71H.96v2.33A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.71a5.4 5.4 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l3.01-2.33z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.47.9 11.43 0 9 0A9 9 0 0 0 .96 4.96l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  )
}

const palette = {
  ink: '#1e3a5f',
  accent: '#1d4ed8',
  border: '#c9dcf5',
  tintBg: '#eef4ff',
  errBg: '#fdecec',
  errInk: '#7a1f1f',
}

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15, 23, 42, 0.45)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '16px',
    zIndex: 1000,
    fontFamily:
      'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  },
  card: {
    width: '100%',
    maxWidth: '380px',
    background: '#fff',
    color: palette.ink,
    borderRadius: '10px',
    border: `1px solid ${palette.border}`,
    boxShadow: '0 12px 32px rgba(15, 23, 42, 0.25)',
    padding: '22px 22px 20px',
    position: 'relative',
  },
  close: {
    position: 'absolute',
    top: '10px',
    right: '10px',
    border: 'none',
    background: 'transparent',
    color: palette.ink,
    cursor: 'pointer',
    fontSize: '18px',
    lineHeight: 1,
    padding: '4px 6px',
  },
  title: { margin: '0 0 4px', fontSize: '18px', fontWeight: 700 },
  sub: { margin: '0 0 16px', fontSize: '13px', opacity: 0.75 },
  label: { display: 'block', fontSize: '13px', fontWeight: 600, margin: '10px 0 4px' },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '9px 11px',
    fontSize: '14px',
    border: `1px solid ${palette.border}`,
    borderRadius: '6px',
    fontFamily: 'inherit',
  },
  submit: {
    width: '100%',
    marginTop: '16px',
    padding: '10px 12px',
    fontSize: '14px',
    fontWeight: 600,
    color: '#fff',
    background: palette.accent,
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  googleBtn: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    padding: '10px 12px',
    fontSize: '14px',
    fontWeight: 600,
    color: '#1f2937',
    background: '#fff',
    border: '1px solid #d0d7e2',
    borderRadius: '6px',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  divider: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    margin: '14px 0',
    color: '#94a3b8',
    fontSize: '12px',
  },
  dividerLine: { flex: 1, height: '1px', background: '#e2e8f0' },
  toggleRow: { marginTop: '14px', fontSize: '13px', textAlign: 'center' },
  linkBtn: {
    background: 'transparent',
    border: 'none',
    color: palette.accent,
    fontWeight: 600,
    cursor: 'pointer',
    fontSize: 'inherit',
    fontFamily: 'inherit',
    padding: 0,
    textDecoration: 'underline',
  },
  msg: (ok) => ({
    marginTop: '14px',
    padding: '9px 11px',
    fontSize: '13px',
    lineHeight: 1.4,
    borderRadius: '6px',
    background: ok ? palette.tintBg : palette.errBg,
    color: ok ? palette.ink : palette.errInk,
    border: `1px solid ${ok ? palette.border : '#f2c9c9'}`,
  }),
}

export default function AuthModal({ onClose }) {
  const [mode, setMode] = useState('signup') // 'signup' | 'login'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null) // { ok, message, code }

  const isSignup = mode === 'signup'

  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setResult(null)
    const r = isSignup
      ? await signUpWithEmail(email, password)
      : await signInWithEmail(email, password)
    setResult(r)
    setBusy(false)
    // A completed login is picked up by AuthProvider's onAuthStateChange;
    // close the modal so the tool reflects the signed-in state.
    if (r.ok && r.code === 'ok') onClose()
  }

  const resend = async () => {
    setBusy(true)
    const r = await resendVerification(email)
    setResult(r)
    setBusy(false)
  }

  const google = async () => {
    if (busy) return
    setBusy(true)
    setResult(null)
    const r = await signInWithGoogle()
    // On success the browser redirects to Google and never returns here;
    // only surface a message (and re-enable the form) if it failed to start.
    if (!r.ok) {
      setResult(r)
      setBusy(false)
    }
  }

  const switchMode = () => {
    setMode(isSignup ? 'login' : 'signup')
    setResult(null)
  }

  return (
    <div
      style={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label={isSignup ? 'Create account' : 'Log in'}
      onClick={onClose}
    >
      <div style={styles.card} onClick={(e) => e.stopPropagation()}>
        <button type="button" style={styles.close} aria-label="Close" onClick={onClose}>
          &#10005;
        </button>

        <h2 style={styles.title}>{isSignup ? 'Create a free account' : 'Log in'}</h2>
        <p style={styles.sub}>
          {isSignup
            ? 'Optional — all tools stay fully usable without an account.'
            : 'Welcome back.'}
        </p>

        <button type="button" style={styles.googleBtn} onClick={google} disabled={busy}>
          <GoogleIcon />
          Continue with Google
        </button>

        <div style={styles.divider} aria-hidden="true">
          <span style={styles.dividerLine} />
          <span>or</span>
          <span style={styles.dividerLine} />
        </div>

        <form onSubmit={submit}>
          <label style={styles.label} htmlFor="chiefeo-auth-email">Email</label>
          <input
            id="chiefeo-auth-email"
            style={styles.input}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <label style={styles.label} htmlFor="chiefeo-auth-password">Password</label>
          <input
            id="chiefeo-auth-password"
            style={styles.input}
            type="password"
            autoComplete={isSignup ? 'new-password' : 'current-password'}
            required
            minLength={isSignup ? 8 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <button type="submit" style={styles.submit} disabled={busy}>
            {busy ? 'Working…' : isSignup ? 'Create account' : 'Log in'}
          </button>
        </form>

        {result && (
          <div style={styles.msg(result.ok)} role="status">
            {result.message}
            {result.code === 'needs_verification' && (
              <>
                {' '}
                <button type="button" style={styles.linkBtn} onClick={resend} disabled={busy}>
                  Resend link
                </button>
              </>
            )}
          </div>
        )}

        <div style={styles.toggleRow}>
          {isSignup ? 'Already have an account?' : 'Need an account?'}{' '}
          <button type="button" style={styles.linkBtn} onClick={switchMode}>
            {isSignup ? 'Log in' : 'Sign up'}
          </button>
        </div>
      </div>
    </div>
  )
}
