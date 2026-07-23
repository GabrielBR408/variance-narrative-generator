/**
 * src/components/auth/ReferralBanner.tsx
 *
 * Purpose: Slim, dismissible, self-styled banner nudging anon users toward
 *          a free account ("Create a free account to unlock referral
 *          rewards"). Drop-in for any chiefeotool.com tool page — no CSS
 *          framework required (inline styles only).
 *
 * Integration notes:
 * - Reads state via useOptionalAuth(); safe with or without <AuthProvider>
 *   mounted (outside the provider it sees anon state — never throws).
 * - Behavior:
 *     loading            → renders nothing (no flash of wrong state)
 *     logged in          → renders nothing, unless
 *                          `showReferralLinkWhenLoggedIn` (default false)
 *                          is set, in which case a tiny inline "Your
 *                          referral link" snippet renders instead.
 *     anon               → slim banner + signup link/button + dismiss X.
 * - SPA note: this hub may not have a /signup route. Pass `onSignupClick`
 *   to open your signup modal/panel instead of navigating; when provided
 *   it takes precedence over `signupHref`.
 * - Dismissal persistence: React state + an in-memory module variable —
 *   stays dismissed across mounts within the same page session.
 *   Deliberately NO localStorage/sessionStorage (restricted-context safe).
 *   A full page reload resets dismissal; accepted Phase 1 behavior.
 * - Accessibility: role="region" + aria-labels.
 */

import React, { useState } from 'react';
import { useOptionalAuth } from '../../hooks/useOptionalAuth';

/**
 * Module-scoped session memory: once dismissed, stays dismissed for every
 * ReferralBanner instance until the next full page load.
 */
let dismissedThisSession = false;

const SITE_URL: string =
  ((import.meta.env.VITE_SITE_URL as string | undefined) ??
    'https://chiefeotool.com').replace(/\/+$/, '');

const styles: Record<string, React.CSSProperties> = {
  banner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    padding: '8px 14px',
    fontSize: '14px',
    lineHeight: 1.4,
    fontFamily:
      'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    background: '#eef4ff',
    color: '#1e3a5f',
    border: '1px solid #c9dcf5',
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
    color: '#1d4ed8',
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
    color: '#1e3a5f',
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
    fontFamily:
      'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    color: '#1e3a5f',
  },
  code: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: '12px',
    background: '#eef4ff',
    border: '1px solid #c9dcf5',
    borderRadius: '4px',
    padding: '2px 6px',
    wordBreak: 'break-all',
  },
};

export interface ReferralBannerProps {
  /** Where the "Sign up" link points when onSignupClick is not provided. */
  signupHref?: string;
  /** Preferred in an SPA: open your signup modal instead of navigating. */
  onSignupClick?: () => void;
  /**
   * When logged in, show a tiny inline "Your referral link" snippet instead
   * of rendering nothing. Default: false (logged in → render nothing).
   */
  showReferralLinkWhenLoggedIn?: boolean;
}

export function ReferralBanner({
  signupHref = '/signup',
  onSignupClick,
  showReferralLinkWhenLoggedIn = false,
}: ReferralBannerProps): JSX.Element | null {
  const { isLoggedIn, referralCode, loading } = useOptionalAuth();
  const [dismissed, setDismissed] = useState<boolean>(dismissedThisSession);

  // While auth state resolves: render nothing (avoids anon-banner flash).
  if (loading) return null;

  // Logged in: nothing by default; optional tiny referral-link snippet.
  if (isLoggedIn) {
    if (!showReferralLinkWhenLoggedIn || !referralCode) return null;
    const referralLink = `${SITE_URL}?ref=${referralCode}`;
    return (
      <span style={styles.inlineSnippet}>
        Your referral link: <code style={styles.code}>{referralLink}</code>
      </span>
    );
  }

  // Anon: slim dismissible nudge. Dismissal lasts for the page session.
  if (dismissed) return null;

  const dismiss = (): void => {
    dismissedThisSession = true;
    setDismissed(true);
  };

  return (
    <div role="region" aria-label="Account signup notice" style={styles.banner}>
      <span style={styles.message}>
        <span>Create a free account to unlock referral rewards</span>
        {onSignupClick ? (
          <button type="button" onClick={onSignupClick} style={styles.link}>
            Sign up
          </button>
        ) : (
          <a href={signupHref} style={styles.link}>
            Sign up
          </a>
        )}
      </span>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss signup notice"
        style={styles.dismiss}
      >
        &#10005;
      </button>
    </div>
  );
}
