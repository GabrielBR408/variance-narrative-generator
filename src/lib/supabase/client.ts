/**
 * src/lib/supabase/client.ts
 *
 * Purpose: Singleton browser Supabase client for the chiefeotool.com Vite
 *          SPA. Replaces the Next.js @supabase/ssr plumbing from the
 *          original Phase 1 package — in a pure SPA, supabase-js handles
 *          sessions (localStorage) and the email-verification redirect
 *          (detectSessionInUrl) entirely in the browser; no server routes
 *          or middleware are needed.
 *
 * Integration notes:
 * - Env vars (Vite convention, set in .env.local and in Vercel):
 *     VITE_SUPABASE_URL=https://dsmbppzvembacitwdrsj.supabase.co
 *     VITE_SUPABASE_ANON_KEY=<anon key>
 * - getSupabase() returns null (never throws) when env is unconfigured, so
 *   the tools keep working before auth env is set — zero-breakage contract.
 * - PKCE flow: the verification email link redirects back to the site root;
 *   supabase-js detects the code in the URL on load and completes the
 *   session automatically. Ensure the Supabase dashboard redirect allowlist
 *   includes https://chiefeotool.com and http://localhost:5173.
 * - If the existing repo ALREADY creates a Supabase client (it posts
 *   app_events to this project), reconcile: keep ONE client instance
 *   app-wide. Either adopt this factory everywhere or add
 *   `flowType: 'pkce', detectSessionInUrl: true` to the existing one and
 *   re-export it here.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null | undefined;

/** Env access isolated here so tests can stub it. */
function readEnv(): { url: string | undefined; anonKey: string | undefined } {
  return {
    url: import.meta.env.VITE_SUPABASE_URL as string | undefined,
    anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined,
  };
}

/**
 * Returns the app-wide Supabase client, or null when env vars are absent or
 * client construction fails. Never throws.
 */
export function getSupabase(): SupabaseClient | null {
  if (cached !== undefined) return cached;

  const { url, anonKey } = readEnv();
  if (!url || !anonKey) {
    cached = null;
    return cached;
  }

  try {
    cached = createClient(url, anonKey, {
      auth: {
        flowType: 'pkce',
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    });
  } catch {
    cached = null;
  }
  return cached;
}
