# دستیار هوشمند آنی‌یاب · Aniyab Smart AI Assistant

Production-grade Next.js 14 (App Router) chat surface for **مرکز ملی گمشده‌ها و پیداشده‌های آنی‌یاب**, wired to the
Laya.Studio Orchestrator (SystemOne gateway → NVIDIA NIM `nvidia/nemotron-3.5-bolt-e4b`).

- **Strict RTL / native Persian** — `dir="rtl"`, `lang="fa"`, Peyda (پیدا) `PeydaWebFaNum` self-hosted, Persian numerals ۰-۹
- **Dark aesthetic** — Midnight Navy `#102333`, Deep Blue glass `#1E3A72`, Signal Orange → Ember `#FF7A00 → #f05327`
- **Dual-mode transport** — SSE token streaming with a JSON fallback, both handled by one `sendMessage`
- **3 business flows** — smart tag lead-gen, lost & IMEI emergency, found-item reporting

---

## 1. Deliverables map

| Path | What it is |
| --- | --- |
| `app/api/chat/route.ts` | Route Handler (Node runtime): validates, injects the flow system prompt, calls SystemOne (optional), forwards to NVIDIA NIM with `Authorization: Bearer`, pipes `text/event-stream` straight through or normalises `application/json`, maps 401/403/404/429/5xx/timeout to a Persian error contract |
| `lib/llm.ts` | Provider layer: NVIDIA NIM ⇄ Laya endpoint resolution, credential guards, SystemOne mode + preflight-hint parsing |
| `components/AniyabChatInterface.tsx` | `'use client'` chat UI: header + live status, flow tabs, streaming engine, rich answer renderer, copy, auto-scroll, hotline footer |
| `tailwind.config.ts` | Design tokens: colours, `font-peyda`, gradients, shadows, keyframes/animations |
| `lib/peyda.ts` | `next/font/local` loader for the Peyda weights (`--font-peyda`) |
| `app/globals.css` | `@font-face` fallbacks, glassmorphism / CTA component classes, RTL bubbles, scrollbars, reduced-motion |
| `app/layout.tsx` | `<html lang="fa" dir="rtl">`, metadata, viewport (`#102333` theme colour) |
| `scripts/mock-laya.cjs` | Offline stand-in for the orchestrator (stream, JSON, 403/404/429/500/timeout) |

## 2. Environment & topology

```bash
cp .env.example .env.local
```

The app talks to **two** upstreams with different jobs:

| Concern | Upstream | Variables |
| --- | --- | --- |
| **Inference** (tokens) | NVIDIA NIM — `integrate.api.nvidia.com/v1/chat/completions` | `NVIDIA_API_KEY` (`nvapi-…`), `NVIDIA_API_ENDPOINT`, `NVIDIA_MODEL` |
| **Orchestration** (policy/session) | Laya SystemOne — `/v1/systemone` | `LAYA_SYSTEMONE_ENDPOINT`, `LAYA_API_KEY`, `LAYA_SYSTEMONE_MODE` |

`LAYA_SYSTEMONE_MODE` selects the topology:

- **`off`** (default) — NVIDIA only; SystemOne is never contacted.
- **`preflight`** — SystemOne is asked for hints (system prompt, model, temperature) and we then call
  NVIDIA ourselves. One extra JSON round-trip, lowest blast radius.
- **`orchestrate`** — SystemOne *is* the model endpoint; if it errors or is unreachable the route
  transparently falls back to NVIDIA, so the user always gets an answer.

Every response carries `X-Aniyab-Served-By` (`nvidia` / `systemone` / `laya`) and
`X-Aniyab-Systemone` (`off` / `ok` / `skipped` / `failed`) so you can see which path served a turn.
`GET /api/chat` reports the resolved provider topology without leaking any secret.

| Variable | Purpose |
| --- | --- |
| `NVIDIA_API_KEY` | **Required.** `nvapi-…` key from build.nvidia.com — server-side only |
| `NVIDIA_MODEL` | Defaults to `nvidia/nemotron-3.5-bolt-e4b`; a retired id is skipped automatically |
| `LAYA_SYSTEMONE_ENDPOINT` | Optional SystemOne gateway URL |
| `LAYA_API_KEY` | Bearer token for SystemOne / Laya inference — **never** prefix with `NEXT_PUBLIC_` |
| `LAYA_SYSTEMONE_MODE` | `off` (default) · `preflight` · `orchestrate` |
| `LLM_PROVIDER` | `nvidia` (default) or `laya` — switch the inference upstream entirely |
| `LLM_TIMEOUT_MS` | Hard upstream ceiling, defaults to `45000` (keep below `maxDuration`) |

## 3. Run

```bash
npm install
npm run dev          # http://localhost:3000  (needs a real LAYA_API_ENDPOINT)
npm run dev:demo     # http://localhost:3000  (spawns the local mock orchestrator)
npm run build        # production build
npm run typecheck    # tsc --noEmit
```

## 4. API contract

**Request**

