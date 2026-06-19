// --- Style-controls isolation diagnostic harness ---------------------------
// DIAGNOSTIC ONLY. Changes no app behavior, no templates, no style logic.
//
// Purpose: determine, in isolation from the live API and the rate limiter,
// whether the five narrative Style controls (Report Style, Tone, Length,
// Abbreviate Dollar Values, Dollar Value References) actually change the
// rendered narrative — specifically when Tone = Cautious and Abbreviate = On
// (the Run 3 vs Run 4 case that produced word-for-word identical output in the
// live UI).
//
// How it isolates the style engine from the live environment:
//   • It reuses the REAL deterministic engines (runPipeline → generateNarrative,
//     enrichNarrative) and the REAL style engine (server/llm.js
//     buildSystemPrompt / buildStyleInstructions, _buildPackets) and the REAL
//     client-side style passes (commentaryModeFromStyle, applyDollarAbbreviation).
//   • It STUBS only the opaque network LLM call. The stub ALWAYS succeeds and
//     returns a deterministic, clearly-labelled "[ENRICHED]" commentary for
//     every flagged line, INDEPENDENT of the style settings. This removes the
//     API, the per-IP rate limit, and the global circuit breaker from the
//     equation entirely, so any difference (or lack of difference) between runs
//     is attributable to the deterministic style engine alone.
//
// Run directly to (re)generate docs/diagnostics/style-controls-report.md and
// print the three pairwise verdicts:
//   node scripts/style-controls-diagnostic.mjs
//
// The pure runner (runDiagnostic) is also imported by
// test/styleControlsDiagnostic.test.js so CI exercises and asserts the result.

