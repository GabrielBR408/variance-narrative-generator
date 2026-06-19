# Style Controls Isolation — Diagnostic Report

> DIAGNOSTIC ONLY. No app behavior, narrative templates, or style logic were changed.
> Regenerate with `node scripts/style-controls-diagnostic.mjs`.

## What this test does

The same synthetic fixture (a 5-line income statement + a matching General Ledger)
is run through four Style combinations. The **deterministic engines and the real**
**style engine run unchanged**; only the opaque network LLM call is stubbed. The stub
**always succeeds** and returns a deterministic, clearly-labelled `[ENRICHED]` commentary
for every flagged line, **independent of the Style settings**. This removes the API, the
per-IP rate limit, and the global circuit breaker from the equation, so any difference
(or lack of difference) between runs is attributable to the deterministic style engine alone.

**Fidelity note:** production currently routes only the `highVariances` section through the
LLM (`server/generate.js:119`). To make claim (e) — *every flagged line was enriched* —
literally true, this harness routes all flagged sections (`highVariances`, `revenueNotes`,
`expenseNotes`) through the stub. This does not affect the verdict: the style passes are
section-independent, so an LLM-untouched deterministic line would behave identically
(only Abbreviate would change it).

| Run | Report Style | Tone | Length | Abbreviate | Dollar Reference |
| --- | --- | --- | --- | --- | --- |
| Run 1 | Concise | Neutral | Brief | Off | Minimum |
| Run 2 | Detailed | Neutral | Verbose | Off | Detail |
| Run 3 | Concise | Cautious | Standard | On | Minimum |
| Run 4 | Detailed | Cautious | Verbose | On | Detail |

## (a) Per-line narrative — all four runs side by side

### current · highVariances · Repairs & Maintenance

| Run | Settings | Chars | Narrative |
| --- | --- | --- | --- |
| Run 1 | Concise / Neutral / Brief / Abbrev Off / Dollar Minimum | 112 | Repairs & Maintenance exceeded budget by $15,000 (50.0%). [ENRICHED] Detail cites ABC HVAC Services for $15,000. |
| Run 2 | Detailed / Neutral / Verbose / Abbrev Off / Dollar Detail | 112 | Repairs & Maintenance exceeded budget by $15,000 (50.0%). [ENRICHED] Detail cites ABC HVAC Services for $15,000. |
| Run 3 | Concise / Cautious / Standard / Abbrev On / Dollar Minimum | 106 | Repairs & Maintenance exceeded budget by $15K (50.0%). [ENRICHED] Detail cites ABC HVAC Services for $15K. |
| Run 4 | Detailed / Cautious / Verbose / Abbrev On / Dollar Detail | 106 | Repairs & Maintenance exceeded budget by $15K (50.0%). [ENRICHED] Detail cites ABC HVAC Services for $15K. |

### current · highVariances · Property Insurance

| Run | Settings | Chars | Narrative |
| --- | --- | --- | --- |
| Run 1 | Concise / Neutral / Brief / Abbrev Off / Dollar Minimum | 115 | Property Insurance exceeded budget by $12,000 (30.0%). [ENRICHED] Detail cites Premier Insurance Group for $12,000. |
| Run 2 | Detailed / Neutral / Verbose / Abbrev Off / Dollar Detail | 115 | Property Insurance exceeded budget by $12,000 (30.0%). [ENRICHED] Detail cites Premier Insurance Group for $12,000. |
| Run 3 | Concise / Cautious / Standard / Abbrev On / Dollar Minimum | 109 | Property Insurance exceeded budget by $12K (30.0%). [ENRICHED] Detail cites Premier Insurance Group for $12K. |
| Run 4 | Detailed / Cautious / Verbose / Abbrev On / Dollar Detail | 109 | Property Insurance exceeded budget by $12K (30.0%). [ENRICHED] Detail cites Premier Insurance Group for $12K. |

### current · highVariances · Utilities

