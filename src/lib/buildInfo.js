// Build stamp injected at build time by vite.config.js (`define`): the
// package.json version plus the short git commit SHA (Vercel's
// VERCEL_GIT_COMMIT_SHA in CI, `git rev-parse` locally). The typeof guards
// matter: this module must also load under plain `node --test`, where Vite's
// compile-time globals are never injected.
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'
export const COMMIT_SHA = typeof __COMMIT_SHA__ !== 'undefined' ? __COMMIT_SHA__ : 'local'
