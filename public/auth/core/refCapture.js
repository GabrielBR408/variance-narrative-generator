/**
 * shared/chiefeo-auth/core/refCapture.js
 *
 * Purpose: Browser-side `?ref=` capture. On app load, reads the `ref` query
 *          param, validates it, and stores it in the `chiefeo_ref` cookie
 *          (30 days). At signup the stored code rides along in auth metadata so
 *          the DB trigger (handle_new_user) can attribute the referral.
 *
 * Notes:
 * - Cookie (not localStorage) for restricted-context safety and parity with the
 *   original design; falls back silently when document.cookie is unavailable.
 * - The URL is left untouched (no history rewrite) — side-effect-minimal.
 * - Idempotent and safe to call repeatedly. Never throws.
 */

import { normalizeReferralCode } from './referrals.js';

export const REF_COOKIE_NAME = 'chiefeo_ref';
const REF_COOKIE_MAX_AGE_DAYS = 30;

/**
 * Capture `?ref=CODE` from the current URL into the chiefeo_ref cookie.
 * Invalid/absent codes are ignored. Returns the captured code, the previously
 * stored code, or null. Never throws.
 * @returns {string|null}
 */
export function captureReferralCode() {
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
 * @returns {string|null}
 */
export function getStoredReferralCode() {
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