| Run | Settings | Chars | Narrative |
| --- | --- | --- | --- |
| Run 1 | Concise / Neutral / Brief / Abbrev Off / Dollar Minimum | 95 | Utilities exceeded budget by $8,000 (40.0%). [ENRICHED] Detail cites Metro Electric for $8,000. |
| Run 2 | Detailed / Neutral / Verbose / Abbrev Off / Dollar Detail | 95 | Utilities exceeded budget by $8,000 (40.0%). [ENRICHED] Detail cites Metro Electric for $8,000. |
| Run 3 | Concise / Cautious / Standard / Abbrev On / Dollar Minimum | 89 | Utilities exceeded budget by $8K (40.0%). [ENRICHED] Detail cites Metro Electric for $8K. |
| Run 4 | Detailed / Cautious / Verbose / Abbrev On / Dollar Detail | 89 | Utilities exceeded budget by $8K (40.0%). [ENRICHED] Detail cites Metro Electric for $8K. |

### current · highVariances · Landscaping

| Run | Settings | Chars | Narrative |
| --- | --- | --- | --- |
| Run 1 | Concise / Neutral / Brief / Abbrev Off / Dollar Minimum | 98 | Landscaping exceeded budget by $6,000 (200.0%). [ENRICHED] Detail cites GreenScape LLC for $6,000. |
| Run 2 | Detailed / Neutral / Verbose / Abbrev Off / Dollar Detail | 98 | Landscaping exceeded budget by $6,000 (200.0%). [ENRICHED] Detail cites GreenScape LLC for $6,000. |
| Run 3 | Concise / Cautious / Standard / Abbrev On / Dollar Minimum | 92 | Landscaping exceeded budget by $6K (200.0%). [ENRICHED] Detail cites GreenScape LLC for $6K. |
| Run 4 | Detailed / Cautious / Verbose / Abbrev On / Dollar Detail | 92 | Landscaping exceeded budget by $6K (200.0%). [ENRICHED] Detail cites GreenScape LLC for $6K. |

### current · revenueNotes · Management Fees

| Run | Settings | Chars | Narrative |
| --- | --- | --- | --- |
| Run 1 | Concise / Neutral / Brief / Abbrev Off / Dollar Minimum | 108 | Management Fees exceeded budget by $6,000 (50.0%). [ENRICHED] Detail cites Skyline Property Mgmt for $6,000. |
| Run 2 | Detailed / Neutral / Verbose / Abbrev Off / Dollar Detail | 108 | Management Fees exceeded budget by $6,000 (50.0%). [ENRICHED] Detail cites Skyline Property Mgmt for $6,000. |
| Run 3 | Concise / Cautious / Standard / Abbrev On / Dollar Minimum | 102 | Management Fees exceeded budget by $6K (50.0%). [ENRICHED] Detail cites Skyline Property Mgmt for $6K. |
| Run 4 | Detailed / Cautious / Verbose / Abbrev On / Dollar Detail | 102 | Management Fees exceeded budget by $6K (50.0%). [ENRICHED] Detail cites Skyline Property Mgmt for $6K. |

### ytd · highVariances · Repairs & Maintenance

| Run | Settings | Chars | Narrative |
| --- | --- | --- | --- |
| Run 1 | Concise / Neutral / Brief / Abbrev Off / Dollar Minimum | 112 | Repairs & Maintenance exceeded budget by $20,000 (20.0%). [ENRICHED] Detail cites ABC HVAC Services for $15,000. |
| Run 2 | Detailed / Neutral / Verbose / Abbrev Off / Dollar Detail | 112 | Repairs & Maintenance exceeded budget by $20,000 (20.0%). [ENRICHED] Detail cites ABC HVAC Services for $15,000. |
| Run 3 | Concise / Cautious / Standard / Abbrev On / Dollar Minimum | 106 | Repairs & Maintenance exceeded budget by $20K (20.0%). [ENRICHED] Detail cites ABC HVAC Services for $15K. |
| Run 4 | Detailed / Cautious / Verbose / Abbrev On / Dollar Detail | 106 | Repairs & Maintenance exceeded budget by $20K (20.0%). [ENRICHED] Detail cites ABC HVAC Services for $15K. |

### ytd · highVariances · Utilities

| Run | Settings | Chars | Narrative |
| --- | --- | --- | --- |
| Run 1 | Concise / Neutral / Brief / Abbrev Off / Dollar Minimum | 96 | Utilities exceeded budget by $15,000 (18.8%). [ENRICHED] Detail cites Metro Electric for $8,000. |
| Run 2 | Detailed / Neutral / Verbose / Abbrev Off / Dollar Detail | 96 | Utilities exceeded budget by $15,000 (18.8%). [ENRICHED] Detail cites Metro Electric for $8,000. |
| Run 3 | Concise / Cautious / Standard / Abbrev On / Dollar Minimum | 90 | Utilities exceeded budget by $15K (18.8%). [ENRICHED] Detail cites Metro Electric for $8K. |
| Run 4 | Detailed / Cautious / Verbose / Abbrev On / Dollar Detail | 90 | Utilities exceeded budget by $15K (18.8%). [ENRICHED] Detail cites Metro Electric for $8K. |

