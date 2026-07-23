/**
 * shared/chiefeo-auth/react/index.js
 *
 * React entry point for the ChiefEO auth module. Re-exports the components,
 * the hook, and the branding defaults. The framework-free core is available
 * as a sibling import ('../core/index.js') for anything a tool needs to call
 * directly (e.g. getMyReferralStats, getSupabase) — and is also re-exported
 * here for convenience.
 */

// React surface
export { AuthProvider, OptionalAuthContext, ANON_AUTH_STATE } from './AuthProvider.jsx';
export { useOptionalAuth } from './useOptionalAuth.js';
export { ReferralBanner } from './ReferralBanner.jsx';
export { default as AuthModal } from './AuthModal.jsx';
export { default as AccountMenu } from './AccountMenu.jsx';
export { default as AccountShell } from './AccountShell.jsx';

// Branding defaults (for tools that want to read/extend them)
export {
  defaultTheme,
  defaultBrand,
  defaultCopy,
  useBranding,
  BrandingProvider,
} from './theme.js';

// Convenience re-exports of the framework-free core
export {
  configureAuth,
  getConfig,
  getSiteUrl,
  getSupabase,
  REFERRAL_THRESHOLD,
  getReferralLink,
  normalizeReferralCode,
  getReferralProgress,
  getMyReferralStats,
  REF_COOKIE_NAME,
  captureReferralCode,
  getStoredReferralCode,
  signUpWithEmail,
  signInWithEmail,
  signInWithGoogle,
  signOut,
  resendVerification,
} from '../core/index.js';
