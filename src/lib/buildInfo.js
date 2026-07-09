// --- Build stamp -----------------------------------------------------------
// Compile-time constants injected by Vite's `define` block (see vite.config.js):
//   __APP_VERSION__ — the package.json version at build time
//   __COMMIT_SHA__  — the deploy commit (VERCEL_GIT_COMMIT_SHA) or 'dev' locally
// The `typeof` guards keep this importable outside a Vite build (e.g. plain Node)
// where the defines don't exist, falling back to safe placeholders.
export const version = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'
export const commit = typeof __COMMIT_SHA__ !== 'undefined' ? __COMMIT_SHA__ : 'dev'
export const shortCommit = commit.slice(0, 7)

export default { version, commit, shortCommit }
