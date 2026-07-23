/**
 * shared/chiefeo-auth/react/AuthModal.jsx
 *
 * Minimal signup / login modal built on the framework-free core actions.
 * Self-styled with inline styles (colors + copy from the effective branding),
 * so it needs no CSS framework and drops into any tool.
 *
 * Contract:
 * - Signup requires email verification: success shows "check your inbox", it
 *   does NOT log the user in. Login logs in immediately.
 * - Core actions never throw; they return { ok, message, code }. We render
 *   `message` and branch on `code` for the resend-verification affordance.
 * - Auth is optional — closing the modal always leaves full tool access.
 */

import React, { useState } from 'react';
import {
  signUpWithEmail,
  signInWithEmail,
  signInWithGoogle,
  resendVerification,
} from '../core/index.js';
import { useBranding } from './theme.js';

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
  );
}

function buildStyles(theme) {
  return {
    overlay: {
      position: 'fixed',
      inset: 0,
      background: 'rgba(15, 23, 42, 0.45)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '16px',
      zIndex: 1000,
      fontFamily: theme.fontFamily,
    },
    card: {
      width: '100%',
      maxWidth: '380px',
      background: '#fff',
      color: theme.ink,
      borderRadius: '10px',
      border: `1px solid ${theme.border}`,
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
      color: theme.ink,
      cursor: 'pointer',
      fontSize: '18px',
      lineHeight: 1,
      padding: '4px 6px',
    },
    title: { margin: '0 0 4px', fontSize: '18px', fontWeight: 700 },
    sub: { margin: '0 0 16px', fontSize: '13px', opacity: 0.75 },
    label: {
      display: 'block',
      fontSize: '13px',
      fontWeight: 600,
      margin: '10px 0 4px',
    },
    input: {
      width: '100%',
      boxSizing: 'border-box',
      padding: '9px 11px',
      fontSize: '14px',
      border: `1px solid ${theme.fieldBorder}`,
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
      background: theme.accent,
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
      color: theme.googleInk,
      background: '#fff',
      border: `1px solid ${theme.googleBorder}`,
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
      color: theme.accent,
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
      background: ok ? theme.tintBg : theme.errBg,
      color: ok ? theme.ink : theme.errInk,
      border: `1px solid ${ok ? theme.border : '#f2c9c9'}`,
    }),
  };
}

/**
 * @param {object} props
 * @param {() => void} props.onClose
 * @param {object} [props.theme]  Local theme overrides.
 * @param {object} [props.brand]  Local brand overrides.
 * @param {object} [props.copy]   Local copy overrides.
 */
export default function AuthModal({
  onClose,
  theme: themeOverride,
  brand: brandOverride,
  copy: copyOverride,
}) {
  const { theme, copy } = useBranding({
    theme: themeOverride,
    brand: brandOverride,
    copy: copyOverride,
  });
  const styles = buildStyles(theme);

  const [mode, setMode] = useState('signup'); // 'signup' | 'login'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { ok, message, code }

  const isSignup = mode === 'signup';

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setResult(null);
    const r = isSignup
      ? await signUpWithEmail(email, password)
      : await signInWithEmail(email, password);
    setResult(r);
    setBusy(false);
    // A completed login is picked up by AuthProvider's onAuthStateChange; close
    // the modal so the tool reflects the signed-in state.
    if (r.ok && r.code === 'ok') onClose();
  };

  const resend = async () => {
    setBusy(true);
    const r = await resendVerification(email);
    setResult(r);
    setBusy(false);
  };

  const google = async () => {
    if (busy) return;
    setBusy(true);
    setResult(null);
    const r = await signInWithGoogle();
    // On success the browser redirects to Google and never returns here; only
    // surface a message (and re-enable the form) if it failed to start.
    if (!r.ok) {
      setResult(r);
      setBusy(false);
    }
  };

  const switchMode = () => {
    setMode(isSignup ? 'login' : 'signup');
    setResult(null);
  };

  return (
    <div
      style={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label={isSignup ? copy.signupTitle : copy.loginTitle}
      onClick={onClose}
    >
      <div style={styles.card} onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          style={styles.close}
          aria-label={copy.closeLabel}
          onClick={onClose}
        >
          &#10005;
        </button>

        <h2 style={styles.title}>{isSignup ? copy.signupTitle : copy.loginTitle}</h2>
        <p style={styles.sub}>
          {isSignup ? copy.signupSubtitle : copy.loginSubtitle}
        </p>

        <button type="button" style={styles.googleBtn} onClick={google} disabled={busy}>
          <GoogleIcon />
          {copy.googleButton}
        </button>

        <div style={styles.divider} aria-hidden="true">
          <span style={styles.dividerLine} />
          <span>{copy.orDivider}</span>
          <span style={styles.dividerLine} />
        </div>

        <form onSubmit={submit}>
          <label style={styles.label} htmlFor="chiefeo-auth-email">
            {copy.emailLabel}
          </label>
          <input
            id="chiefeo-auth-email"
            style={styles.input}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <label style={styles.label} htmlFor="chiefeo-auth-password">
            {copy.passwordLabel}
          </label>
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
            {busy
              ? copy.workingLabel
              : isSignup
                ? copy.signupSubmit
                : copy.loginSubmit}
          </button>
        </form>

        {result && (
          <div style={styles.msg(result.ok)} role="status">
            {result.message}
            {result.code === 'needs_verification' && (
              <>
                {' '}
                <button
                  type="button"
                  style={styles.linkBtn}
                  onClick={resend}
                  disabled={busy}
                >
                  {copy.resendLink}
                </button>
              </>
            )}
          </div>
        )}

        <div style={styles.toggleRow}>
          {isSignup ? copy.haveAccount : copy.needAccount}{' '}
          <button type="button" style={styles.linkBtn} onClick={switchMode}>
            {isSignup ? copy.switchToLogin : copy.switchToSignup}
          </button>
        </div>
      </div>
    </div>
  );
}
