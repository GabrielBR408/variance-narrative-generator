/**
 * shared/chiefeo-auth/react/ReferralBanner.jsx
 *
 * Slim, dismissible, self-styled banner nudging anon users toward a free
 * account. No CSS framework required (inline styles only). All colors and copy
 * come from the effective branding (defaults <- <AuthProvider> <- local props).
 *
 * Behavior:
 *   loading   → renders nothing (no flash of wrong state)
 *   logged in → renders nothing, unless showReferralLinkWhenLoggedIn is set, in
 *               which case a tiny inline "Your referral link" snippet renders.
 *   anon      → slim banner + signup link/button + dismiss X.
 *
 * SPA note: pass onSignupClick to open a modal instead of navigating; when
 * provided it takes precedence over the brand.signupHref link.
 *
 * Dismissal persistence: React state + an in-memory module variable — stays
 * dismissed across mounts within the same page session. Deliberately NO
 * localStorage (restricted-context safe). A full reload resets dismissal.
 */

import React, { useState } from 'react';
import { getReferralLink } from '../core/index.js';
import { useOptionalAuth } from './useOptionalAuth.js';
import { useBranding } from './theme.js';

/** Once dismissed, stays dismissed for every instance until the next reload. */
let dismissedThisSession = false;

function buildStyles(theme) {
  return {
    banner: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '12px',
      padding: '8px 14px',
      fontSize: '14px',
      lineHeight: 1.4,
      fontFamily: theme.fontFamily,
      background: theme.tintBg,
      color: theme.ink,
      border: `1px solid ${theme.border}`,
      borderRadius: '6px',
    },
    message: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      flexWrap: 'wrap',
      minWidth: 0,
    },
    link: {
      color: theme.accent,
      fontWeight: 600,
      textDecoration: 'underline',
      whiteSpace: 'nowrap',
      background: 'transparent',
      border: 'none',
      cursor: 'pointer',
      fontSize: 'inherit',
      fontFamily: 'inherit',
      padding: 0,
    },
    dismiss: {
      flex: 'none',
      border: 'none',
      background: 'transparent',
      color: theme.ink,
      cursor: 'pointer',
      fontSize: '16px',
      lineHeight: 1,
      padding: '4px 6px',
      borderRadius: '4px',
    },
    inlineSnippet: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      fontSize: '13px',
      fontFamily: theme.fontFamily,
      color: theme.ink,
    },
    code: {
      fontFamily: theme.monoFontFamily,
      fontSize: '12px',
      background: theme.tintBg,
      border: `1px solid ${theme.border}`,
      borderRadius: '4px',
      padding: '2px 6px',
      wordBreak: 'break-all',
    },
  };
}

/**
 * @param {object} props
 * @param {() => void} [props.onSignupClick]  Preferred in an SPA: open a modal.
 * @param {string} [props.signupHref]  Link target when onSignupClick is absent.
 * @param {boolean} [props.showReferralLinkWhenLoggedIn=false]
 * @param {object} [props.theme]  Local theme overrides.
 * @param {object} [props.brand]  Local brand overrides.
 * @param {object} [props.copy]   Local copy overrides.
 */
export function ReferralBanner({
  onSignupClick,
  signupHref,
  showReferralLinkWhenLoggedIn = false,
  theme: themeOverride,
  brand: brandOverride,
  copy: copyOverride,
}) {
  const { theme, brand, copy } = useBranding({
    theme: themeOverride,
    brand: brandOverride,
    copy: copyOverride,
  });
  const { isLoggedIn, referralCode, loading } = useOptionalAuth();
  const [dismissed, setDismissed] = useState(dismissedThisSession);

  const styles = buildStyles(theme);
  const href = signupHref ?? brand.signupHref;

  // While auth state resolves: render nothing (avoids anon-banner flash).
  if (loading) return null;

  // Logged in: nothing by default; optional tiny referral-link snippet.
  if (isLoggedIn) {
    if (!showReferralLinkWhenLoggedIn || !referralCode) return null;
    return (
      <span style={styles.inlineSnippet}>
        {copy.referralLinkLabel}{' '}
        <code style={styles.code}>{getReferralLink(referralCode)}</code>
      </span>
    );
  }

  // Anon: slim dismissible nudge. Dismissal lasts for the page session.
  if (dismissed) return null;

  const dismiss = () => {
    dismissedThisSession = true;
    setDismissed(true);
  };

  return (
    <div role="region" aria-label={copy.bannerRegionLabel} style={styles.banner}>
      <span style={styles.message}>
        <span>{copy.bannerMessage}</span>
        {onSignupClick ? (
          <button type="button" onClick={onSignupClick} style={styles.link}>
            {copy.bannerCta}
          </button>
        ) : (
          <a href={href} style={styles.link}>
            {copy.bannerCta}
          </a>
        )}
      </span>
      <button
        type="button"
        onClick={dismiss}
        aria-label={copy.bannerDismissLabel}
        style={styles.dismiss}
      >
        &#10005;
      </button>
    </div>
  );
}
