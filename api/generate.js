// Vercel serverless function — VR-1.
// Ports the /generate endpoint to api/generate.js so it runs as a Vercel
// serverless function in production. All logic (LLM, rate limiter, circuit
// breaker, fallback) lives in server/generate.js and server/llm.js; this
// file is a thin adapter that mounts the shared handler for Vercel's runtime.
//
// Disable Vercel's built-in body parser so Busboy can handle the raw
// multipart stream directly — exactly as it does in the Vite middleware.
export const config = {
  api: {
    bodyParser: false,
    // Allow up to 25 MB request bodies to match the per-file size limit.
    // Note: Vercel's Pro plan supports larger payloads; the free tier caps at
    // 4.5 MB. Adjust this value at the deployment level if needed.
    responseLimit: false
  }
}

import { handleGenerate } from '../server/generate.js'

// Vercel calls this for every request to /api/generate.
// The shared handleGenerate already enforces POST-only via the Vite middleware
// wrapper; here we guard at the function level too so non-POST requests get a
// clean 405 instead of hitting Busboy with an unexpected method.
export default function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.setHeader('Allow', 'POST')
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ success: false, error: 'Method not allowed.' }))
    return
  }
  handleGenerate(req, res)
}
