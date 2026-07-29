// --- Terms of Service (chiefeotool.com/tos) --------------------------------
// The markdown is the source of truth and is rendered verbatim; this route only
// hands it to the shared legal shell. Deep links such as /tos#5-2 (used by the
// in-app Claude API disclosure) resolve to section anchors stamped by
// rehypeSectionIds — see src/lib/legalDoc.js.

import React from 'react'
import LegalDocument from '../components/LegalDocument.jsx'
import termsMarkdown from '../content/terms-of-service.md?raw'

export default function Tos() {
  return <LegalDocument markdown={termsMarkdown} />
}
