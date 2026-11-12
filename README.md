# دستیار هوشمند آنی‌یاب · Aniyab Smart AI Assistant

Production-grade Next.js 14 (App Router) chat surface for **مرکز ملی گمشده‌ها و پیداشده‌های آنی‌یاب**, wired to the
Laya.Studio Orchestrator (SystemOne gateway → NVIDIA NIM `meta/llama-3.1-8b-instruct`).

- **Strict RTL / native Persian** — `dir="rtl"`, `lang="fa"`, Peyda (پیدا) `PeydaWebFaNum` self-hosted, Persian numerals ۰-۹
- **Dark aesthetic** — Midnight Navy `#102333`, Deep Blue glass `#1E3A72`, Signal Orange → Ember `#FF7A00 → #f05327`
- **Dual-mode transport** — SSE token streaming with a JSON fallback, both handled by one `sendMessage`
- **3 business flows** — smart tag lead-gen, lost & IMEI emergency, found-item reporting

---

## 1. Deliverables map

| Path | What it is |
| --- | --- |
| `app/api/chat/route.ts` | Route Handler (Node runtime): validates, injects the flow system prompt, forwards to Laya with `Authorization: Bearer`, pipes `text/event-stream` straight through or normalises `application/json`, maps 403/404/429/5xx/timeout to a Persian error contract |
| `components/AniyabChatInterface.tsx` | `'use client'` chat UI: header + live status, flow tabs, streaming engine, rich answer renderer, copy, auto-scroll, hotline footer |
| `tailwind.config.ts` | Design tokens: colours, `font-peyda`, gradients, shadows, keyframes/animations |
| `lib/peyda.ts` | `next/font/local` loader for the Peyda weights (`--font-peyda`) |
| `app/globals.css` | `@font-face` fallbacks, glassmorphism / CTA component classes, RTL bubbles, scrollbars, reduced-motion |
| `app/layout.tsx` | `<html lang="fa" dir="rtl">`, metadata, viewport (`#102333` theme colour) |
| `scripts/mock-laya.cjs` | Offline stand-in for the orchestrator (stream, JSON, 403/404/429/500/timeout) |

## 2. Environment

```bash
cp .env.example .env.local
```

| Variable | Purpose |
| --- | --- |
| `LAYA_API_ENDPOINT` | Full gateway URL, e.g. `https://api.laya.studio/v1/chat/completions` or your `/v1/systemone` route |
| `LAYA_API_KEY` | Server-only bearer token — **never** prefix with `NEXT_PUBLIC_` |
| `LAYA_MODEL` | Defaults to `meta/llama-3.1-8b-instruct` |
| `LAYA_TIMEOUT_MS` | Hard upstream ceiling, defaults to `45000` |

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
  "activeFlow": "smart-tag" | "lost-report" | "found-report" | "general" }
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
| 403 / 401 | 502 | `UNAUTHORIZED` |
| 404 | 502 | `UPSTREAM_NOT_FOUND` |
| 429 | 429 | `RATE_LIMITED` (+ `Retry-After`) |
| 5xx | 502 | `UPSTREAM_UNAVAILABLE` |
| no response in `LAYA_TIMEOUT_MS` | 504 | `TIMEOUT` |
| fetch rejected | 502 | `NETWORK` |

`GET /api/chat` returns a health/config probe; `OPTIONS` returns CORS preflight.

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

## 7. Deploying to Vercel

See **[DEPLOY.md](./DEPLOY.md)** (Persian) for the full walkthrough: project import, the three environment
variables, choosing the right `LAYA_API_ENDPOINT`, post-deploy smoke tests, error-code troubleshooting and
custom domains.

Short version — import the repo at <https://vercel.com/new>, add `LAYA_API_ENDPOINT`, `LAYA_API_KEY`
(sensitive) and optionally `LAYA_MODEL` / `LAYA_TIMEOUT_MS`, then Deploy. `vercel.json` already pins
`regions: ["fra1"]` and `maxDuration: 60` for the chat function.

## 8. Notes for deployment

- The handler runs on the **Node.js** runtime with `maxDuration = 60`, so a slow orchestrator still gets a
  clean 504 instead of being cut off. Edge also works if you drop `LAYA_TIMEOUT_MS` to ~25s
  (`export const runtime = 'edge'`); nothing else changes.
- Font files live in `public/fonts/` (Peyda `FaNum` build, weights 300/400/500/600/700/800) and are
  self-hosted, so there is no Google Fonts request from inside Iran.
- The `.env.local` in this checkout points at the bundled mock so the preview works without credentials;
  replace it before shipping.
