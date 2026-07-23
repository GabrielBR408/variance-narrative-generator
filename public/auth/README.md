# public/auth — vendored ChiefEO auth core (served, same-origin)

`core/` here is a **verbatim vendored copy** of the canonical framework-free auth
core at `shared/chiefeo-auth/core/` (see `shared/chiefeo-auth/SYNC.md`).

It lives under `public/` so Vite copies it into `dist/` unchanged and it is
served at `/auth/core/*.js` on the hub's own origin. The Stacking Plan tool
(`public/stacking.html`, served at `/stacking`) is same-origin with the hub, so
it imports these files directly as browser ES modules — no bundler, no build
step — and shares the hub's Supabase session (localStorage) and `chiefeo_ref`
cookie automatically.

## Keep in sync

Do **not** edit these files. When the canonical
`shared/chiefeo-auth/core/*.js` changes, re-copy:

```powershell
Copy-Item -Force shared/chiefeo-auth/core/*.js public/auth/core/
```

Phase 3 will promote Stacking to its own repo + deploy; this vendored layout
(`public/auth/core/`) carries over unchanged as that repo's own copy.
