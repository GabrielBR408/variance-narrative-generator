/**
 * shared/chiefeo-auth/core/actions.js
 *
 * Purpose: Browser-side account actions — signup / login / Google OAuth /
 *          logout / resend-verification — running entirely via supabase-js.
 *          Framework-free: no server routes, no callback route. Email
 *          verification is required; the referred_by_code from the chiefeo_ref
 *          cookie rides along in signup metadata for the live handle_new_user
 *          DB trigger.
 *
 * Notes:
 * - All functions return a uniform { ok, message, code } result instead of
 *   throwing, so any UI (React or vanilla) can render outcomes without try/catch.
 * - No paywall, no gating — opt-in account actions only. Anonymous access is
 *   never affected.
 * - Redirects (email verify + OAuth) use the current origin when available,
 *   else the configured siteUrl. Both must be in the Supabase redirect
 *   allowlist.
 */

import { getSupabase } from './client.js';
import { getSiteUrl } from './config.js';
import { getStoredReferralCode } from './refCapture.js';

/**
 * @typedef {Object} AuthActionResult
 * @property {boolean} ok
 * @property {string} message  Human-friendly, safe to show in the UI.
 * @property {'ok'|'check_inbox'|'invalid_input'|'already_registered'|'needs_verification'|'invalid_credentials'|'rate_limited'|'env_missing'|'error'} code
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Where the verification email link lands. Uses the configured canonical
 * siteUrl (stable across environments), matching the Phase 1 hub behavior.
 */
function emailRedirect() {
  return getSiteUrl();
}

/**
 * Where OAuth returns to. Uses the current origin so it works on both
 * localhost and production (both allowlisted in the Supabase dashboard);
 * falls back to siteUrl when there is no window.
 */
function oauthRedirect() {
  return typeof window !== 'undefined' && window.location
    ? window.location.origin
    : getSiteUrl();
}

/** @returns {AuthActionResult} */
function envMissing() {
  return {
    ok: false,
    message:
      'Accounts are not available right now (auth is not configured). All tools remain fully usable.',
    code: 'env_missing',
  };
}

/**
 * Create an account. Email verification required — success means "check your
 * inbox", not "logged in". The stored referral code (if any) is attached as
 * referred_by_code metadata; the live DB trigger does the attribution. Passing
 * `ref` explicitly overrides the cookie.
 * @param {string} email
 * @param {string} password
 * @param {string=} ref
 * @returns {Promise<AuthActionResult>}
 */
export async function signUpWithEmail(email, password, ref) {
  const supabase = getSupabase();
  if (!supabase) return envMissing();

  const cleanEmail = String(email).trim().toLowerCase();
  if (!EMAIL_RE.test(cleanEmail)) {
    return { ok: false, message: 'Enter a valid email address.', code: 'invalid_input' };
  }
  if (String(password).length < 8) {
    return {
      ok: false,
      message: 'Password must be at least 8 characters.',
      code: 'invalid_input',
    };
  }

  const referredByCode = (ref && ref.trim()) || getStoredReferralCode();

  try {
    const { data, error } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: {
        emailRedirectTo: emailRedirect(),
        data: { referred_by_code: referredByCode ?? null },
      },
    });

    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('already registered') || msg.includes('already exists')) {
        return {
          ok: false,
          message: 'That email is already registered — try logging in instead.',
          code: 'already_registered',
        };
      }
      if (error.status === 429) {
        return {
          ok: false,
          message: 'Too many attempts — wait a minute and try again.',
          code: 'rate_limited',
        };
      }
      return { ok: false, message: error.message, code: 'error' };
    }

    // Supabase obfuscates existing accounts as a user with empty identities.
    if (data.user && (data.user.identities?.length ?? 0) === 0) {
      return {
        ok: false,
        message: 'That email is already registered — try logging in instead.',
        code: 'already_registered',
      };
    }

    return {
      ok: true,
      message: 'Almost there — check your inbox and click the verification link.',
      code: 'check_inbox',
    };
  } catch {
    return { ok: false, message: 'Signup failed — try again.', code: 'error' };
  }
}

/**
 * Password login. Unverified emails get a friendly nudge, not a raw error.
 * @param {string} email
 * @param {string} password
 * @returns {Promise<AuthActionResult>}
 */
export async function signInWithEmail(email, password) {
  const supabase = getSupabase();
  if (!supabase) return envMissing();

  try {
    const { error } = await supabase.auth.signInWithPassword({
      email: String(email).trim().toLowerCase(),
      password,
    });

    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('email not confirmed')) {
        return {
          ok: false,
          message:
            'Your email is not verified yet — check your inbox (or resend the link).',
          code: 'needs_verification',
        };
      }
      if (error.status === 429) {
        return {
          ok: false,
          message: 'Too many attempts — wait a minute and try again.',
          code: 'rate_limited',
        };
      }
      // Deliberately vague — do not reveal which field was wrong.
      return {
        ok: false,
        message: 'Invalid email or password.',
        code: 'invalid_credentials',
      };
    }

    return { ok: true, message: 'Logged in.', code: 'ok' };
  } catch {
    return { ok: false, message: 'Login failed — try again.', code: 'error' };
  }
}

/**
 * Start the Google OAuth flow. PKCE + detectSessionInUrl (configured on the
 * getSupabase() client) complete the returned session on redirect back — the
 * same path email verification uses, so no dedicated callback route is needed.
 * On success the browser navigates away to Google, so the returned result is
 * typically only seen on failure.
 * @returns {Promise<AuthActionResult>}
 */
export async function signInWithGoogle() {
  const supabase = getSupabase();
  if (!supabase) return envMissing();

  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: oauthRedirect() },
    });
    if (error) {
      return error.status === 429
        ? {
            ok: false,
            message: 'Too many attempts — wait a minute and try again.',
            code: 'rate_limited',
          }
        : { ok: false, message: error.message, code: 'error' };
    }
    // Browser redirects to Google; this is generally not reached.
    return { ok: true, message: 'Redirecting to Google…', code: 'ok' };
  } catch {
    return {
      ok: false,
      message: 'Could not start Google sign-in — try again.',
      code: 'error',
    };
  }
}

/**
 * Log out. Idempotent — succeeds even with no active session.
 * @returns {Promise<AuthActionResult>}
 */
export async function signOut() {
  const supabase = getSupabase();
  if (!supabase) return envMissing();
  try {
    await supabase.auth.signOut();
  } catch {
    // Session already gone locally — treat as success.
  }
  return { ok: true, message: 'Logged out.', code: 'ok' };
}

/**
 * Re-send the verification email for an unverified account.
 * @param {string} email
 * @returns {Promise<AuthActionResult>}
 */
export async function resendVerification(email) {
  const supabase = getSupabase();
  if (!supabase) return envMissing();
  try {
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: String(email).trim().toLowerCase(),
      options: { emailRedirectTo: emailRedirect() },
    });
    if (error) {
      return error.status === 429
        ? {
            ok: false,
            message: 'Too many attempts — wait a minute and try again.',
            code: 'rate_limited',
          }
        : { ok: false, message: error.message, code: 'error' };
    }
    return {
      ok: true,
      message: 'Verification email sent — check your inbox.',
      code: 'check_inbox',
    };
  } catch {
    return { ok: false, message: 'Could not resend — try again.', code: 'error' };
  }
}
