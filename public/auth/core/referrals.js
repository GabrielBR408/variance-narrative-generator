/**
 * shared/chiefeo-auth/core/referrals.js
 *
 * Purpose: Referral utilities for the ChiefEO auth core (framework-free):
 *          link generation, referral-code validation, and progress math for
 *          the "N verified signups => reward" unlock.
 *
 * Notes:
 * - Pure functions (getReferralLink, normalizeReferralCode, getReferralProgress)
 *   have no I/O and are directly unit-testable.
 * - getMyReferralStats takes any SupabaseClient (pass getSupabase()). It reads
 *   only the caller's own profile row; RLS restricts to user_id = auth.uid(),
 *   so the anon-key client is safe.
 * - Server-side counting/unlock logic is LIVE in the database; nothing here
 *   mutates referral state. free_until is bookkeeping only — NO paywall.
 * - REFERRAL_THRESHOLD mirrors public.referral_reward_threshold() in the DB
 *   (authoritative). If one is tuned, tune both.
 */

import { getSiteUrl } from './config.js';

/** Verified referrals needed per reward. Display constant; DB is authoritative. */
export const REFERRAL_THRESHOLD = 3;

/**
 * Referral code alphabet: uppercase A–Z plus digits 2–9, excluding the
 * ambiguous characters O, 0, I, 1, L (matches public.generate_referral_code()).
 */
const REFERRAL_CODE_RE = /^[A-HJKMNP-Z2-9]{8}$/;

/**
 * Build the shareable referral link for a code, e.g.
 * `https://chiefeotool.com?ref=CODE`. The base is the configured siteUrl.
 * @param {string} code
 * @returns {string}
 */
export function getReferralLink(code) {
  return `${getSiteUrl()}?ref=${encodeURIComponent(code)}`;
}

/**
 * Normalize and validate a referral code from untrusted input (URL param,
 * cookie, form field). Trims, uppercases, then validates against the 8-char
 * alphabet. Returns the canonical code, or null if invalid.
 * @param {string} input
 * @returns {string|null}
 */
export function normalizeReferralCode(input) {
  const code = String(input).trim().toUpperCase();
  return REFERRAL_CODE_RE.test(code) ? code : null;
}

/**
 * Pure progress math over a profile row (or any object with the two fields).
 * `nextRewardAt` is the additional verified referrals needed to hit the next
 * multiple of REFERRAL_THRESHOLD — e.g. count 0 -> 3, count 2 -> 1, count 3 -> 3.
 * @param {{ referral_count: number, free_until: string|null }} profile
 * @returns {{ count: number, nextRewardAt: number, rewardsEarned: number, freeUntil: Date|null, hasActiveFreeTime: boolean }}
 */
export function getReferralProgress(profile) {
  const count = Math.max(0, profile.referral_count);
  const nextRewardAt = REFERRAL_THRESHOLD - (count % REFERRAL_THRESHOLD);
  const rewardsEarned = Math.floor(count / REFERRAL_THRESHOLD);

  const freeUntil =
    profile.free_until !== null && profile.free_until !== undefined
      ? new Date(profile.free_until)
      : null;
  const hasActiveFreeTime =
    freeUntil !== null &&
    !Number.isNaN(freeUntil.getTime()) &&
    freeUntil.getTime() > Date.now();

  return { count, nextRewardAt, rewardsEarned, freeUntil, hasActiveFreeTime };
}

/**
 * Fetch the signed-in caller's referral stats. Returns null when there is no
 * session (anon users — auth is optional), when the profile row is missing, or
 * when the profile is soft-deleted. Never throws.
 * @param {any} supabase  A SupabaseClient (e.g. getSupabase()).
 * @returns {Promise<Object|null>}
 */
export async function getMyReferralStats(supabase) {
  try {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError !== null || user === null) {
      return null; // anon — never an error state; auth is optional
    }

    const { data, error } = await supabase
      .from('profiles')
      .select(
        'user_id, email, created_at, referral_code, referred_by, referral_count, free_until, deleted_at'
      )
      .eq('user_id', user.id)
      .maybeSingle();

    if (error !== null || data === null) {
      return null;
    }

    if (data.deleted_at !== null) {
      return null; // treat soft-deleted as deleted everywhere
    }

    return {
      referralCode: data.referral_code,
      referralLink: getReferralLink(data.referral_code),
      ...getReferralProgress(data),
    };
  } catch {
    return null;
  }
}
