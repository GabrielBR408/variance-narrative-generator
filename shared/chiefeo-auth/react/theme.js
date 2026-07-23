/**
 * shared/chiefeo-auth/react/theme.js
 *
 * Purpose: All the hub-specific look-and-copy that used to be hard-coded inside
 *          the auth components now lives here as DEFAULTS, and is fully
 *          overridable per tool. A tool tweaks its palette/brand once (on
 *          <AuthProvider> or per component) and every auth surface follows.
 *
 * Three parameter groups:
 *   theme  → colors + font (visual identity)
 *   brand  → product/tool name + links (identity strings shown in copy)
 *   copy   → the exact user-facing strings (fully swappable wording)
 *
 * Consumption:
 *   - <AuthProvider theme brand copy> publishes them via BrandingContext.
 *   - Each component calls useBranding(localProps) to get the effective,
 *     defaults-merged values — so a component also works standalone (no
 *     provider) using its own props or the built-in defaults.
 */

import { createContext, useContext } from 'react';

/** Default palette — the original chiefeotool.com blue set. */
export const defaultTheme = {
  ink: '#1e3a5f',
  accent: '#1d4ed8',
  border: '#c9dcf5',
  tintBg: '#eef4ff',
  errBg: '#fdecec',
  errInk: '#7a1f1f',
  fieldBorder: '#c9dcf5',
  googleBorder: '#d0d7e2',
  googleInk: '#1f2937',
  fontFamily:
    'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  monoFontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
};

/** Default brand identity strings. */
export const defaultBrand = {
  /** Product/tool name, available to copy overrides that want to interpolate it. */
  productName: 'ChiefEO Tools',
  /** Where the banner's link points when no onSignupClick handler is given. */
  signupHref: '/signup',
};

/** Default user-facing copy. Every string here is overridable per tool. */
export const defaultCopy = {
  // ReferralBanner
  bannerMessage: 'Create a free account to unlock referral rewards',
  bannerCta: 'Sign up / Sign in',
  bannerDismissLabel: 'Dismiss signup notice',
  bannerRegionLabel: 'Account signup notice',
  referralLinkLabel: 'Your referral link:',
  // AuthModal
  signupTitle: 'Create a free account',
  loginTitle: 'Log in',
  signupSubtitle: 'Optional — all tools stay fully usable without an account.',
  loginSubtitle: 'Welcome back.',
  googleButton: 'Continue with Google',
  orDivider: 'or',
  emailLabel: 'Email',
  passwordLabel: 'Password',
  signupSubmit: 'Create account',
  loginSubmit: 'Log in',
  workingLabel: 'Working…',
  resendLink: 'Resend link',
  haveAccount: 'Already have an account?',
  needAccount: 'Need an account?',
  switchToLogin: 'Log in',
  switchToSignup: 'Sign up',
  closeLabel: 'Close',
  // AccountMenu
  signOut: 'Sign out',
  signingOut: 'Signing out…',
  accountFallbackName: 'Account',
};

const BrandingContext = createContext(null);

export const BrandingProvider = BrandingContext.Provider;

/**
 * Effective branding for a component: defaults <- provider context <- local
 * props (most specific wins). Safe with no provider mounted.
 * @param {{ theme?: object, brand?: object, copy?: object }} [local]
 */
export function useBranding(local) {
  const ctx = useContext(BrandingContext) || {};
  const l = local || {};
  return {
    theme: { ...defaultTheme, ...(ctx.theme || {}), ...(l.theme || {}) },
    brand: { ...defaultBrand, ...(ctx.brand || {}), ...(l.brand || {}) },
    copy: { ...defaultCopy, ...(ctx.copy || {}), ...(l.copy || {}) },
  };
}
