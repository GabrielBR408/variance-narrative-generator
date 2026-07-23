# @chiefeo/auth — shared optional-auth module

Portable, framework-light browser auth for every ChiefEO tool. Extracted from
the Phase 1 auth layer in the hub repo (`variance-narrative-generator`) so the
other tools (Owner Report Generator, GL Down Driller, ChiefEO Inspector) reuse
**one** canonical implementation.

**No gating. No paywall. Anonymous access is never affected.** This is
auth-*awareness* — a signup nudge, an account menu, referral capture, and the
account actions behind them. Every tool stays 100% usable logged out.

---

## What's in the box

```
shared/chiefeo-auth/
├── core/                 Framework-free. Plain ES-module .js — NO React, NO
│   │                     bundler, NO import.meta, NO npm bare-imports.
│   ├── config.js         configureAuth() / getConfig() / getSiteUrl()
│   ├── client.js         getSupabase()  (built via the injected createClient)
│   ├── referrals.js      normalizeReferralCode / getReferralLink / progress / stats
│   ├── refCapture.js     captureReferralCode / getStoredReferralCode
│   ├── actions.js        signUp / signIn / Google / signOut / resend
│   ├── index.js          barrel export
│   └── index.d.ts        TypeScript declarations (runtime stays plain .js)
├── react/                React layer (.jsx). All hub styling/copy PARAMETERIZED.
│   ├── theme.js          defaultTheme / defaultBrand / defaultCopy + useBranding
│   ├── AuthProvider.jsx  context + injects config into core + publishes branding
│   ├── useOptionalAuth.js
│   ├── ReferralBanner.jsx
│   ├── AuthModal.jsx
│   ├── AccountMenu.jsx
│   ├── AccountShell.jsx  one-wrap convenience (provider + banner + menu + modal)
│   └── index.js          barrel export
├── examples/
│   └── vanilla/          zero-build page consuming core via the supabase-js CDN UMD
├── README.md             (this file)
└── SYNC.md               how the vendored copy is distributed / updated
```

### Why the core has no imports of its own

