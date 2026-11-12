/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  scripts/test-tool-calling.mjs — Phase 1 gate
 * ─────────────────────────────────────────────────────────────────────────────
 *  Checks whether the configured NVIDIA NIM model actually returns OpenAI-style
 *  `tool_calls`. If it does not, the app must use the deterministic JSON-action
 *  fallback instead of pretending tool calling works.
 *
 *  Usage:  node scripts/test-tool-calling.mjs
 *  Exit 0 → at least one model supports tool calls (record which).
 *  Exit 1 → none do; the fallback router is mandatory.
 */

import { readFileSync } from 'node:fs';

const env = {};
try {
  for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {
  /* no .env.local — rely on process.env */
}

const KEY = process.env.NVIDIA_API_KEY || env.NVIDIA_API_KEY;
const ENDPOINT =
  process.env.NVIDIA_API_ENDPOINT ||
  env.NVIDIA_API_ENDPOINT ||
  'https://integrate.api.nvidia.com/v1/chat/completions';

const MODELS = [
  process.env.NVIDIA_MODEL || env.NVIDIA_MODEL,
  'nvidia/nemotron-3.5-bolt-e4b',
  'nvidia/nemotron-3.5-lightning-30b-a3b',
  'nvidia/nemotron-3.5-super-vl-120b-a12b',
].filter(Boolean);

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'validate_imei',
      description: 'Validate a 15-digit IMEI.',
      parameters: {
        type: 'object',
        properties: { imei: { type: 'string' } },
        required: ['imei'],
        additionalProperties: false,
      },
    },
  },
];

const MESSAGES = [
  {
    role: 'system',
    content: 'You are a Persian assistant. Always answer in Persian. Use tools when the user asks you to verify an IMEI.',
  },
  { role: 'user', content: 'لطفاً کد IMEI من را بررسی کن: 356938035643809' },
];

async function probe(model) {
  const started = Date.now();
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: MESSAGES,
        tools: TOOLS,
        tool_choice: 'auto',
        temperature: 0,
        max_tokens: 256,
        stream: false,
      }),
      signal: AbortSignal.timeout(25_000),
    });

    const text = await res.text();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* non-JSON */
    }

    const msg = parsed?.choices?.[0]?.message;
    const toolCalls = msg?.tool_calls ?? [];
    const hasContent = Boolean(msg?.content);

    return {
      model,
      status: res.status,
      ok: res.ok,
      supportsToolCalls: toolCalls.length > 0,
      toolCalls: toolCalls.map((c) => ({ name: c.function?.name, args: c.function?.arguments })),
      hasContent,
      contentSample: hasContent ? String(msg.content).slice(0, 90) : null,
      finishReason: parsed?.choices?.[0]?.finish_reason ?? null,
      ms: Date.now() - started,
      error: res.ok ? undefined : text.slice(0, 160),
    };
  } catch (err) {
    return { model, ok: false, status: 'network', supportsToolCalls: false, error: String(err.message).slice(0, 160) };
  }
}

const uniqueModels = [...new Set(MODELS)];
console.log(`Probing ${uniqueModels.length} model(s) at ${ENDPOINT}\n`);

const results = [];
for (const model of uniqueModels) {
  // eslint-disable-next-line no-await-in-loop
  const r = await probe(model);
  results.push(r);
  console.log(
    `${r.ok ? '✓' : '✗'} ${r.model}\n` +
      `    status=${r.status} toolCalls=${r.toolCalls?.length ?? 0} content=${r.hasContent} ms=${r.ms}` +
      (r.toolCalls?.length ? `\n    → ${JSON.stringify(r.toolCalls)}` : '') +
      (r.error ? `\n    error=${r.error}` : '') +
      (r.contentSample ? `\n    text="${r.contentSample}"` : ''),
  );
  console.log('');
}

const winners = results.filter((r) => r.supportsToolCalls);
if (winners.length) {
  console.log(`RESULT: tool calling SUPPORTED by ${winners.map((w) => w.model).join(', ')}`);
  process.exit(0);
}

const usable = results.filter((r) => r.ok);
console.log(
  `RESULT: no model returned tool_calls (${usable.length} model(s) responded normally).\n` +
    'DECISION: use the deterministic JSON-action fallback (action envelope) + UI-driven forms.\n' +
    'The agent loop will still try native tool calling first and fall back per turn.',
);
process.exit(1);
