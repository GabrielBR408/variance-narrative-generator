/**
 * src/chiefeo-auth-env.d.ts
 *
 * Purpose: Type declarations for the auth layer's Vite env vars. If the
 *          repo already augments ImportMetaEnv in vite-env.d.ts, merge
 *          these three fields there instead and delete this file.
 */

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_SITE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