The GL Down Driller is a zero-build vanilla-JS page. It loads supabase-js from a
CDN as a UMD global (`window.supabase`) and imports `core/index.js` directly as
a browser ES module. A browser can't resolve `import ... from
'@supabase/supabase-js'` and has no `import.meta.env`. So the core takes **all**
environment through one `configureAuth()` call and builds its client from an
**injected** `createClient`. The same core, unchanged, runs under Vite where
`createClient` is the npm import.

---

## Distribution: vendored copy

There is no npm publish and no build step. The canonical source lives here, in
the hub repo. Each tool keeps a **vendored copy** of `core/` (and, for React
tools, `react/`) inside its own repo. Updating is a file copy. See **SYNC.md**
for the exact procedure and the rationale.

---

## Public API

### Core (framework-free) — `core/index.js`

| Export | Signature | Notes |
| --- | --- | --- |
| `configureAuth` | `(config) => void` | Call once at startup. `config: { supabaseUrl, supabaseAnonKey, siteUrl?, createClient }`. Idempotent; omitted fields don't clobber. |
| `getConfig` | `() => AuthConfig` | Current config snapshot. |
| `getSiteUrl` | `() => string` | Canonical site URL, trailing slash stripped. |
| `getSupabase` | `() => SupabaseClient \| null` | Singleton. `null` (never throws) when unconfigured. |
| `signUpWithEmail` | `(email, password, ref?) => Promise<AuthActionResult>` | Email verification required → `code: 'check_inbox'`. Attaches stored referral code. |
| `signInWithEmail` | `(email, password) => Promise<AuthActionResult>` | |
| `signInWithGoogle` | `() => Promise<AuthActionResult>` | Redirects to Google on success. |
| `signOut` | `() => Promise<AuthActionResult>` | Idempotent. |
| `resendVerification` | `(email) => Promise<AuthActionResult>` | |
| `captureReferralCode` | `() => string \| null` | Reads `?ref=`, writes `chiefeo_ref` cookie (30d). Called for you by `<AuthProvider>`. |
| `getStoredReferralCode` | `() => string \| null` | |
| `normalizeReferralCode` | `(input) => string \| null` | 8-char `A–Z2–9` minus `O 0 I 1 L`. |
| `getReferralLink` | `(code) => string` | `${siteUrl}?ref=CODE`. |
| `getReferralProgress` | `(profile) => ReferralProgress` | Pure math. |
| `getMyReferralStats` | `(supabase) => Promise<MyReferralStats \| null>` | Reads caller's own profile row (RLS-safe). |
| `REFERRAL_THRESHOLD` | `number` (3) | Mirrors the DB; display only. |
| `REF_COOKIE_NAME` | `string` (`'chiefeo_ref'`) | |

`AuthActionResult = { ok: boolean, message: string, code: 'ok' | 'check_inbox' | 'invalid_input' | 'already_registered' | 'needs_verification' | 'invalid_credentials' | 'rate_limited' | 'env_missing' | 'error' }`

**Actions never throw** — they always resolve to an `AuthActionResult`. Render
`message`; branch UI on `code`.

### React — `react/index.js`

| Export | Kind | Key props |
| --- | --- | --- |
| `AuthProvider` | component | `supabaseUrl`, `supabaseAnonKey`, `siteUrl`, `createClient`, `theme`, `brand`, `copy`, `children` |
| `useOptionalAuth` | hook | → `{ isLoggedIn, user, profile, referralCode, loading }`. Never throws; anon fallback outside a provider. |
| `ReferralBanner` | component | `onSignupClick`, `signupHref`, `showReferralLinkWhenLoggedIn`, `theme`, `brand`, `copy` |
| `AuthModal` | component (default) | `onClose`, `theme`, `brand`, `copy` |
| `AccountMenu` | component (default) | `theme`, `copy` |
| `AccountShell` | component (default) | all `AuthProvider` props + `bannerWrapStyle`, `showReferralLinkWhenLoggedIn` |
| `defaultTheme` / `defaultBrand` / `defaultCopy` | objects | the built-in ChiefEO look/copy to read or extend |
| `useBranding` / `BrandingProvider` | hook / component | for custom compositions |

#### Parameterization (no hub styling is hard-coded)

Three override groups, merged **defaults → `<AuthProvider>` → per-component props**:

- **`theme`** — `ink`, `accent`, `border`, `tintBg`, `errBg`, `errInk`,
  `fieldBorder`, `googleBorder`, `googleInk`, `fontFamily`, `monoFontFamily`.
- **`brand`** — `productName`, `signupHref`.
- **`copy`** — every user-facing string (`bannerMessage`, `bannerCta`,
  `signupTitle`, `loginTitle`, `signupSubtitle`, `signOut`, …). See
  `react/theme.js` for the full list.

A tool that passes nothing renders exactly the original ChiefEO hub look.

---

## Usage

### React tool (has a bundler)

```jsx
import { createClient } from '@supabase/supabase-js';
import { AccountShell } from '../shared/chiefeo-auth/react/index.js';

<AccountShell
  supabaseUrl={import.meta.env.VITE_SUPABASE_URL}
  supabaseAnonKey={import.meta.env.VITE_SUPABASE_ANON_KEY}
  siteUrl={import.meta.env.VITE_SITE_URL}
  createClient={createClient}
  // Optional rebrand — omit for the default ChiefEO look:
  theme={{ accent: '#0f766e' }}
  brand={{ productName: 'GL Down Driller' }}
  copy={{ bannerMessage: 'Create a free account to save your drills' }}
>
  <YourApp />
</AccountShell>
```

Read state anywhere below it:

```jsx
import { useOptionalAuth } from '../shared/chiefeo-auth/react/index.js';
const { isLoggedIn, user, referralCode } = useOptionalAuth();
```

### Vanilla tool (zero build, supabase-js via CDN)

See `examples/vanilla/index.html`. In short:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
<script type="module">
  import { configureAuth, captureReferralCode, getSupabase, signInWithEmail }
    from './core/index.js';

  configureAuth({
    supabaseUrl: 'https://dsmbppzvembacitwdrsj.supabase.co',
    supabaseAnonKey: 'sb_publishable_…',           // anon/publishable key ONLY
    siteUrl: 'https://chiefeotool.com',
    createClient: window.supabase.createClient,     // the UMD global
  });

  captureReferralCode();                            // ?ref= → chiefeo_ref cookie
  const { data } = await getSupabase().auth.getUser();
  // …wire your own buttons to signInWithEmail(...) etc.
</script>
```

---

## Constraints honored (non-negotiable)

- **Browser-side only**: supabase-js, PKCE, `detectSessionInUrl`. No server
  routes, no callback route.
- **Anon key only**, never `service_role`. Supabase project
  `dsmbppzvembacitwdrsj`. No migrations.
- **No gating / no paywall.** Anonymous access unchanged.
