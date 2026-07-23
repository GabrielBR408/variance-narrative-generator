/**
 * src/components/auth/AccountShell.jsx
 *
 * The single wrap that gives every in-repo view (the hub and the VNG app)
 * optional-auth awareness:
 *   - <AuthProvider>  → ?ref= capture, session pickup after the email
 *                       verification redirect, and auth state for the tools.
 *   - <ReferralBanner> → dismissible anon nudge at the top of the page.
 *   - <AuthModal>      → opened by the banner's "Sign up" button.
 *
 * Zero behavior change for anon users beyond the dismissible banner: children
 * always render immediately, nothing gates or redirects (Phase 1 contract).
 */

import React, { useState } from 'react'
import { AuthProvider } from './AuthProvider'
import { ReferralBanner } from './ReferralBanner'
import AuthModal from './AuthModal'

const bannerWrap = {
  maxWidth: '960px',
  margin: '0 auto',
  padding: '10px 16px 0',
}

export default function AccountShell({ children }) {
  const [showAuth, setShowAuth] = useState(false)

  return (
    <AuthProvider>
      <div style={bannerWrap}>
        <ReferralBanner onSignupClick={() => setShowAuth(true)} />
      </div>
      {children}
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </AuthProvider>
  )
}
