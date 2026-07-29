// --- Privacy Policy (chiefeotool.com/privacy) ------------------------------
// Rendered verbatim from the markdown source. Deep links such as /privacy#7-2
// resolve to section anchors stamped by rehypeSectionIds — see
// src/lib/legalDoc.js.

import React from 'react'
import LegalDocument from '../components/LegalDocument.jsx'
import privacyMarkdown from '../content/privacy-policy.md?raw'

export default function Privacy() {
  return <LegalDocument markdown={privacyMarkdown} />
}
