/**
 * shared/chiefeo-auth/react/AccountShell.jsx
 *
 * The single wrap that gives a tool optional-auth awareness:
 *   - <AuthProvider>   → ?ref= capture, session pickup after the email/OAuth
 *                        redirect, auth state, and branding for the auth UI.
 *   - <ReferralBanner> → dismissible anon nudge (logged-out only).
 *   - <AccountMenu>    → corner avatar + Sign out dropdown (logged-in only).
 *   - <AuthModal>      → opened by the banner's CTA.
 *
 * The banner and account menu are mutually exclusive by auth state (each
 * self-hides), so the top of the shell reactively swaps between them as the
 * session changes — no page reload. Zero behavior change for anon users beyond
 * the dismissible banner: children always render immediately, nothing gates or
 * redirects.
 *
 * A tool passes its Supabase config + theme/brand/copy straight through; every
 * one of those is optional (defaults apply). This generic shell is the drop-in
 * for most tools; a tool wanting a different layout can instead compose
 * AuthProvider / ReferralBanner / AccountMenu / AuthModal directly.
 */

import React, { useState } from 'react';
import { AuthProvider } from './AuthProvider.jsx';
import { ReferralBanner } from './ReferralBanner.jsx';
import AccountMenu from './AccountMenu.jsx';
import AuthModal from './AuthModal.jsx';

const defaultBannerWrap = {
  maxWidth: '960px',
  margin: '0 auto',
  padding: '10px 16px 0',
};

/**
 * @param {object} props
 * @param {React.ReactNode} props.children
 * @param {string} [props.supabaseUrl]
 * @param {string} [props.supabaseAnonKey]
 * @param {string} [props.siteUrl]
 * @param {Function} [props.createClient]
 * @param {object} [props.theme]
 * @param {object} [props.brand]
 * @param {object} [props.copy]
 * @param {React.CSSProperties} [props.bannerWrapStyle]  Override the banner container styling.
 * @param {boolean} [props.showReferralLinkWhenLoggedIn=false]
 */
export default function AccountShell({
  children,
  supabaseUrl,
  supabaseAnonKey,
  siteUrl,
  createClient,
  theme,
  brand,
  copy,
  bannerWrapStyle,
  showReferralLinkWhenLoggedIn = false,
}) {
  const [showAuth, setShowAuth] = useState(false);

  return (
    <AuthProvider
      supabaseUrl={supabaseUrl}
      supabaseAnonKey={supabaseAnonKey}
      siteUrl={siteUrl}
      createClient={createClient}
      theme={theme}
      brand={brand}
      copy={copy}
    >
      {/* Logged-out: dismissible signup banner. Logged-in: it self-hides and
          the corner account menu takes over. */}
      <div style={bannerWrapStyle ?? defaultBannerWrap}>
        <ReferralBanner
          onSignupClick={() => setShowAuth(true)}
          showReferralLinkWhenLoggedIn={showReferralLinkWhenLoggedIn}
        />
      </div>
      <AccountMenu />
      {children}
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </AuthProvider>
  );
}
