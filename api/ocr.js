// Vercel serverless function — OCR for scanned PDF General Ledgers.
// Thin adapter mounting the shared handler (server/ocr.js). The client renders a
// scanned PDF's pages to images and POSTs them here as JSON; the handler runs
// Claude vision (when OCR_ENABLED=true) and returns structured GL accounts.
//
// Vercel's body parser is disabled so the handler can read the raw JSON stream
// with its own size cap (image payloads are large).
export const config = {
  api: {
    bodyParser: false,
    responseLimit: false
  }
}

import { handleOcr } from '../server/ocr.js'

export default function handler(req, res) {
  return handleOcr(req, res)
}