import { fileURLToPath } from 'node:url'
import { writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { runPipeline } from '../src/lib/pipeline.js'
import { enrichNarrative } from '../src/lib/enrich/index.js'
import { commentaryModeFromStyle } from '../src/lib/enrich/commentaryMode.js'
import { applyDollarAbbreviation } from '../src/lib/narrative/dollarAbbrev.js'
import { _buildPackets, buildSystemPrompt } from '../server/llm.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPORT_PATH = join(__dirname, '..', 'docs', 'diagnostics', 'style-controls-report.md')

// ---------------------------------------------------------------------------
// Fixture — a small synthetic income statement (4–6 high-variance lines) plus a
// matching General Ledger so the GL-enrichment path engages and the LLM stub has
// support data to enrich. Every variance is ≥ $1,000 so the dollar-abbreviation
// pass has figures to rewrite. No real/sanitized customer data is used.
// ---------------------------------------------------------------------------

const BASE_EXTRACTION = {
  fileId: 'base',
  fileName: 'income-statement.pdf',
  status: 'ok',
  confidence: 80,
  classification: { type: 'variance-report' },
  normalized: {
    columns: ['Account', 'Current Actual', 'Current Budget', 'YTD Actual', 'YTD Budget'],
    rows: [
      ['Repairs & Maintenance', '45000', '30000', '120000', '100000'],
      ['Utilities', '28000', '20000', '95000', '80000'],
      ['Property Insurance', '52000', '40000', '150000', '140000'],
      ['Management Fees', '18000', '12000', '60000', '55000'],
      ['Landscaping', '9000', '3000', '24000', '20000']
    ],
    accounts: [], dates: [], values: []
  }
}

const GL_EXTRACTION = {
  fileId: 'gl',
  fileName: 'general-ledger.xlsx',
  status: 'ok',
  confidence: 80,
  classification: { type: 'General Ledger (GL)' },
  normalized: {
    columns: ['Account', 'Amount', 'Vendor', 'Memo'],
    rows: [
      ['Repairs & Maintenance', '15000', 'ABC HVAC Services', 'Emergency rooftop unit replacement'],
      ['Utilities', '8000', 'Metro Electric', 'Summer peak demand charges'],
      ['Property Insurance', '12000', 'Premier Insurance Group', 'Annual premium true-up'],
      ['Management Fees', '6000', 'Skyline Property Mgmt', 'Contracted management fee'],
      ['Landscaping', '6000', 'GreenScape LLC', 'Seasonal replanting project']
    ],
    accounts: [], dates: [], values: []
  }
}

const THRESHOLDS = { amount: 1000, percent: 10 }

// The four runs under test (exactly the combinations from the task).
export const RUNS = [
  { id: 'Run 1', style: { reportStyle: 'Concise', tone: 'Neutral', length: 'Brief', abbreviateDollars: false, dollarReferences: 'Minimum' } },
  { id: 'Run 2', style: { reportStyle: 'Detailed', tone: 'Neutral', length: 'Verbose', abbreviateDollars: false, dollarReferences: 'Detail' } },
  { id: 'Run 3', style: { reportStyle: 'Concise', tone: 'Cautious', length: 'Standard', abbreviateDollars: true, dollarReferences: 'Minimum' } },
  { id: 'Run 4', style: { reportStyle: 'Detailed', tone: 'Cautious', length: 'Verbose', abbreviateDollars: true, dollarReferences: 'Detail' } }
]

// ---------------------------------------------------------------------------
// The LLM stub. Mirrors server/llm.js enrichWithLLM EXACTLY — it builds the real
// evidence packets (_buildPackets) and the real style-driven system prompt
// (buildSystemPrompt), then replaces ONLY the `client.messages.create` network
// call with a deterministic, style-independent "[ENRICHED]" response and the
// SAME merge formula (s1 + ". " + commentary). The system prompt is returned so
// the report can show that the style engine DID encode each run's settings into
// the prompt even though the rendered output does not change.
// ---------------------------------------------------------------------------

function stubModelResponse(packets) {
  // Always succeeds; one to two sentences per account; clearly labelled
  // "[ENRICHED]"; identical regardless of the style settings, so it contributes
  // ZERO variation between runs. (It does cite a vendor + figure from the packet
  // so the line reads like a real enriched note and so the dollar-abbreviation
  // pass has a figure to act on.)
  return packets.map((p) => {
    const row = Array.isArray(p.glRows) && p.glRows[0] ? p.glRows[0] : {}
    const vendor = row.vendor || 'the vendor'
    const amount = typeof row.amount === 'number' ? `$${Math.abs(row.amount).toLocaleString('en-US')}` : 'the period activity'
    return { index: p.index, commentary: `[ENRICHED] Detail cites ${vendor} for ${amount}.` }
  })
}

function stubbedEnrichWithLLM(flaggedNotes, { period = '', style = null } = {}) {
  // Same gate as production: only notes with support data are eligible.
  const packets = _buildPackets(flaggedNotes, period)
  const systemPrompt = buildSystemPrompt(style) // REAL style engine, recorded for the report
  if (packets.length === 0) return { notes: flaggedNotes, systemPrompt }

  const parsed = stubModelResponse(packets) // the network call, replaced by the stub
  const result = [...flaggedNotes]
  for (const entry of parsed) {
    const packet = packets[entry.index]
    if (!packet || typeof entry.commentary !== 'string' || !entry.commentary.trim()) continue
    const note = result[packet._originalIndex]
    if (!note) continue
    const s1 = String(note.originalText || note.text).replace(/\s*\.?\s*$/, '')
    result[packet._originalIndex] = { ...note, text: `${s1}. ${entry.commentary.trim()}`, llmEnriched: true }
  }
  return { notes: result, systemPrompt }
}

// ---------------------------------------------------------------------------
// One full run: deterministic narrative → server LLM stage (deterministic
// enrichment + stubbed LLM) → client style passes (commentary mode +
// dollar-abbreviation). This is the exact chain the app applies; only the
// network LLM is stubbed.
// ---------------------------------------------------------------------------

function executeRun(style) {
  const { narrative } = runPipeline(BASE_EXTRACTION, { thresholds: THRESHOLDS })

  // Server stage (server/generate.js): deterministic enrichment populates
  // note.support / note.preparedEvidence (mode hardcoded 'detailed' server-side),
  // then the LLM enriches the flagged notes with the active style folded into the
  // prompt. NOTE: production currently routes only `highVariances` through the LLM
  // (server/generate.js:119). This harness routes ALL flagged sections through the
  // stub so claim (e) — every flagged line was ENRICHED — is literally true; it
  // does not affect the verdict (the style passes are section-independent).
  const FLAGGED_SECTIONS = ['highVariances', 'revenueNotes', 'expenseNotes']
  const serverEnriched = enrichNarrative(narrative, { supporting: [GL_EXTRACTION], mode: 'detailed' })
  let systemPrompt = null
  const serverPeriods = serverEnriched.periods.map((p) => {
    const next = { ...p }
    for (const section of FLAGGED_SECTIONS) {
      if (!Array.isArray(p[section]) || p[section].length === 0) continue
      const { notes, systemPrompt: sp } = stubbedEnrichWithLLM(p[section], { period: p.period, style })
      next[section] = notes
      systemPrompt = sp
    }
    return next
  })
  const serverNarrative = { ...serverEnriched, periods: serverPeriods }

  // Client stage (src/hooks/useGenerate.js): re-run deterministic enrichment with
  // the style-derived commentary mode (a no-op on already-enriched notes, exactly
  // like production), then the cosmetic dollar-abbreviation pass.
  const mode = commentaryModeFromStyle(style)
  const clientEnriched = enrichNarrative(serverNarrative, { supporting: [GL_EXTRACTION], mode })
  const finalNarrative = applyDollarAbbreviation(clientEnriched, !!style.abbreviateDollars)

  // Collect every flagged narrative line across periods, with char counts.
  const lines = []
  for (const p of finalNarrative.periods) {
    for (const section of ['highVariances', 'revenueNotes', 'expenseNotes']) {
      for (const note of p[section] || []) {
        if (!note || typeof note.text !== 'string') continue
        lines.push({
          key: `${p.period} · ${section} · ${note.account}`,
          period: p.period,
          section,
          account: note.account,
          text: note.text,
          chars: note.text.length,
          enriched: note.llmEnriched === true
        })
      }
    }
  }
  return { lines, systemPrompt, mode }
}

// ---------------------------------------------------------------------------
// Diagnostic runner — executes all four runs, aligns lines by key, and computes
// the three pairwise verdicts. Pure (no I/O), so the test can assert on it.
// ---------------------------------------------------------------------------

export function runDiagnostic() {
  const runs = RUNS.map((r) => ({ ...r, ...executeRun(r.style) }))

  // Stable, ordered union of line keys across all runs.
  const keys = []
  const seen = new Set()
  for (const r of runs) {
    for (const l of r.lines) {
      if (!seen.has(l.key)) { seen.add(l.key); keys.push(l.key) }
    }
  }

  const textOf = (run, key) => {
    const l = run.lines.find((x) => x.key === key)
    return l ? l.text : null
  }

  function diff(aId, bId) {
    const a = runs.find((r) => r.id === aId)
    const b = runs.find((r) => r.id === bId)
    let identical = true
    const changedKeys = []
    for (const key of keys) {
      if (textOf(a, key) !== textOf(b, key)) { identical = false; changedKeys.push(key) }
    }
    return { pair: `${aId} vs ${bId}`, identical, changedKeys }
  }

  const verdicts = {
    run1_vs_run2: diff('Run 1', 'Run 2'),
    run3_vs_run4: diff('Run 3', 'Run 4'),
    run1_vs_run3: diff('Run 1', 'Run 3')
  }

  const allEnriched = runs.every((r) => r.lines.length > 0 && r.lines.every((l) => l.enriched && l.text.includes('[ENRICHED]')))

  // Did the style engine actually encode each run's settings into the LLM prompt?
  const prompts = runs.map((r) => r.systemPrompt)
  const promptsAllDistinct = new Set(prompts).size === prompts.length
  const run3vs4PromptDiffers = runs.find((r) => r.id === 'Run 3').systemPrompt !== runs.find((r) => r.id === 'Run 4').systemPrompt

  // Core question: when Tone=Cautious & Abbreviate=On, do Report Style, Length,
  // and Dollar Reference change the output? Run 3 vs Run 4 vary exactly those
  // three (Tone & Abbreviate held constant). Identical → answer is NO.
  const coreAnswerYes = !verdicts.run3_vs_run4.identical

  return { runs, keys, verdicts, allEnriched, promptsAllDistinct, run3vs4PromptDiffers, coreAnswerYes }
}

// ---------------------------------------------------------------------------
// Report rendering
// ---------------------------------------------------------------------------

function fence(s) {
  // Keep multi-line narrative readable inside a markdown table cell.
  return String(s).replace(/\|/g, '\\|')
}

function buildReport(d) {
  const { runs, keys, verdicts, allEnriched, run3vs4PromptDiffers } = d
  const styleLabel = (s) =>
    `${s.reportStyle} / ${s.tone} / ${s.length} / Abbrev ${s.abbreviateDollars ? 'On' : 'Off'} / Dollar ${s.dollarReferences}`

  const lines = []
  lines.push('# Style Controls Isolation — Diagnostic Report')
  lines.push('')
  lines.push('> DIAGNOSTIC ONLY. No app behavior, narrative templates, or style logic were changed.')
  lines.push('> Regenerate with `node scripts/style-controls-diagnostic.mjs`.')
  lines.push('')
  lines.push('## What this test does')
  lines.push('')
  lines.push('The same synthetic fixture (a 5-line income statement + a matching General Ledger)')
  lines.push('is run through four Style combinations. The **deterministic engines and the real**')
  lines.push('**style engine run unchanged**; only the opaque network LLM call is stubbed. The stub')
  lines.push('**always succeeds** and returns a deterministic, clearly-labelled `[ENRICHED]` commentary')
  lines.push('for every flagged line, **independent of the Style settings**. This removes the API, the')
  lines.push('per-IP rate limit, and the global circuit breaker from the equation, so any difference')
  lines.push('(or lack of difference) between runs is attributable to the deterministic style engine alone.')
  lines.push('')
  lines.push('**Fidelity note:** production currently routes only the `highVariances` section through the')
  lines.push('LLM (`server/generate.js:119`). To make claim (e) — *every flagged line was enriched* —')
  lines.push('literally true, this harness routes all flagged sections (`highVariances`, `revenueNotes`,')
  lines.push('`expenseNotes`) through the stub. This does not affect the verdict: the style passes are')
  lines.push('section-independent, so an LLM-untouched deterministic line would behave identically')
  lines.push('(only Abbreviate would change it).')
  lines.push('')
  lines.push('| Run | Report Style | Tone | Length | Abbreviate | Dollar Reference |')
  lines.push('| --- | --- | --- | --- | --- | --- |')
  for (const r of runs) {
    const s = r.style
    lines.push(`| ${r.id} | ${s.reportStyle} | ${s.tone} | ${s.length} | ${s.abbreviateDollars ? 'On' : 'Off'} | ${s.dollarReferences} |`)
  }
  lines.push('')

  // (a) Per-line side-by-side table.
  lines.push('## (a) Per-line narrative — all four runs side by side')
  lines.push('')
  for (const key of keys) {
    lines.push(`### ${key}`)
    lines.push('')
    lines.push('| Run | Settings | Chars | Narrative |')
    lines.push('| --- | --- | --- | --- |')
    for (const r of runs) {
      const l = r.lines.find((x) => x.key === key)
      lines.push(`| ${r.id} | ${styleLabel(r.style)} | ${l ? l.chars : '—'} | ${l ? fence(l.text) : '—'} |`)
    }
    lines.push('')
  }

  // (b) Pairwise diff verdicts.
  lines.push('## (b) Pairwise DIFF verdicts')
  lines.push('')
  const verdict = (v) => v.identical ? '🟰 IDENTICAL' : '🔀 DIFFERENT'
  for (const v of [verdicts.run1_vs_run2, verdicts.run3_vs_run4, verdicts.run1_vs_run3]) {
    lines.push(`- **${v.pair}: ${verdict(v)}**` + (v.identical ? '' : ` — differs on: ${v.changedKeys.map((k) => `\`${k}\``).join(', ')}`))
  }
  lines.push('')
  lines.push('Interpretation:')
  lines.push('')
  lines.push('- **Run 1 vs Run 2** vary Report Style, Length and Dollar Reference (Tone Neutral, Abbreviate **Off** in both).')
  lines.push('- **Run 3 vs Run 4** vary Report Style, Length and Dollar Reference (Tone **Cautious**, Abbreviate **On** in both).')
  lines.push('- **Run 1 vs Run 3** vary Tone and Abbreviate (plus Length) — the only pair that toggles **Abbreviate Dollar Values**.')
  lines.push('')

  // (c) Core YES/NO answer.
  lines.push('## (c) Core question')
  lines.push('')
  lines.push('**When Tone = Cautious and Abbreviate = On, do Report Style, Length, and Dollar Reference change the output?**')
  lines.push('')
  lines.push(`### ➡️ ${d.coreAnswerYes ? 'YES' : 'NO'}`)
  lines.push('')
  if (!d.coreAnswerYes) {
    lines.push('Run 3 and Run 4 — which differ only in Report Style (Concise vs Detailed), Length')
    lines.push('(Standard vs Verbose), and Dollar Reference (Minimum vs Detail), with Tone and')
    lines.push('Abbreviate held constant — produce **word-for-word identical** narratives. With the LLM')
    lines.push('stubbed to a fixed, successful response, these three controls have **no effect** on the')
    lines.push('rendered text.')
  }
  lines.push('')

  // (d) Responsible code branch.
  lines.push('## (d) Why — the responsible code path')
  lines.push('')
  lines.push('There is **no deterministic branch** that consumes Report Style, Tone, Length, or Dollar')
  lines.push('Reference. These four controls are read in exactly one place:')
  lines.push('')
  lines.push('- **`server/llm.js` → `buildStyleInstructions` (lines 156–192)** — the ONLY consumer of')
  lines.push('  `reportStyle`, `tone`, `length`, and `dollarReferences`. It folds them into the LLM')
  lines.push('  **system prompt** via `buildSystemPrompt` (line 196–198).')
  lines.push('- That prompt only reaches output through the LLM call in **`server/generate.js` → the')
  lines.push('  `LLM_ENABLED && llmMode === \'cited\'` block (lines 104–124)**, which calls')
  lines.push('  `enrichWithLLM` (line 119). That block runs only when the server flag is on AND the')
  lines.push('  per-IP limit (`checkIpLimit`) AND the global circuit breaker (`checkGlobalLimit`) both')
  lines.push('  permit. On any breach `enrichWithLLM` returns the notes unchanged.')
  lines.push('')
  lines.push('Therefore, whenever the LLM output is held constant — this stub here, **or the')
  lines.push('rate-limit / circuit-breaker fallback in production**, or a static-host build with no')
  lines.push('server — Report Style, Tone, Length, and Dollar Reference change nothing in the rendered')
  lines.push('narrative. The deterministic narrative (`generateNarrative`) and the deterministic')
  lines.push('enrichment (`enrichNarrative`) never read these four controls.')
  lines.push('')
  lines.push('**The lone exception is Abbreviate Dollar Values.** It is the only Style control with a')
  lines.push('deterministic effect: `src/hooks/useGenerate.js:126` applies `applyDollarAbbreviation`')
  lines.push('(`src/lib/narrative/dollarAbbrev.js`) as a cosmetic pass over the finished text. That is')
  lines.push('exactly why **Run 1 vs Run 3 is DIFFERENT** while Run 1 vs Run 2 and Run 3 vs Run 4 are')
  lines.push('identical. (Note: `reportStyle` is also NOT wired to the enrichment `commentaryMode` —')
  lines.push('`commentaryModeFromStyle` reads a separate `commentaryDetail` field that is absent from')
  lines.push('the active Style panel, so it always resolves to `detailed`.)')
  lines.push('')
  lines.push('### The style engine *did* encode every setting — it just never reaches the output')
  lines.push('')
  lines.push(`The real \`buildStyleInstructions\` produced a **distinct system prompt for each run**`)
  lines.push(`(all four prompts distinct: \`${d.promptsAllDistinct}\`; Run 3 prompt ≠ Run 4 prompt:`)
  lines.push(`\`${run3vs4PromptDiffers}\`). The settings are captured faithfully at the prompt layer;`)
  lines.push('they simply have no path to the rendered narrative once the LLM response is constant.')
  lines.push('')
  lines.push('Run 3 vs Run 4 STYLE INSTRUCTIONS (proof the prompts differ):')
  lines.push('')
  lines.push('```text')
  lines.push('Run 3: ' + (runs.find((r) => r.id === 'Run 3').systemPrompt.split('STYLE INSTRUCTIONS:')[1] || '').trim())
  lines.push('')
  lines.push('Run 4: ' + (runs.find((r) => r.id === 'Run 4').systemPrompt.split('STYLE INSTRUCTIONS:')[1] || '').trim())
  lines.push('```')
  lines.push('')

  // (e) Enrichment confirmation.
  lines.push('## (e) Every line was ENRICHED (LLM stub), not fallback')
  lines.push('')
  lines.push(`All flagged lines in all four runs carry the \`[ENRICHED]\` label and \`llmEnriched: true\`:`)
  lines.push(`**\`${allEnriched}\`**. The stub always succeeds, so this result is **independent of the**`)
  lines.push('**per-day rate limit, the global circuit breaker, and any API failure** — it reflects the')
  lines.push('style engine alone.')
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('_Generated by `scripts/style-controls-diagnostic.mjs`._')
  lines.push('')
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

async function main() {
  const d = runDiagnostic()
  const report = buildReport(d)
  await mkdir(dirname(REPORT_PATH), { recursive: true })
  await writeFile(REPORT_PATH, report, 'utf8')

  const mark = (v) => (v.identical ? 'IDENTICAL' : 'DIFFERENT')
  console.log('Style-controls diagnostic — pairwise verdicts:')
  console.log(`  ${d.verdicts.run1_vs_run2.pair}: ${mark(d.verdicts.run1_vs_run2)}`)
  console.log(`  ${d.verdicts.run3_vs_run4.pair}: ${mark(d.verdicts.run3_vs_run4)}`)
  console.log(`  ${d.verdicts.run1_vs_run3.pair}: ${mark(d.verdicts.run1_vs_run3)}`)
  console.log('')
  console.log(`Core question — when Tone=Cautious & Abbreviate=On, do Report Style / Length / Dollar Reference change output? ${d.coreAnswerYes ? 'YES' : 'NO'}`)
  console.log(`Every line ENRICHED via LLM stub (independent of rate limit): ${d.allEnriched}`)
  console.log(`Report written: ${REPORT_PATH}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => { console.error(err); process.exit(1) })
}
