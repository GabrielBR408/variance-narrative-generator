/**
 * src/lib/referrals.ts
 *
 * Purpose: Referral utilities for ChiefEO Phase 1 (Vite edition): link
 *          generation, referral-code validation, and progress math for the
 *          "3 verified signups => 6 months free" unlock.
 *
 * Integration notes:
 * - Pure functions (getReferralLink, normalizeReferralCode,
 *   getReferralProgress) have no I/O and are directly unit-testable.
 * - getMyReferralStats takes any SupabaseClient (pass getSupabase()). It
 *   reads only the caller's own profile row; RLS restricts to
 *   `user_id = auth.uid()`, so the anon-key client is safe.
 * - Server-side counting/unlock logic is ALREADY LIVE in the database
 *   (referral_logic migration); nothing here mutates referral state.
 *   free_until is bookkeeping only — NO paywall in Phase 1.
 * - REFERRAL_THRESHOLD must stay in sync with
 *   public.referral_reward_threshold() in the database (authoritative).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Profile } from './auth/types';

/**
 * Verified referrals needed per reward. UI/display constant — the
 * authoritative value is public.referral_reward_threshold() in the DB.
 * If Gabe tunes one, tune both.
 */
export const REFERRAL_THRESHOLD = 3;

/**
 * Referral code alphabet: uppercase A–Z plus digits 2–9, excluding the
 * ambiguous characters O, 0, I, 1, L (matches
 * public.generate_referral_code() in the live database).
 */
const REFERRAL_CODE_RE = /^[A-HJKMNP-Z2-9]{8}$/;

/** Base site URL, with fallback for local/dev where env may be unset. */
function getSiteUrl(): string {
  const url =
    (import.meta.env.VITE_SITE_URL as string | undefined) ??
    'https://chiefeotool.com';
  return url.replace(/\/+$/, ''); // strip trailing slash(es)
}

/**
 * Build the shareable referral link for a code:
 * `https://chiefeotool.com?ref=CODE`.
 * The `ref` param is captured into the `chiefeo_ref` cookie on app load
 * (see auth/refCapture.ts) and attached to signUp metadata.
 */
export function getReferralLink(code: string): string {
  return `${getSiteUrl()}?ref=${encodeURIComponent(code)}`;
}

/**
 * Normalize and validate a referral code from untrusted input (URL param,
 * cookie, form field). Trims whitespace, uppercases, then validates against
 * the 8-char alphabet. Returns the canonical code, or null if invalid.
 */
export function normalizeReferralCode(input: string): string | null {
  const code = input.trim().toUpperCase();
  return REFERRAL_CODE_RE.test(code) ? code : null;
}

export interface ReferralProgress {
  /** Total verified referrals credited to this user. */
  count: number;
  /** Verified referrals remaining until the next reward (1..THRESHOLD). */
  nextRewardAt: number;
  /** Rewards already earned: floor(count / THRESHOLD). */
  rewardsEarned: number;
  /** Parsed free_until, or null if never earned. */
  freeUntil: Date | null;
  /** True when free_until is set and in the future (bookkeeping only). */
  hasActiveFreeTime: boolean;
}

/**
 * Pure progress math over a profile row (or any object with the two fields).
 * `nextRewardAt` is the number of additional verified referrals needed to
 * hit the next multiple of REFERRAL_THRESHOLD — e.g. count 0 -> 3,
 * count 2 -> 1, count 3 -> 3 (next reward at 6).
 */
export function getReferralProgress(profile: {
  referral_count: number;
  free_until: string | null;
}): ReferralProgress {
  const count = Math.max(0, profile.referral_count);
  const nextRewardAt = REFERRAL_THRESHOLD - (count % REFERRAL_THRESHOLD);
  const rewardsEarned = Math.floor(count / REFERRAL_THRESHOLD);

  const freeUntil =
    profile.free_until !== null ? new Date(profile.free_until) : null;
  const hasActiveFreeTime =
    freeUntil !== null &&
    !Number.isNaN(freeUntil.getTime()) &&
    freeUntil.getTime() > Date.now();

  return { count, nextRewardAt, rewardsEarned, freeUntil, hasActiveFreeTime };
}

export interface MyReferralStats extends ReferralProgress {
  /** The caller's own 8-char referral code. */
  referralCode: string;
  /** Ready-to-share link: https://chiefeotool.com?ref=CODE */
  referralLink: string;
}

/**
 * Fetch the signed-in caller's referral stats. Returns null when there is
 * no session (anon users — auth is optional), when the profile row is
 * missing, or when the profile is soft-deleted. Never throws.
 */
export async function getMyReferralStats(
  supabase: SupabaseClient
): Promise<MyReferralStats | null> {
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

    const profile = data as Profile;
    if (profile.deleted_at !== null) {
      return null; // treat soft-deleted as deleted everywhere
    }

    return {
      referralCode: profile.referral_code,
      referralLink: getReferralLink(profile.referral_code),
      ...getReferralProgress(profile),
    };
  } catch {
    return null;
  }
}
