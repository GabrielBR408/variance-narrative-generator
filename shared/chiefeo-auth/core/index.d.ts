/**
 * shared/chiefeo-auth/core/index.d.ts
 *
 * Type declarations for the framework-free ChiefEO auth core. The runtime is
 * plain .js (so it loads without a bundler); these ambient types give
 * TypeScript consumers full typing. `SupabaseClient`/`User` are referenced
 * structurally as `any` so this file has ZERO dependency on
 * @supabase/supabase-js — a consumer that has the package installed can pass
 * its real client and it will satisfy `any`.
 */

/** Exact shape of a row in `public.profiles`. */
export interface Profile {
  user_id: string;
  email: string;
  created_at: string;
  referral_code: string;
  referred_by: string | null;
  referral_count: number;
  free_until: string | null;
  deleted_at: string | null;
}

/** Machine codes returned by every auth action for UI branching. */
export type AuthActionCode =
  | 'ok'
  | 'check_inbox'
  | 'invalid_input'
  | 'already_registered'
  | 'needs_verification'
  | 'invalid_credentials'
  | 'rate_limited'
  | 'env_missing'
  | 'error';

/** Uniform result shape — actions never throw. */
export interface AuthActionResult {
  ok: boolean;
  message: string;
  code: AuthActionCode;
}

export interface ReferralProgress {
  count: number;
  nextRewardAt: number;
  rewardsEarned: number;
  freeUntil: Date | null;
  hasActiveFreeTime: boolean;
}

export interface MyReferralStats extends ReferralProgress {
  referralCode: string;
  referralLink: string;
}

export interface AuthConfig {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  siteUrl?: string;
  /** supabase-js createClient (npm import or window.supabase.createClient). */
  createClient?: (...args: any[]) => any;
}

// --- config ---------------------------------------------------------------
export function configureAuth(config: AuthConfig): void;
export function getConfig(): Required<Pick<AuthConfig, 'siteUrl'>> & AuthConfig;
export function getSiteUrl(): string;
export function onConfigChange(fn: () => void): () => void;

// --- client ---------------------------------------------------------------
/** The app-wide Supabase client, or null when unconfigured. Never throws. */
export function getSupabase(): any | null;

// --- referrals ------------------------------------------------------------
export const REFERRAL_THRESHOLD: number;
export function getReferralLink(code: string): string;
export function normalizeReferralCode(input: string): string | null;
export function getReferralProgress(profile: {
  referral_count: number;
  free_until: string | null;
}): ReferralProgress;
export function getMyReferralStats(supabase: any): Promise<MyReferralStats | null>;

// --- refCapture -----------------------------------------------------------
export const REF_COOKIE_NAME: string;
export function captureReferralCode(): string | null;
export function getStoredReferralCode(): string | null;

// --- actions --------------------------------------------------------------
export function signUpWithEmail(
  email: string,
  password: string,
  ref?: string
): Promise<AuthActionResult>;
export function signInWithEmail(
  email: string,
  password: string
): Promise<AuthActionResult>;
export function signInWithGoogle(): Promise<AuthActionResult>;
export function signOut(): Promise<AuthActionResult>;
export function resendVerification(email: string): Promise<AuthActionResult>;
