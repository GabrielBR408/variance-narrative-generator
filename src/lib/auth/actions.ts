/**
 * src/lib/auth/actions.ts
 *
 * Purpose: SPA replacements for the Next.js /auth/* route handlers.
 *          Signup / login / logout / resend-verification, all running in
 *          the browser via supabase-js. Email verification is required;
 *          the referred_by_code from the chiefeo_ref cookie rides along in
 *          signup metadata for the live handle_new_user DB trigger.
 *
 * Integration notes:
 * - All functions return a uniform { ok, message, code } result instead of
 *   throwing, so tool UIs can render outcomes without try/catch.
 * - No paywall, no gating — these are opt-in account actions only.
 * - Email verification flow: signUp -> Supabase sends the confirmation
 *   email -> link redirects to the site root -> supabase-js
 *   (detectSessionInUrl) completes the session on load -> the
 *   on_auth_user_verified DB trigger counts the referral.
 * - Supabase dashboard prerequisites: Site URL https://chiefeotool.com;
 *   redirect allowlist includes https://chiefeotool.com and
 *   http://localhost:5173; email confirmations ON.
 */

import { getSupabase } from '../supabase/client';
import { getStoredReferralCode } from './refCapture';

export interface AuthActionResult {
  ok: boolean;
  /** Human-friendly message safe to show in the UI. */
  message: string;
  /** Stable machine code for branching UI logic. */
  code:
    | 'ok'
    | 'check_inbox'
    | 'invalid_input'
    | 'already_registered'
    | 'needs_verification'
    | 'invalid_credentials'
    | 'rate_limited'
    | 'env_missing'
    | 'error';
}

const SITE_URL: string =
  ((import.meta.env.VITE_SITE_URL as string | undefined) ??
    'https://chiefeotool.com').replace(/\/+$/, '');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function envMissing(): AuthActionResult {
  return {
    ok: false,
    message:
      'Accounts are not available right now (auth is not configured). All tools remain fully usable.',
    code: 'env_missing',
  };
}

/**
 * Create an account. Email verification required — success means
 * "check your inbox", not "logged in". The stored referral code (if any)
 * is attached as referred_by_code metadata; the live DB trigger does the
 * attribution. Passing `ref` explicitly overrides the cookie.
 */
export async function signUpWithEmail(
  email: string,
  password: string,
  ref?: string
): Promise<AuthActionResult> {
  const supabase = getSupabase();
  if (!supabase) return envMissing();

  const cleanEmail = email.trim().toLowerCase();
  if (!EMAIL_RE.test(cleanEmail)) {
    return { ok: false, message: 'Enter a valid email address.', code: 'invalid_input' };
  }
  if (password.length < 8) {
    return {
      ok: false,
      message: 'Password must be at least 8 characters.',
      code: 'invalid_input',
    };
  }

  const referredByCode = ref?.trim() || getStoredReferralCode();

  try {
    const { data, error } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: {
        emailRedirectTo: SITE_URL,
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

/** Password login. Unverified emails get a friendly nudge, not a raw error. */
export async function signInWithEmail(
  email: string,
  password: string
): Promise<AuthActionResult> {
  const supabase = getSupabase();
  if (!supabase) return envMissing();

  try {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
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
 * getSupabase() client) complete the returned session on redirect back —
 * the same path email verification uses, so no dedicated callback route is
 * needed. redirectTo is the current origin so it works on both
 * http://localhost:5173 and https://chiefeotool.com (both allowlisted in the
 * Supabase dashboard). On success the browser navigates away to Google, so
 * the returned result is typically only seen on failure.
 */
export async function signInWithGoogle(): Promise<AuthActionResult> {
  const supabase = getSupabase();
  if (!supabase) return envMissing();

  const redirectTo =
    typeof window !== 'undefined' ? window.location.origin : SITE_URL;

  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
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

/** Log out. Idempotent — succeeds even with no active session. */
export async function signOut(): Promise<AuthActionResult> {
  const supabase = getSupabase();
  if (!supabase) return envMissing();
  try {
    await supabase.auth.signOut();
  } catch {
    // Session already gone locally — treat as success.
  }
  return { ok: true, message: 'Logged out.', code: 'ok' };
}

/** Re-send the verification email for an unverified account. */
export async function resendVerification(
  email: string
): Promise<AuthActionResult> {
  const supabase = getSupabase();
  if (!supabase) return envMissing();
  try {
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: SITE_URL },
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
    return { ok: true, message: 'Verification email sent — check your inbox.', code: 'check_inbox' };
  } catch {
    return { ok: false, message: 'Could not resend — try again.', code: 'error' };
  }
}
