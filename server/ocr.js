// --- OCR infrastructure — Claude vision over scanned PDF GLs ---------------
// Feature-flagged OFF by default. Set OCR_ENABLED=true to activate. The page
// rendering happens on the CLIENT (pdf.js canvas); this server module receives
// the page images and asks a Claude vision model to transcribe the General
// Ledger's account sections + transactions as structured JSON. The Anthropic key
// stays server-side. ANTHROPIC_API_KEY is read from process.env only — never
// hardcoded, never logged.
//
// Boundaries: this NEVER throws to the caller. Any failure (disabled, no key,
// rate-limited, bad request, model/parse error) resolves to an empty result, so
// the client silently keeps the original "scanned, no text" extraction and no
// error is surfaced to the user.

import Anthropic from '@anthropic-ai/sdk'
import { checkIpLimit, checkGlobalLimit } from './llm.js'

// --- Feature flag + tunables (env-overridable) ------------------------------
export const OCR_ENABLED = process.env.OCR_ENABLED === 'true'
// Default to the cheapest current vision model; raise to Sonnet/Opus via env if
// rotated/dense scans need more accuracy.
export const OCR_MODEL = process.env.OCR_MODEL || 'claude-haiku-4-5-20251001'
export const OCR_MAX_PAGES = Number(process.env.OCR_MAX_PAGES) || 12
export const OCR_MAX_TOKENS = Number(process.env.OCR_MAX_TOKENS) || 8192

// Hard cap on the posted body so a runaway image payload can't exhaust memory.
const MAX_BODY_BYTES = 24 * 1024 * 1024

const OCR_SYSTEM =
  'You are a precise data-extraction engine for accounting documents. ' +
  'You transcribe exactly what is printed; you never invent, infer, or compute values that are not visible. ' +
  'You output only JSON.'

// Income-statement OCR prompt. Used when the text layer of a comparative P&L is
// unusable (non-standard font/encoding) and the figures must be read from the
// page image. Returns one row per account line with the current/YTD
// actual/budget/variance figures so the row maps to the normalized variance
// table (TABLE_COLUMNS) the rest of the pipeline already consumes.
const OCR_IS_PROMPT =
  'These image(s) are page(s) of a COMPARATIVE INCOME STATEMENT (a profit & loss / variance report). They may be ' +
  'ROTATED or skewed — read them in whatever orientation makes the text legible. Each data row is an account line ' +
  'with figures in columns. There is typically a CURRENT period and a YEAR-TO-DATE (YTD) period, each with Actual, ' +
  'Budget, and Variance amounts.\n\n' +
  'Extract every account/data line with its figures. For each row capture: account (the line label, including its ' +
  'leading code if printed), and the figures currentActual, currentBudget, currentVariance, ytdActual, ytdBudget, ' +
  'ytdVariance. Use accounting sign exactly as printed (parentheses or a leading minus = negative). If the statement ' +
  'has only one period, put its figures in the current* fields and leave the ytd* fields empty. Do NOT compute or ' +
  'invent values that are not visible; leave a missing figure empty.\n\n' +
  'Return STRICT JSON only — no prose, no markdown fences — in exactly this shape:\n' +
  '{"rows":[{"account":"","currentActual":0,"currentBudget":0,"currentVariance":0,"ytdActual":0,"ytdBudget":0,"ytdVariance":0}]}\n' +
  'Use JSON numbers for figures (negative where shown); use an empty string for a figure that is not visible. ' +
  'If these pages are not an income statement, return {"rows":[]}.'

const OCR_PROMPT =
  'These image(s) are page(s) of a General Ledger. They may be ROTATED (sideways or upside down) or skewed — read ' +
  'them in whatever orientation makes the text legible. The ledger is organized into ACCOUNT SECTIONS: each section ' +
  'begins with an account header (an account code and name, e.g. "51051 Security Contract"), often followed by a ' +
  '"Balance Forward" line, then individual transaction rows, and ends near an "Account Totals" line.\n\n' +
  'Extract every account section and its transactions. For each transaction capture: date, reference (check/document ' +
  'number), description (vendor / memo text), and amount. The amount is the transaction value: if the ledger shows ' +
  'separate Debit and Credit columns, amount = the debit when a debit is present (a POSITIVE number), otherwise the ' +
  'credit as a NEGATIVE number. Ignore running-balance columns, and do NOT emit "Balance Forward" or "Account Totals" ' +
  'lines as transactions.\n\n' +
  'Return STRICT JSON only — no prose, no markdown fences — in exactly this shape:\n' +
  '{"accounts":[{"account":"<code and name>","transactions":[{"date":"","reference":"","description":"","amount":0}]}]}\n' +
  'Use a JSON number for amount (negative for credits). If a field is not visible use an empty string (0 for amount). ' +
  'If these pages are not a general ledger, return {"accounts":[]}.'

// Build the Anthropic message content from page images (data URLs). Invalid /
// non-image entries are skipped; the extraction prompt for the requested mode is
// appended last ('gl' = General Ledger, the default; 'incomeStatement' = a
// comparative P&L whose text layer was unusable).
export function buildOcrContent(images = [], mode = 'gl') {
  const content = []
  for (const img of Array.isArray(images) ? images : []) {
    const m = /^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(String(img))
    if (!m) continue
    const media = m[1] === 'image/jpg' ? 'image/jpeg' : m[1]
    content.push({ type: 'image', source: { type: 'base64', media_type: media, data: m[2].replace(/\s+/g, '') } })
  }
  content.push({ type: 'text', text: mode === 'incomeStatement' ? OCR_IS_PROMPT : OCR_PROMPT })
  return content
}