```http
POST /api/chat
Content-Type: application/json

{ "messages": [{ "role": "user", "content": "…" }],
  "sessionId": "b6f1…uuid",
  "activeFlow": "smart-tag" | "lost-report" | "found-report" | "general",
  "provider": "nvidia" | "laya"     // optional per-request override
}
```

**Success** — mirrors whatever the upstream returned:

- `text/event-stream` → OpenAI-style `data: {"choices":[{"delta":{"content":"…"}}]}` frames + `data: [DONE]`
- `application/json` → `{ ok, sessionId, activeFlow, choices[0].message.content, answer, model, latencyMs }`

**Failure** (always Persian, always renderable in a bubble)

```json
{ "ok": false,
  "error": { "code": "RATE_LIMITED", "message": "…", "hint": "WAIT", "retryAfter": 7, "upstreamStatus": 429 },
  "answer": "…", "sessionId": "…" }
```

| Upstream | Returned | Code |
| --- | --- | --- |
| 401 / 403 | 502 | `UNAUTHORIZED` (includes the provider's own message) |
| 404 | 502 | `UPSTREAM_NOT_FOUND` |
| 402 / 429 | 429 | `RATE_LIMITED` (+ `Retry-After`, covers NVIDIA free-tier quota) |
| 5xx | 502 | `UPSTREAM_UNAVAILABLE` |
| no response in `LLM_TIMEOUT_MS` | 504 | `TIMEOUT` |
| fetch rejected | 502 | `NETWORK` |

`GET /api/chat` returns a health/config probe; `OPTIONS` returns CORS preflight.
`GET /api/chat?probe=1` additionally performs a real 16-token round-trip to the
default provider from inside the deployment and reports `probe.status` +
a bounded body excerpt — the fastest way to tell "key is missing" apart from
"key is rejected" apart from "NVIDIA dislikes the request body" in production.

NVIDIA NIM validates top-level body keys strictly and answers
`400 Validation: Unsupported parameter(s)`. Routing metadata is therefore only
sent to providers with `strictBody === false`; a 400 on the strict path triggers
one automatic retry with `slimPayload()` (documented fields only).

## 5. Server-side guardrails

- The **server owns the persona**: any client-supplied `system` message is dropped and replaced by the
  flow prompt in `FLOW_PROMPTS` (brand rules, Persian numerals, no PII/PAN requests, no "I am an AI").
- Payload is capped at 256 KiB, 40 turns, 8 000 chars per turn; oversized input returns `PAYLOAD_TOO_LARGE`.
- Client abort (`request.signal`) and the stream's `cancel()` both abort the upstream generation — you stop
  paying for tokens the moment the tab closes.
- `Cache-Control: no-store` + `X-Accel-Buffering: no` on every response.

## 6. Client behaviours

- `sessionId` minted with `crypto.randomUUID()` **in an effect** (SSR-safe), shown truncated in the composer, rotated by the header reset button.
- In-flight answers are buffered in a ref and painted once per animation frame — no render storm at 90 tok/s.
- Assistant replies render headings, ordered/unordered lists, `**bold**`, `` `inline code` ``, and links without `dangerouslySetInnerHTML`.
- Every digit the model emits is converted to Persian numerals; phone numbers and code spans are bidi-isolated.
- Sticky auto-scroll that pauses when the reader scrolls up (with a "آخرین پیام" jump button), `Shift+Enter` newline, stop-generation button, copy-to-clipboard, offline notice with retry.
- `prefers-reduced-motion` disables all animation.

## 7. Switching providers at runtime

```bash
# per request (the UI does not send this, but any client can)
{"messages":[…], "sessionId":"…", "activeFlow":"general", "provider":"laya"}

# globally
LLM_PROVIDER=laya     # + LAYA_API_ENDPOINT / LAYA_API_KEY
```

## 8. Deploying to Vercel

See **[DEPLOY.md](./DEPLOY.md)** (Persian) for the full walkthrough: project import, the three environment
variables, choosing the right `LAYA_API_ENDPOINT`, post-deploy smoke tests, error-code troubleshooting and
custom domains.

Short version — import the repo at <https://vercel.com/new>, add `NVIDIA_API_KEY`
(sensitive) and optionally `NVIDIA_MODEL` / `LAYA_SYSTEMONE_*`, then Deploy. `vercel.json` already pins
`regions: ["fra1"]` and `maxDuration: 60` for the chat function.

## 9. Notes for deployment

- The handler runs on the **Node.js** runtime with `maxDuration = 60`, so a slow orchestrator still gets a
  clean 504 instead of being cut off. Edge also works if you drop `LLM_TIMEOUT_MS` to ~25s
  (`export const runtime = 'edge'`); nothing else changes.
- Font files live in `public/fonts/` (Peyda `FaNum` build, weights 300/400/500/600/700/800) and are
  self-hosted, so there is no Google Fonts request from inside Iran.
- The `.env.local` in this checkout points at the bundled mock so the preview works without credentials;
  replace it before shipping.
