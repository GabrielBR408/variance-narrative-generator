# SYNC.md — how the shared auth module is distributed

## Decision: vendored copy (not npm, not a git submodule)

The module is distributed by **copying the source files into each tool's repo**.
The canonical copy lives here, at `shared/chiefeo-auth/` in the hub repo
(`variance-narrative-generator`). Each consuming tool holds its own vendored
copy and updates it with a file copy.

### Why this and not the alternatives

| Option | Verdict | Why |
| --- | --- | --- |
| **Vendored copy** ✅ | chosen | Zero infra. Works for the zero-build vanilla tool (it just serves the `.js` files). No registry, no auth tokens, no version-resolution step, no build pipeline. A solo maintainer copies files and commits. Each tool pins its own copy, so an update to one tool can't break another until it's copied in. |
| npm publish | rejected | Requires a registry (private or public), a publish/version workflow, and a bundler in **every** consumer — but the GL Down Driller has no bundler. UMD/ESM dual-packaging is more machinery than a one-person toolset warrants. |
| git submodule | rejected | Fragile in practice (detached HEADs, `--recursive` clones, contributors who forget to init). Deploy targets (Vercel static) don't always resolve submodules cleanly. |
| Symlink / monorepo import | rejected | The tools live in separate repos / separate Vercel projects; there's no shared filesystem at build or deploy time. |

The one real cost of vendoring — drift between copies — is handled by the
version stamp and the copy procedure below.

---

## Layout in a consuming tool

Copy the folder to a predictable path and import from it.

**React tool (e.g. Owner Report Generator, a Vite app):**
```
<tool-repo>/
└── shared/chiefeo-auth/
    ├── core/     ← copy verbatim
    └── react/    ← copy verbatim
```
Import: `import { AccountShell, useOptionalAuth } from '../shared/chiefeo-auth/react/index.js'`

**Vanilla tool (GL Down Driller, zero build):**
```
<tool-repo>/
└── auth/          ← copy ONLY core/ (react/ is not needed)
    └── core/
```
Import in a `<script type="module">`: `import { configureAuth, getSupabase } from './auth/core/index.js'`
(You do not need `react/`, `index.d.ts`, or `examples/` — `core/*.js` is enough.)

---

## Update procedure

1. **Make the change here first**, in the hub repo's canonical
   `shared/chiefeo-auth/`. Bump the `VERSION` marker (bottom of this file) — it is
   the single source of truth for the module version — and mention it in the commit.
2. **Copy into each tool.** From the tool repo root:

   PowerShell (Windows):
   ```powershell
   # React tool — copy both subfolders
   Copy-Item -Recurse -Force <hub>/shared/chiefeo-auth/core  ./shared/chiefeo-auth/
   Copy-Item -Recurse -Force <hub>/shared/chiefeo-auth/react ./shared/chiefeo-auth/

   # Vanilla tool — core only
   Copy-Item -Recurse -Force <hub>/shared/chiefeo-auth/core ./auth/
   ```

   bash / macOS / Linux:
   ```bash
   # React tool
   rsync -a --delete <hub>/shared/chiefeo-auth/core  ./shared/chiefeo-auth/
   rsync -a --delete <hub>/shared/chiefeo-auth/react ./shared/chiefeo-auth/

   # Vanilla tool — core only
   rsync -a --delete <hub>/shared/chiefeo-auth/core ./auth/
   ```
3. **Do NOT edit the vendored copy in a tool.** Tool-specific look and copy are
   passed as `theme` / `brand` / `copy` props (React) or `configureAuth()` values
   (vanilla) — never by forking the files. Keeping the vendored files byte-for-byte
   identical to canonical is what makes the copy safe.
4. **Verify** the tool builds/runs and that anonymous access is unchanged.

### What must never differ between copies

- The referral alphabet in `core/referrals.js` (`A–Z2–9` minus `O 0 I 1 L`) and
  `REFERRAL_THRESHOLD` — these mirror the live database. Editing one copy silently
  desyncs referral validation across tools.
- The cookie name `chiefeo_ref` — it's shared across all `*.chiefeotool.com`
  surfaces so a `?ref=` captured on one tool attributes on signup at another.
- The Supabase project id `dsmbppzvembacitwdrsj` and anon-key-only rule.

---

## VERSION

```
chiefeo-auth v1.0.0  (initial extraction from hub Phase 1 auth)
```

When you change any file under `shared/chiefeo-auth/`, bump this and note it in
the commit so each tool can tell whether its vendored copy is current. A simple
convention: a tool that has copied v1.0.0 can add a one-line
`shared/chiefeo-auth/VENDORED_VERSION` file recording the version it holds.
