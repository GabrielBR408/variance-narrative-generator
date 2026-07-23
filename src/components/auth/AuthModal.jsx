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
  resendVerification,
} from '../../lib/auth/actions'

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
