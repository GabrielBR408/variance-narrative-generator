/**
 * shared/chiefeo-auth/react/AccountMenu.jsx
 *
 * Minimal signed-in account control. When a user is authenticated it renders a
 * small avatar/initial button in the corner; clicking it opens a dropdown with
 * the signed-in identity + a Sign out button. Logged out (or still loading) it
 * renders nothing — the shell shows the ReferralBanner instead.
 *
 * Reactivity: reads useOptionalAuth() (fed by AuthProvider's onAuthStateChange),
 * so signing out flips the UI back to the logged-out state with no page reload.
 * signOut() calls supabase.auth.signOut() via the shared core.
 *
 * Scope: essentials only — identity + Sign out. Colors + copy come from the
 * effective branding.
 */

import React, { useEffect, useRef, useState } from 'react';
import { signOut } from '../core/index.js';
import { useOptionalAuth } from './useOptionalAuth.js';
import { useBranding } from './theme.js';

/** Prefer a Google display name/avatar from user_metadata; fall back to email. */
function identityFrom(user, fallbackName) {
  const meta = (user && user.user_metadata) || {};
  const email = user?.email || '';
  const displayName =
    meta.full_name || meta.name || meta.user_name || email || fallbackName;
  const avatarUrl = meta.avatar_url || meta.picture || null;
  const initial = (displayName || email || '?').trim().charAt(0).toUpperCase();
  return { email, displayName, avatarUrl, initial };
}

function buildStyles(theme) {
  return {
    wrap: {
      position: 'fixed',
      top: '10px',
      right: '12px',
      zIndex: 900,
      fontFamily: theme.fontFamily,
    },
    trigger: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '36px',
      height: '36px',
      padding: 0,
      borderRadius: '50%',
      border: `1px solid ${theme.border}`,
      background: theme.tintBg,
      color: theme.accent,
      fontWeight: 700,
      fontSize: '15px',
      cursor: 'pointer',
      overflow: 'hidden',
    },
    avatarImg: {
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      display: 'block',
    },
    backdrop: {
      position: 'fixed',
      inset: 0,
      zIndex: 899,
      background: 'transparent',
    },
    menu: {
      position: 'absolute',
      top: '44px',
      right: 0,
      zIndex: 901,
      minWidth: '220px',
      maxWidth: '280px',
      background: '#fff',
      color: theme.ink,
      border: `1px solid ${theme.border}`,
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
      color: theme.ink,
      background: '#f5f8fd',
      border: `1px solid ${theme.border}`,
      borderRadius: '6px',
      cursor: 'pointer',
      fontFamily: 'inherit',
      textAlign: 'left',
    },
  };
}

/**
 * @param {object} props
 * @param {object} [props.theme]  Local theme overrides.
 * @param {object} [props.copy]   Local copy overrides.
 */
export default function AccountMenu({ theme: themeOverride, copy: copyOverride }) {
  const { theme, copy } = useBranding({
    theme: themeOverride,
    copy: copyOverride,
  });
  const styles = buildStyles(theme);

  const { isLoggedIn, user, loading } = useOptionalAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef(null);

  // Close on Escape while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // While auth state resolves, or when logged out: render nothing (the shell
  // shows the ReferralBanner in the logged-out case).
  if (loading || !isLoggedIn || !user) return null;

  const { email, displayName, avatarUrl, initial } = identityFrom(
    user,
    copy.accountFallbackName
  );

  const doSignOut = async () => {
    if (busy) return;
    setBusy(true);
    await signOut(); // AuthProvider flips state reactively via onAuthStateChange
    setOpen(false);
    setBusy(false);
  };

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
          <img
            src={avatarUrl}
            alt=""
            style={styles.avatarImg}
            referrerPolicy="no-referrer"
          />
        ) : (
          initial
        )}
      </button>

      {open && (
        <>
          <div
            style={styles.backdrop}
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div style={styles.menu} role="menu" aria-label="Account menu">
            {displayName && displayName !== email && (
              <div style={styles.name} title={displayName}>
                {displayName}
              </div>
            )}
            <div style={styles.email} title={email}>
              {email}
            </div>
            <div style={styles.sep} />
            <button
              type="button"
              style={styles.signOut}
              onClick={doSignOut}
              disabled={busy}
              role="menuitem"
            >
              {busy ? copy.signingOut : copy.signOut}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
