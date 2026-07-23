/**
 * src/components/auth/AccountShell.jsx  (hub adapter)
 *
 * Thin hub-specific wrapper over the shared, portable auth module
 * (shared/chiefeo-auth). All the auth logic and UI now live in that module;
 * this file only injects the two hub-specific things:
 *   1. Supabase config from the hub's Vite env (import.meta.env.VITE_*) plus the
 *      npm createClient — the shared core is framework-free and takes these
 *      by injection so it can also run in the zero-build vanilla tools.
 *   2. Nothing else: the hub uses the module's DEFAULT theme/brand/copy, which
 *      are exactly the original chiefeotool.com look and wording — so the hub
 *      renders and behaves identically to before the extraction.
 *
 * Phase 1 contract is unchanged: anon users keep 100% tool access; this never
 * gates or redirects. No gating added. Anonymous access unchanged.
 */

import React from 'react';
import { createClient } from '@supabase/supabase-js';
import { AccountShell as SharedAccountShell } from '../../../shared/chiefeo-auth/react/index.js';

export default function AccountShell({ children }) {
  return (
    <SharedAccountShell
      supabaseUrl={import.meta.env.VITE_SUPABASE_URL}
      supabaseAnonKey={import.meta.env.VITE_SUPABASE_ANON_KEY}
      siteUrl={import.meta.env.VITE_SITE_URL}
      createClient={createClient}
    >
      {children}
    </SharedAccountShell>
  );
}
