/**
 * src/lib/auth/refCapture.ts
 *
 * Purpose: SPA replacement for the Next.js middleware's `?ref=` capture.
 *          On app load, reads the `ref` query param from the URL, validates
 *          it, and stores it in the `chiefeo_ref` cookie (30 days). At
 *          signup, the stored code rides along in auth metadata so the
 *          database trigger (handle_new_user, already live) can attribute
 *          the referral.
 *
 * Integration notes:
 * - captureReferralCode() is called automatically by <AuthProvider> on
 *   mount, so wrapping the app is the only wiring needed. It is idempotent
 *   and safe to call again anywhere.
 * - Cookie (not localStorage) keeps parity with the original design and the
 *   docs; falls back silently if document.cookie is unavailable.
 * - The URL is left untouched (no history rewrite) — harmless, and keeps
 *   this module side-effect-minimal.
 */

import { normalizeReferralCode } from '../referrals';

export const REF_COOKIE_NAME = 'chiefeo_ref';
const REF_COOKIE_MAX_AGE_DAYS = 30;

/**
 * Capture `?ref=CODE` from the current URL into the chiefeo_ref cookie.
 * Invalid/absent codes are ignored. Returns the captured code, the
 * previously stored code, or null. Never throws.
 */
export function captureReferralCode(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('ref');
    if (raw !== null) {
      const code = normalizeReferralCode(raw);
      if (code !== null) {
        const maxAge = REF_COOKIE_MAX_AGE_DAYS * 24 * 60 * 60;
        document.cookie = `${REF_COOKIE_NAME}=${encodeURIComponent(
          code
        )}; max-age=${maxAge}; path=/; samesite=lax`;
        return code;
      }
    }
    return getStoredReferralCode();
  } catch {
    return null;
  }
}

/**
 * Read the stored referral code from the cookie, re-validating it.
 * Returns null when absent or invalid. Never throws.
 */
export function getStoredReferralCode(): string | null {
  try {
    const match = document.cookie
      .split('; ')
      .find((c) => c.startsWith(`${REF_COOKIE_NAME}=`));
    if (!match) return null;
    const value = decodeURIComponent(match.slice(REF_COOKIE_NAME.length + 1));
    return normalizeReferralCode(value);
  } catch {
    return null;
  }
}
