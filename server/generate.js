// --- POST /generate — real file transport handler -------------------------
// Phase 5. Receives multipart/form-data with actual file bytes, verifies a
// few surface facts (filename, size, MIME, role), and returns a placeholder
// response. It does NOT parse, inspect, classify, calculate, call any model,
// generate narratives, export, or persist anything.
//
// This handler is framework-agnostic: it takes Node's (req, res) and works
// today inside the Vite dev/preview middleware, and can be mounted on a plain
// Node HTTP server (or an Express route) in production without changes.
//
// Temporary file handling: file bytes stream through Busboy. We count bytes
// as they arrive and then discard them. Nothing is buffered to completion,
// written to disk, uploaded, logged, or kept between requests.
import Busboy from 'busboy'

// Reasonable safety limits. Files are never stored, so these only guard memory
// and request time, not storage.
const MAX_FILE_BYTES = 25 * 1024 * 1024 // 25 MB per file
const MAX_FILES = 25

const ALLOWED_EXT = new Set(['pdf', 'xlsx', 'xls', 'csv', 'docx'])
const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
  'application/vnd.ms-excel', // xls (and some CSV exports)
  'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document' // docx
])

function extensionOf(name) {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

function isSupported(name, mime) {
  return ALLOWED_EXT.has(extensionOf(name)) || ALLOWED_MIME.has((mime || '').toLowerCase())
}

function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(payload))
}

export function handleGenerate(req, res) {
  let bb
  try {
    bb = Busboy({
      headers: req.headers,
      limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES }
    })
  } catch {
    // Not multipart / missing boundary / malformed request line.
    sendJson(res, 400, { success: false, error: 'The request was not a valid file upload.' })
    return
  }

  const files = [] // { name, size, type, role } — metadata only
  const fields = {} // style, variance, notes (raw strings)
  let responded = false
  let firstError = null // { status, error } — first problem wins

  function flagError(status, error) {
    if (!firstError) firstError = { status, error }
  }

  bb.on('field', (name, value) => {
    fields[name] = value
  })

  bb.on('file', (name, stream, info) => {
    const { filename, mimeType } = info
    const role = name === 'baseReport' ? 'baseReport' : 'supportingFile'
    let size = 0
    let truncated = false

    // Count bytes, then let them go. No buffering, no disk, no logging.
    stream.on('data', (chunk) => { size += chunk.length })
    stream.on('limit', () => { truncated = true })
    stream.on('end', () => {
      if (truncated) {
        flagError(413, `"${filename}" is too large. The limit is 25 MB per file.`)
        return
      }
      if (!filename) {
        flagError(400, 'A file was uploaded without a name.')
        return
      }
      if (size === 0) {
        flagError(422, `"${filename}" is empty. Choose a file that has content.`)
        return
      }
      if (!isSupported(filename, mimeType)) {
        flagError(415, `"${filename}" is not a supported file type. Use PDF, XLSX, XLS, CSV, or DOCX.`)
        return
      }
      files.push({ name: filename, size, type: mimeType || '', role })
    })
  })

  bb.on('error', () => {
    if (responded) return
    responded = true
    sendJson(res, 400, { success: false, error: 'The upload could not be read. Please try again.' })
  })

  bb.on('close', () => {
    if (responded) return
    responded = true

    if (firstError) {
      sendJson(res, firstError.status, { success: false, error: firstError.error })
      return
    }

    const hasBase = files.some((f) => f.role === 'baseReport')
    if (!hasBase) {
      sendJson(res, 422, { success: false, error: 'Add a base variance report before generating.' })
      return
    }

    const settingsReceived = Boolean(fields.style && fields.variance)

    // Server-minted placeholder Job ID. No real processing happens here.
    const jobId = 'JOB-' + String(Date.now()).slice(-6)
    sendJson(res, 200, {
      success: true,
      jobId,
      filesReceived: files.length,
      settingsReceived,
      files,
      narrative: {
        summary: 'Files received successfully. Analysis engine not connected yet.'
      }
    })
  })

  req.pipe(bb)
}
