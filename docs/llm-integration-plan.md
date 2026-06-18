# LLM Integration Plan — Variance Narrative Generator

**Status:** Planning / pre-implementation  
**Prepared:** June 2026  
**Repo:** `gabrielbr408/variance-narrative-generator`

---

## 1. Why this exists

The variance narrative generator currently produces deterministic, rule-based commentary like:

> *"Elevator Contract exceeded budget by $40.5K (187%). The movement reflects a single credit of approximately $53,000 year-to-date."*

The target quality — exemplified by a manually-produced April 2026 commentary for 350 Rhode Island North — looks like:

> *"Prior-year ThyssenKrupp over-accrual reversed Jan ($52,992 credit); TK/Otis charges reclassed to prepaid (chk 2083; $4,845 TK 05/26–11/26 to PPD). Accounting true-up, not real savings."*

The gap is not a bug. It is architectural: the engine is deliberately deterministic, no-AI, and explicitly forbids causal language, exact figures, and vendor/check citations. An LLM reasoning over the raw GL is the only path to the target quality.

---

## 2. What the current engine does well (keep)

- Threshold logic: flags lines only when dollar AND percent both clear (e.g. >$15K and >15%)
- Column detection and row alignment across Current Period + YTD
- `diagnosis` metadata layer already computes the "nature" of each variance:
  `TIMING_PHASING`, `ACCRUAL_TRUEUP`, `REAL_SPEND`, `MAPPING_PASSTHROUGH`, etc.
- Structured `support` metadata: matched GL rows per flagged account, confidence scores
- Deterministic fallback: always produces a valid result even without enrichment

The LLM step **replaces only the final sentence-rendering** for flagged lines that have GL evidence. The threshold logic, column detection, and variance math stay deterministic.

---

## 3. Proposed architecture

### 3.1 Pipeline change

```
[existing]  Upload → Classify → Extract → Normalize → Variance → Narrative (deterministic)
[new]                                                                        ↓
                                                                  Enrich via LLM (flagged lines only)
                                                                             ↓
                                                                  Merge → Export
```

The deterministic narrative becomes the **skeleton**. For each flagged note that has GL evidence (`note.support` populated, `note.enriched === true`), the server calls the LLM with:

