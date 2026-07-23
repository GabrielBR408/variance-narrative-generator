/**
 * shared/chiefeo-auth/core/index.js
 *
 * Framework-free ChiefEO auth core — the single entry point for any tool that
 * needs auth WITHOUT React: a Vite/React app (imported by ../react), a
 * zero-build vanilla page (imported directly as an ES module, with
 * createClient supplied from the supabase-js UMD global), or a Node test.
 *
 * Nothing here depends on React, on a bundler, on import.meta, or on the
 * `@supabase/supabase-js` package specifier. Wire it once:
 *
 *   import { configureAuth } from './core/index.js'
 *   configureAuth({
 *     supabaseUrl: '...', supabaseAnonKey: '...',
 *     siteUrl: 'https://chiefeotool.com',
 *     createClient: window.supabase.createClient, // or the npm import
 *   })
 *
 * Then getSupabase(), the actions, and refCapture all work.
 */

export { configureAuth, getConfig, getSiteUrl, onConfigChange } from './config.js';
export { getSupabase } from './client.js';
export {
  REFERRAL_THRESHOLD,
  getReferralLink,
  normalizeReferralCode,
  getReferralProgress,
  getMyReferralStats,
} from './referrals.js';
export {
  REF_COOKIE_NAME,
  captureReferralCode,
  getStoredReferralCode,
} from './refCapture.js';
export {
  signUpWithEmail,
  signInWithEmail,
  signInWithGoogle,
  signOut,
  resendVerification,
} from './actions.js';
