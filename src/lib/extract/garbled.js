// --- Garbled text-layer detection — PDF font/encoding guard ----------------
// pdf.js maps a glyph back to a character through the font's ToUnicode CMap.
// When a PDF embeds a subsetted font WITHOUT a usable ToUnicode map (or uses a
// non-standard custom encoding), pdf.js still returns a text layer — but the
// characters are nonsense: they land in the Unicode Private Use Area, become the
// replacement character U+FFFD, or are control codes. The text is non-empty, so
// the "scanned ⇒ no text" check never fires, yet nothing tabular can be parsed
// from it and the report dead-ends at "no table was found".
//
// This module detects that case from the extracted page text alone, so the
// parser can route such a file to the OCR path (render the pages and read the
// pixels) exactly as it already does for an image-only scan. DETERMINISTIC and
// content-only: pure string inspection, NO model, NO network, NO heuristance
// beyond the character-class ratios below.
//
// Boundaries: it only answers "is this text layer unreadable?" — it does not
// parse, normalize, or interpret anything.

// Minimum number of non-whitespace characters before a verdict is meaningful. A
// near-empty page carries no signal; the existing "no text ⇒ scanned" check owns
// that case, so we abstain (return false) below this.
const MIN_CHARS = 8

// Share of non-whitespace characters that must be non-readable before the text
// layer is judged unusable. A clean statement (ASCII letters, digits, currency
// punctuation) sits at ~0; a font-encoding casualty sits near 1. The gap is
// wide, so a conservative threshold cleanly separates them and never trips on a
// clean file that merely carries a few stray symbols.
const GARBLE_RATIO = 0.3

// A character that legitimately appears in a real (English) financial statement:
// printable ASCII, the Latin-1 letters/symbols exports use (e.g. é, ±, ½, the
// "·" account separator at 0x00B7), and a handful of typographic glyphs (curly
// quotes, en/em dashes, bullet, ellipsis). Everything else non-whitespace —
// control codes, the replacement char, Private Use Area glyphs, symbol soup — is
// treated as non-readable.
function isReadableCodePoint(cp) {
  if (cp >= 0x20 && cp <= 0x7e) return true // printable ASCII
  if (cp >= 0xa1 && cp <= 0xff) return true // Latin-1 supplement (accents, ·, ±, ½…)
  if (cp === 0x2018 || cp === 0x2019 || cp === 0x201c || cp === 0x201d) return true // curly quotes
  if (cp === 0x2013 || cp === 0x2014 || cp === 0x2026 || cp === 0x2022) return true // – — … •
  return false
}

// True when the extracted text layer is present but unreadable (a non-standard
// font/encoding rendered it as garbage), so the file should take the OCR path.
// Accepts the per-page `text` array (or a single string). Empty input ⇒ false:
// that is a genuine "no text" scan, already handled upstream.
export function looksGarbledText(pages) {
  const blob = Array.isArray(pages) ? pages.join(' ') : String(pages || '')
  let total = 0
  let bad = 0
  for (const ch of blob) {
    if (/\s/.test(ch)) continue
    total++
    if (!isReadableCodePoint(ch.codePointAt(0))) bad++
  }
  if (total < MIN_CHARS) return false
  return bad / total >= GARBLE_RATIO
}

export { MIN_CHARS as GARBLE_MIN_CHARS, GARBLE_RATIO }