- The variance sentence (account, direction, dollar, percent)
- The matched GL rows for that account (vendor names, memos, amounts, dates — already extracted)
- The `diagnosis.nature` label (so the model knows it's an accrual true-up vs. real spend)
- A strict system prompt with tone/format rules

The model returns a cited narrative sentence (or short paragraph). That replaces the conservative evidence sentence. If the call fails, the deterministic sentence stands unchanged.

### 3.2 What travels to the API

The browser already parses the uploaded files client-side. Only **structured row data** needs to travel to the server — not the raw XLSX/PDF bytes. For a flagged account the payload is roughly:

```json
{
  "account": "Elevator Contract",
  "varianceAmount": 40500,
  "variancePercent": 1.87,
  "comparisonType": "budget",
  "period": "ytd",
  "diagnosis": { "nature": "ACCRUAL_TRUEUP", ... },
  "glRows": [
    { "date": "2026-01-15", "vendor": "ThyssenKrupp", "amount": -52992, "memo": "Prior yr accrual reversal" },
    ...
  ]
}
```

Maximum ~40 rows × 10 flagged lines per generation.

### 3.3 Data disclosure

The GL rows (vendor names, amounts, check/invoice references, memos) leave the user's browser and are sent to the Anthropic API. This must be disclosed clearly before the user hits Generate. Proposed language in the UI:

> *"Generating cited commentary sends your GL transaction detail to Anthropic's API to produce vendor-cited narratives. No data is stored on our servers. See Anthropic's privacy policy for API data handling. To generate without sending data, use Conservative mode."*

Conservative mode (deterministic only, no LLM call) remains available as a zero-disclosure option.

---

## 4. Cost and abuse protection (no auth required)

Four levers applied in order on every request:

| Lever | Mechanism | Protects against |
|---|---|---|
| **Model** | Haiku 4.5 (`claude-haiku-4-5-20251001`) — ~20× cheaper than Opus | baseline cost |
| **Input cap** | Max 40 GL rows per flagged line, max 10 lines per generation | large-file abuse |
| **IP rate limit** | 5 LLM generations per IP per 24 hours (in-memory, server) | individual overuse |
| **Global circuit breaker** | N total LLM calls per day across all users; falls back to deterministic on breach | traffic spike / viral event |

### 4.1 Estimated cost

- ~2,500-row GL, 6–8 flagged lines, 40 rows/line max → ~3,000–5,000 input tokens + ~500 output tokens per generation
- At Haiku 4.5 pricing: ~$0.002–0.005 per generation
- 200 generations/day global cap → ~$0.40–$1.00/day max, ~$12–30/month

### 4.2 Circuit breaker values (suggested starting point)

```
IP_LIMIT_PER_DAY   = 5
GLOBAL_LIMIT_PER_DAY = 200
WINDOW_MS          = 86_400_000  (24 hours, rolling)
```

Adjust after observing actual usage patterns. These are conservative — tighten or loosen based on real data.

### 4.3 Fallback behavior

```
LLM call fails / rate limited / circuit breaker tripped
  → log the reason server-side (never surfaced to user)
  → return deterministic narrative unchanged
  → UI shows no error (the result is still valid)
```

---

## 5. Server changes required

`server/generate.js` currently receives uploaded files and returns a JSON narrative. Changes needed:

1. **Add Anthropic SDK** (`@anthropic-ai/sdk`) as a server dependency
2. **Store API key** in an environment variable (`ANTHROPIC_API_KEY`), never in code or browser
3. **Add IP rate-limit middleware** (in-memory map, no Redis needed initially)
4. **Add global circuit breaker** (single counter + reset timer)
5. **Add `enrichWithLLM(flaggedNotes, glEvidence)` function** — builds the prompt, calls Haiku, parses response
6. **Merge LLM sentences** back onto the deterministic narrative notes before returning

The browser-side pipeline is unchanged. The client sends the same multipart POST it does today; the server now optionally enriches the narrative before responding.

---

## 6. System prompt design (key constraints)

The model should be given strict guardrails matching the existing tone standard:

- Write for ownership/asset-manager reporting: factual, specific
- Distinguish one-time vs. recurring vs. timing vs. accounting true-up
- Cite vendor names and check/reference numbers when present in the GL rows provided
- Never invent figures not present in the provided rows
- Do not restate the dollar/percent (already on the variance sentence)
- One sentence or two maximum per note
- No hedging language ("it appears", "may have", "possibly")

The `diagnosis.nature` label becomes explicit model guidance:
- `ACCRUAL_TRUEUP` → lead with the reversal/true-up framing
- `TIMING_PHASING` → lead with the budget-phasing/timing framing
- `REAL_SPEND` → state the vendor and the nature of the spend
- `MAPPING_PASSTHROUGH` → explain the offset/recovery structure

---

## 7. Path to Option B (auth + billing, when scale warrants)

The IP rate-limit approach is an interim measure. Natural triggers to move to auth + billing:

- Users emailing/messaging that they hit the 5/day cap legitimately
- Monthly Anthropic bill crossing a threshold you set (e.g. $50/month)
- A specific enterprise/client relationship that needs more than 5/day

When that happens, the server already has the LLM plumbing. Auth + billing adds:

1. Login (email/password or OAuth — Clerk, Auth0, or similar)
2. Per-user usage counter (replace the IP counter with a user ID counter)
3. Stripe integration for subscription billing
4. Tiered limits (free: 5/month; paid: unlimited)

The product and LLM logic are unchanged — it's purely an access-control layer on top.

---

## 8. Open questions / decisions needed

1. **API key source**: Will you host the key (Option B track), or start with user-supplied keys as an interim? User-supplied keys have zero cost risk but add setup friction.

2. **Conservative mode default**: Should LLM enrichment be opt-in (user must enable it, seeing the data disclosure once) or opt-out (on by default, with a one-time disclosure banner)? Opt-in is more respectful; opt-out maximises the number of users who get good output.

3. **Global cap value**: 200/day is a guess. What's your actual risk tolerance in $/day? Set the cap from that number, not the other way around.

4. **Haiku vs. Sonnet**: Haiku is cheapest. Sonnet 4.6 (`claude-sonnet-4-6`) is ~5× more expensive but produces noticeably better cited prose — especially for complex accrual/offset lines. Worth A/B testing on the sample before committing.

5. **Streaming**: Do you want the narrative to stream in as the model generates it (better UX for 10–15 second calls) or wait for the full response (simpler server code)? Streaming requires SSE or chunked transfer on the server.

6. **Disclosure copy**: The data-disclosure language proposed in §3.3 needs legal/compliance review before going to any client with a real GL.

---

## 9. Immediate next steps (when ready to implement)

1. Decide on API key source (hosted vs. user-supplied) — unblocks everything else
2. Decide on opt-in vs. opt-out UX — determines where the disclosure UI goes
3. Decide on Haiku vs. Sonnet — run the April 2026 sample through both and compare
4. Implement server changes (§5) behind a feature flag so the deterministic path is always the fallback
5. Update README to reflect the new "No AI" → "Optional AI enrichment" status