// Drop anything that isn't a well-formed { account, transactions:[...] }.
function sanitizeAccounts(accounts) {
  const out = []
  for (const a of Array.isArray(accounts) ? accounts : []) {
    if (!a || typeof a !== 'object') continue
    const account = String(a.account || '').trim()
    if (!account) continue
    const transactions = []
    for (const t of Array.isArray(a.transactions) ? a.transactions : []) {
      if (!t || typeof t !== 'object') continue
      transactions.push({
        date: String(t.date || '').trim(),
        reference: String(t.reference || '').trim(),
        description: String(t.description || '').trim(),
        amount: typeof t.amount === 'number' ? t.amount : (t.amount == null ? '' : String(t.amount))
      })
    }
    out.push({ account, transactions })
  }
  return out
}

// Narrow model output to its JSON payload — tolerant of code fences and
// surrounding prose. Returns the parsed value or null on anything unparseable.
function parseModelJson(text) {
  if (!text) return null
  let s = String(text).trim()
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s)
  if (fence) s = fence[1].trim()
  if (!/^[[{]/.test(s)) {
    // Narrow to the outermost JSON object/array when wrapped in prose.
    const first = s.search(/[[{]/)
    const last = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'))
    if (first >= 0 && last > first) s = s.slice(first, last + 1)
  }
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

// Parse the model's text into a clean accounts array (GL mode). Tolerant of code
// fences and surrounding prose. Returns [] on anything unparseable (silent).
export function parseOcrResponse(text) {
  const parsed = parseModelJson(text)
  if (parsed == null) return []
  const accounts = Array.isArray(parsed) ? parsed : Array.isArray(parsed.accounts) ? parsed.accounts : []
  return sanitizeAccounts(accounts)
}

// Income-statement figure fields the row mapper expects.
const IS_FIGURE_FIELDS = ['currentActual', 'currentBudget', 'currentVariance', 'ytdActual', 'ytdBudget', 'ytdVariance']

// Drop anything that isn't a row with an account; coerce each figure to a number
// or an empty string (never invented).
function sanitizeRows(rows) {
  const out = []
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r !== 'object') continue
    const account = String(r.account || '').trim()
    if (!account) continue
    const row = { account }
    for (const f of IS_FIGURE_FIELDS) {
      const v = r[f]
      row[f] = typeof v === 'number' ? v : v == null ? '' : String(v)
    }
    out.push(row)
  }
  return out
}

// Parse the model's text into clean income-statement rows (incomeStatement mode).
// Returns [] on anything unparseable (silent).
export function parseOcrRows(text) {
  const parsed = parseModelJson(text)
  if (parsed == null) return []
  const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed.rows) ? parsed.rows : []
  return sanitizeRows(rows)
}

// Run the vision model over the images and return the parsed result for the
// requested mode — GL mode ⇒ { accounts }, incomeStatement mode ⇒ { rows } — or
// the empty shape on any failure / gating. Never throws.
export async function runOcr({ images = [], ip = 'unknown', mode = 'gl' } = {}) {
  const empty = mode === 'incomeStatement' ? { rows: [] } : { accounts: [] }
  if (!OCR_ENABLED) return empty
  if (!process.env.ANTHROPIC_API_KEY) return empty
  if (!Array.isArray(images) || images.length === 0) return empty
  if (!checkIpLimit(ip) || !checkGlobalLimit()) return empty
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const resp = await client.messages.create({
      model: OCR_MODEL,
      max_tokens: OCR_MAX_TOKENS,
      system: OCR_SYSTEM,
      messages: [{ role: 'user', content: buildOcrContent(images.slice(0, OCR_MAX_PAGES), mode) }]
    })
    const text = (resp.content || [])
      .filter((b) => b && b.type === 'text')
      .map((b) => b.text)
      .join('\n')
    console.log('[OCR-SERVER] raw vision response:', text && text.slice(0, 500))
    const result = mode === 'incomeStatement' ? { rows: parseOcrRows(text) } : { accounts: parseOcrResponse(text) }
    console.log('[OCR-SERVER] parsed rows count:', result && result.rows && result.rows.length)
    return result
  } catch (err) {
    console.log('[OCR] vision call failed — returning empty:', err && err.message)
    return empty
  }
}

function clientIp(req) {
  const fwd = req && req.headers && req.headers['x-forwarded-for']
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim()
  return (req && req.socket && req.socket.remoteAddress) || 'unknown'
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('payload too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

// HTTP handler. Always responds 200 with { success, accounts } (empty when OCR
// is off or anything fails) except for a non-POST method.
export async function handleOcr(req, res) {
  const json = (obj, code = 200) => {
    res.statusCode = code
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(obj))
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return json({ success: false, error: 'Method not allowed.' }, 405)
  }
  // Disabled → silent no-op (don't even read the body).
  if (!OCR_ENABLED) return json({ success: true, accounts: [] })

  let body
  try {
    body = await readJsonBody(req)
  } catch {
    return json({ success: true, accounts: [] })
  }
  const images = Array.isArray(body && body.images) ? body.images : []
  const mode = body && body.mode === 'incomeStatement' ? 'incomeStatement' : 'gl'
  const result = await runOcr({ images, ip: clientIp(req), mode })
  return json({ success: true, ...result })
}
