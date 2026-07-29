import React from 'react'

// Site-wide footer: legal links + copyright, rendered on every React route
// (hub, VNG, Skills, and the legal pages themselves).
//
// The ToS/Privacy links are ordinary same-tab anchors — legal pages are part of
// this SPA (see the pathname switch in main.jsx), so opening them in a new tab
// would be gratuitous. The two optional slots keep the footers that already
// existed intact: `notice` is VNG's "verify figures" warning, `meta` its
// version/build line.

export default function Footer({ notice, meta }) {
  return (
    <footer className="site-footer">
      {notice && <p className="site-footer-line">{notice}</p>}

      <nav className="site-footer-links" aria-label="Legal">
        <a href="/tos">Terms of Service</a>
        <span className="site-footer-sep" aria-hidden="true">|</span>
        <a href="/privacy">Privacy Policy</a>
        <span className="site-footer-sep" aria-hidden="true">|</span>
        <a href="mailto:support@chiefeotool.com">Contact</a>
      </nav>

      <p className="site-footer-line site-footer-line--muted">
        &copy; 2026 Golden Real Estate Ventures and Exchanges LLC. All rights reserved.
      </p>

      {meta && <p className="site-footer-line site-footer-line--muted">{meta}</p>}
    </footer>
  )
}