### ytd · highVariances · Property Insurance

| Run | Settings | Chars | Narrative |
| --- | --- | --- | --- |
| Run 1 | Concise / Neutral / Brief / Abbrev Off / Dollar Minimum | 114 | Property Insurance exceeded budget by $10,000 (7.1%). [ENRICHED] Detail cites Premier Insurance Group for $12,000. |
| Run 2 | Detailed / Neutral / Verbose / Abbrev Off / Dollar Detail | 114 | Property Insurance exceeded budget by $10,000 (7.1%). [ENRICHED] Detail cites Premier Insurance Group for $12,000. |
| Run 3 | Concise / Cautious / Standard / Abbrev On / Dollar Minimum | 108 | Property Insurance exceeded budget by $10K (7.1%). [ENRICHED] Detail cites Premier Insurance Group for $12K. |
| Run 4 | Detailed / Cautious / Verbose / Abbrev On / Dollar Detail | 108 | Property Insurance exceeded budget by $10K (7.1%). [ENRICHED] Detail cites Premier Insurance Group for $12K. |

### ytd · highVariances · Landscaping

| Run | Settings | Chars | Narrative |
| --- | --- | --- | --- |
| Run 1 | Concise / Neutral / Brief / Abbrev Off / Dollar Minimum | 97 | Landscaping exceeded budget by $4,000 (20.0%). [ENRICHED] Detail cites GreenScape LLC for $6,000. |
| Run 2 | Detailed / Neutral / Verbose / Abbrev Off / Dollar Detail | 97 | Landscaping exceeded budget by $4,000 (20.0%). [ENRICHED] Detail cites GreenScape LLC for $6,000. |
| Run 3 | Concise / Cautious / Standard / Abbrev On / Dollar Minimum | 91 | Landscaping exceeded budget by $4K (20.0%). [ENRICHED] Detail cites GreenScape LLC for $6K. |
| Run 4 | Detailed / Cautious / Verbose / Abbrev On / Dollar Detail | 91 | Landscaping exceeded budget by $4K (20.0%). [ENRICHED] Detail cites GreenScape LLC for $6K. |

### ytd · revenueNotes · Management Fees

| Run | Settings | Chars | Narrative |
| --- | --- | --- | --- |
| Run 1 | Concise / Neutral / Brief / Abbrev Off / Dollar Minimum | 107 | Management Fees exceeded budget by $5,000 (9.1%). [ENRICHED] Detail cites Skyline Property Mgmt for $6,000. |
| Run 2 | Detailed / Neutral / Verbose / Abbrev Off / Dollar Detail | 107 | Management Fees exceeded budget by $5,000 (9.1%). [ENRICHED] Detail cites Skyline Property Mgmt for $6,000. |
| Run 3 | Concise / Cautious / Standard / Abbrev On / Dollar Minimum | 101 | Management Fees exceeded budget by $5K (9.1%). [ENRICHED] Detail cites Skyline Property Mgmt for $6K. |
| Run 4 | Detailed / Cautious / Verbose / Abbrev On / Dollar Detail | 101 | Management Fees exceeded budget by $5K (9.1%). [ENRICHED] Detail cites Skyline Property Mgmt for $6K. |

## (b) Pairwise DIFF verdicts

- **Run 1 vs Run 2: 🟰 IDENTICAL**
- **Run 3 vs Run 4: 🟰 IDENTICAL**
- **Run 1 vs Run 3: 🔀 DIFFERENT** — differs on: `current · highVariances · Repairs & Maintenance`, `current · highVariances · Property Insurance`, `current · highVariances · Utilities`, `current · highVariances · Landscaping`, `current · revenueNotes · Management Fees`, `ytd · highVariances · Repairs & Maintenance`, `ytd · highVariances · Utilities`, `ytd · highVariances · Property Insurance`, `ytd · highVariances · Landscaping`, `ytd · revenueNotes · Management Fees`

Interpretation:

