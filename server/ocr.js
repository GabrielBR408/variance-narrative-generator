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
  'You are a precise data-extraction engine for accounting General Ledger documents. ' +
  'You transcribe exactly what is printed; you never invent, infer, or compute values that are not visible. ' +
  'You output only JSON.'

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

const OCR_IS_SYSTEM =
  'You are a precise data-extraction engine for accounting financial statements. ' +
  'You transcribe exactly what is printed; you never invent, infer, or compute values that are not visible. ' +
  'You output only JSON.'

const OCR_IS_PROMPT =
  'These image(s) are page(s) of a COMPARATIVE INCOME STATEMENT (a profit-and-loss / variance report). They may be ' +
  'ROTATED (sideways or upside down) or skewed — read them in whatever orientation makes the text legible. Each data ' +
  'row is an account (e.g. "Rental Income", "Utility-Elect-Building") followed by value columns. The statement is ' +
  'typically grouped into a CURRENT-period block and a YEAR-TO-DATE (YTD) block, each printing Actual, Budget, ' +
  'Variance, and Variance % columns.\n\n' +
  'Extract every account row. For each row capture: account (the row label), and these values when present — ' +
  'currentActual, currentBudget, currentVariance, currentVariancePercent, ytdActual, ytdBudget, ytdVariance, ' +
  'ytdVariancePercent. Keep negatives negative (a parenthesised "(7,874.80)" is -7874.80). Do NOT emit section ' +
  'headers, blank lines, or grand-total lines as account rows.\n\n' +
  'Return STRICT JSON only — no prose, no markdown fences — in exactly this shape:\n' +
  '{"rows":[{"account":"","currentActual":0,"currentBudget":0,"currentVariance":0,"currentVariancePercent":0,' +
  '"ytdActual":0,"ytdBudget":0,"ytdVariance":0,"ytdVariancePercent":0}]}\n' +
  'Use JSON numbers for the values (negative for unfavourable/parenthesised figures). If a value is not visible omit ' +
  'the field or use an empty string. If these pages are not an income statement, return {"rows":[]}.'

// Build the Anthropic message content from page images (data URLs). Invalid /
// non-image entries are skipped; the extraction prompt for `kind` ('gl' — a
// General Ledger, the default — or 'incomeStatement') is appended last.
export function buildOcrContent(images = [], kind = 'gl') {
  const content = []
  for (const img of Array.isArray(images) ? images : []) {
    const m = /^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(String(img))
    if (!m) continue
    const media = m[1] === 'image/jpg' ? 'image/jpeg' : m[1]
    content.push({ type: 'image', source: { type: 'base64', media_type: media, data: m[2].replace(/\s+/g, '') } })
  }
  content.push({ type: 'text', text: kind === 'incomeStatement' ? OCR_IS_PROMPT : OCR_PROMPT })
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

// Tolerantly parse the model's text into a JSON value. Strips a code fence and
// narrows to the outermost object/array when wrapped in prose. Returns null on
// anything unparseable (silent). Shared by both response parsers.
function parseJsonLoose(text) {
  if (!text) return null
  let s = String(text).trim()
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s)
  if (fence) s = fence[1].trim()
  if (!/^[[{]/.test(s)) {
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

// Parse the model's text into a clean accounts array (General Ledger). Tolerant
// of code fences and surrounding prose. Returns [] on anything unparseable.
export function parseOcrResponse(text) {
  const parsed = parseJsonLoose(text)
  const accounts = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.accounts) ? parsed.accounts : []
  return sanitizeAccounts(accounts)
}

// The income-statement value fields, in TABLE_COLUMNS order. Kept in lockstep
// with src/lib/ocr/ocrIncomeStatement.js (the client-side mapper).
const IS_VALUE_FIELDS = [
  'currentActual',
  'currentBudget',
  'currentVariance',
  'currentVariancePercent',
  'ytdActual',
  'ytdBudget',
  'ytdVariance',
  'ytdVariancePercent'
]

// Drop anything that isn't a row with an account label; coerce each value field
// to a number, a string, or '' (a number stays a number; a missing field → '').
function sanitizeIncomeStatementRows(rows) {
  const out = []
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r !== 'object') continue
    const account = String(r.account || '').trim()
    if (!account) continue
    const row = { account }
    for (const f of IS_VALUE_FIELDS) {
      const v = r[f]
      row[f] = typeof v === 'number' ? v : v == null ? '' : String(v)
    }
    out.push(row)
  }
  return out
}

// Parse the model's text into a clean income-statement rows array. Tolerant of
// code fences and surrounding prose. Returns [] on anything unparseable.
export function parseIncomeStatementResponse(text) {
  const parsed = parseJsonLoose(text)
  const rows = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.rows) ? parsed.rows : []
  return sanitizeIncomeStatementRows(rows)
}

// Run the vision model over the images and return the parsed accounts (or [] on
// any failure / gating). Never throws.
export async function runOcr({ images = [], ip = 'unknown' } = {}) {
  if (!OCR_ENABLED) return []
  if (!process.env.ANTHROPIC_API_KEY) return []
  if (!Array.isArray(images) || images.length === 0) return []
  if (!checkIpLimit(ip) || !checkGlobalLimit()) return []
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const resp = await client.messages.create({
      model: OCR_MODEL,
      max_tokens: OCR_MAX_TOKENS,
      system: OCR_SYSTEM,
      messages: [{ role: 'user', content: buildOcrContent(images.slice(0, OCR_MAX_PAGES)) }]
    })
    const text = (resp.content || [])
      .filter((b) => b && b.type === 'text')
      .map((b) => b.text)
      .join('\n')
    return parseOcrResponse(text)
  } catch (err) {
    console.log('[OCR] vision call failed — returning empty:', err && err.message)
    return []
  }
}

// Run the vision model over the images as a comparative INCOME STATEMENT and
// return the parsed rows (or [] on any failure / gating). Never throws. Mirrors
// runOcr; same model, tunables, and rate gates, only the prompt/parser differ.
export async function runIncomeStatementOcr({ images = [], ip = 'unknown' } = {}) {
  if (!OCR_ENABLED) return []
  if (!process.env.ANTHROPIC_API_KEY) return []
  if (!Array.isArray(images) || images.length === 0) return []
  if (!checkIpLimit(ip) || !checkGlobalLimit()) return []
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const resp = await client.messages.create({
      model: OCR_MODEL,
      max_tokens: OCR_MAX_TOKENS,
      system: OCR_IS_SYSTEM,
      messages: [{ role: 'user', content: buildOcrContent(images.slice(0, OCR_MAX_PAGES), 'incomeStatement') }]
    })
    const text = (resp.content || [])
      .filter((b) => b && b.type === 'text')
      .map((b) => b.text)
      .join('\n')
    return parseIncomeStatementResponse(text)
  } catch (err) {
    console.log('[OCR] income-statement vision call failed — returning empty:', err && err.message)
    return []
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

// HTTP handler. Always responds 200 (except for a non-POST method) with
// { success, accounts } for a General Ledger, or { success, rows } when the body
// asks for kind:'incomeStatement' — empty when OCR is off or anything fails.
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
  const ip = clientIp(req)
  if (body && body.kind === 'incomeStatement') {
    const rows = await runIncomeStatementOcr({ images, ip })
    return json({ success: true, rows })
  }
  const accounts = await runOcr({ images, ip })
  return json({ success: true, accounts })
}