- **Run 1 vs Run 2** vary Report Style, Length and Dollar Reference (Tone Neutral, Abbreviate **Off** in both).
- **Run 3 vs Run 4** vary Report Style, Length and Dollar Reference (Tone **Cautious**, Abbreviate **On** in both).
- **Run 1 vs Run 3** vary Tone and Abbreviate (plus Length) — the only pair that toggles **Abbreviate Dollar Values**.

## (c) Core question

**When Tone = Cautious and Abbreviate = On, do Report Style, Length, and Dollar Reference change the output?**

### ➡️ NO

Run 3 and Run 4 — which differ only in Report Style (Concise vs Detailed), Length
(Standard vs Verbose), and Dollar Reference (Minimum vs Detail), with Tone and
Abbreviate held constant — produce **word-for-word identical** narratives. With the LLM
stubbed to a fixed, successful response, these three controls have **no effect** on the
rendered text.

## (d) Why — the responsible code path

There is **no deterministic branch** that consumes Report Style, Tone, Length, or Dollar
Reference. These four controls are read in exactly one place:

- **`server/llm.js` → `buildStyleInstructions` (lines 156–192)** — the ONLY consumer of
  `reportStyle`, `tone`, `length`, and `dollarReferences`. It folds them into the LLM
  **system prompt** via `buildSystemPrompt` (line 196–198).
- That prompt only reaches output through the LLM call in **`server/generate.js` → the
  `LLM_ENABLED && llmMode === 'cited'` block (lines 104–124)**, which calls
  `enrichWithLLM` (line 119). That block runs only when the server flag is on AND the
  per-IP limit (`checkIpLimit`) AND the global circuit breaker (`checkGlobalLimit`) both
  permit. On any breach `enrichWithLLM` returns the notes unchanged.

Therefore, whenever the LLM output is held constant — this stub here, **or the
rate-limit / circuit-breaker fallback in production**, or a static-host build with no
server — Report Style, Tone, Length, and Dollar Reference change nothing in the rendered
narrative. The deterministic narrative (`generateNarrative`) and the deterministic
enrichment (`enrichNarrative`) never read these four controls.

**The lone exception is Abbreviate Dollar Values.** It is the only Style control with a
deterministic effect: `src/hooks/useGenerate.js:126` applies `applyDollarAbbreviation`
(`src/lib/narrative/dollarAbbrev.js`) as a cosmetic pass over the finished text. That is
exactly why **Run 1 vs Run 3 is DIFFERENT** while Run 1 vs Run 2 and Run 3 vs Run 4 are
identical. (Note: `reportStyle` is also NOT wired to the enrichment `commentaryMode` —
`commentaryModeFromStyle` reads a separate `commentaryDetail` field that is absent from
the active Style panel, so it always resolves to `detailed`.)

### The style engine *did* encode every setting — it just never reaches the output

The real `buildStyleInstructions` produced a **distinct system prompt for each run**
(all four prompts distinct: `true`; Run 3 prompt ≠ Run 4 prompt:
`true`). The settings are captured faithfully at the prompt layer;
they simply have no path to the rendered narrative once the LLM response is constant.

Run 3 vs Run 4 STYLE INSTRUCTIONS (proof the prompts differ):

```text
Run 3: Write in a Concise style with Cautious tone and Standard length. Concise style: tight, direct sentences with one clear statement per variance line. Cautious tone: use softer, hedging language such as "appears to", "may reflect", and "consistent with". This overrides the instruction above to avoid hedging. Standard length: a normal, balanced amount of commentary per line. Abbreviate dollar values (for example, $5K, $1.2M, $3.4M). Reference only the variance figure, not the actual or budget figures, in narrative text.

Run 4: Write in a Detailed style with Cautious tone and Verbose length. Detailed style: a fuller explanation with more context around each variance. Cautious tone: use softer, hedging language such as "appears to", "may reflect", and "consistent with". This overrides the instruction above to avoid hedging. Verbose length: extended commentary with more supporting context. Abbreviate dollar values (for example, $5K, $1.2M, $3.4M). Reference the actual, budget, and variance figures in narrative text.
```

## (e) Every line was ENRICHED (LLM stub), not fallback

All flagged lines in all four runs carry the `[ENRICHED]` label and `llmEnriched: true`:
**`true`**. The stub always succeeds, so this result is **independent of the**
**per-day rate limit, the global circuit breaker, and any API failure** — it reflects the
style engine alone.

---

_Generated by `scripts/style-controls-diagnostic.mjs`._
