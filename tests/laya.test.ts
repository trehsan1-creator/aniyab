import { test } from 'node:test';
import assert from 'node:assert/strict';

import { answerConfidence, readChoice, readNoul, readScore, traceOf, layaConfig, type LayaAnswer } from '../lib/laya';

/**
 * These tests pin the *documented* Laya response shape
 * (https://laya.studio/docs/api). They deliberately do not use the mock: the
 * previous bug was a mock that agreed with a wrong client, so the contract is
 * asserted from the outside here.
 */

test('readChoice picks the highest-probability label', () => {
  const answer: LayaAnswer = {
    type: 'choice',
    probabilities: { validate_imei: 0.81, none: 0.11, get_report_status: 0.08 },
  };
  const top = readChoice(answer);
  assert.deepEqual(top, { label: 'validate_imei', probability: 0.81 });
});

test('readChoice falls back to the `choice` field when probabilities are absent', () => {
  const top = readChoice({ type: 'choice', choice: 'price', confidence: 0.66 });
  assert.deepEqual(top, { label: 'price', probability: 0.66 });
});

test('readChoice returns null for a missing answer', () => {
  assert.equal(readChoice(undefined), null);
});

test('readNoul returns P(yes) from the typed field', () => {
  assert.equal(readNoul({ type: 'noul', noul: 0.93 }), 0.93);
});

test('readNoul understands a probabilities-only payload', () => {
  assert.equal(readNoul({ type: 'noul', probabilities: { yes: 0.4, no: 0.6 } }), 0.4);
});

test('readNoul returns null when the answer carries no noul value', () => {
  assert.equal(readNoul({ type: 'choice', probabilities: { a: 1 } }), null);
});

test('readScore normalises a 4-level score to 0..1', () => {
  const mid = readScore({ type: 'score', score: 2, confidence: 0.7 }, 4);
  assert.ok(mid);
  assert.equal(mid.value, 2);
  assert.ok(Math.abs(mid.normalised - 2 / 3) < 1e-9);
});

test('readScore clamps out-of-range scores', () => {
  const high = readScore({ type: 'score', score: 9 }, 4);
  assert.equal(high?.normalised, 1);
});

test('answerConfidence for noul is max(p, 1-p) as documented', () => {
  assert.ok(Math.abs(answerConfidence({ type: 'noul', noul: 0.9 }) - 0.9) < 1e-9);
  assert.ok(Math.abs(answerConfidence({ type: 'noul', noul: 0.1 }) - 0.9) < 1e-9);
  assert.equal(answerConfidence({ type: 'noul', noul: 0.5 }), 0.5);
});

test('answerConfidence prefers the reported `confidence` over raw probabilities', () => {
  // A two-way split: one option leads, but confidence is low. Gating on the top
  // probability here would wrongly act on a coin flip.
  const answer = { type: 'choice' as const, probabilities: { a: 0.55, b: 0.45 }, confidence: 0.1 };
  assert.equal(answerConfidence(answer), 0.1);
});

test('answerConfidence does not use act_probability', () => {
  const answer = { type: 'choice' as const, probabilities: { a: 0.6, b: 0.4 }, action: { act_probability: 0.999 } } as never;
  assert.equal(answerConfidence(answer), 0.6);
});

test('answerConfidence for a choice is the top probability', () => {
  assert.equal(answerConfidence({ type: 'choice', probabilities: { a: 0.2, b: 0.75 } }), 0.75);
});

test('traceOf reports off when nothing is configured', () => {
  const t = traceOf({ enabled: false, endpoint: null, apiKey: null, model: 'multilingual', timeoutMs: 4000 });
  assert.equal(t.mode, 'off');
  assert.equal(t.configured, false);
  assert.equal(t.status, 'off');
  assert.deepEqual(t.answered, []);
});

test('traceOf marks a configured-but-unused client as skipped, never ok', () => {
  const t = traceOf({
    enabled: true,
    endpoint: 'https://api.laya.studio/v1/systemone',
    apiKey: 'lsk_live_test',
    model: 'multilingual',
    timeoutMs: 4000,
  });
  assert.equal(t.mode, 'live');
  assert.equal(t.status, 'skipped');
});

test('layaConfig defaults to the multilingual checkpoint (Persian needs it)', () => {
  const saved = { ...process.env };
  try {
    delete process.env.LAYA_MODEL;
    delete process.env.LAYA_SYSTEMONE_MODE;
    process.env.LAYA_SYSTEMONE_ENDPOINT = 'https://api.laya.studio/v1/systemone';
    process.env.LAYA_API_KEY = 'lsk_live_test';
    const cfg = layaConfig();
    assert.equal(cfg.model, 'multilingual');
    assert.equal(cfg.enabled, true);
  } finally {
    process.env = saved;
  }
});

test('LAYA_SYSTEMONE_MODE=off disables the decision layer', () => {
  const saved = { ...process.env };
  try {
    process.env.LAYA_SYSTEMONE_ENDPOINT = 'https://api.laya.studio/v1/systemone';
    process.env.LAYA_API_KEY = 'lsk_live_test';
    process.env.LAYA_SYSTEMONE_MODE = 'off';
    assert.equal(layaConfig().enabled, false);
  } finally {
    process.env = saved;
  }
});

test('the last decision survives across module instances (shared global)', async () => {
  /**
   * The bug this pins: Next.js compiles each route into its own bundle, so a
   * module-level `let` was private to `/api/chat` and `/api/health` always read
   * `null` — health kept saying "configured-unused" while every real call was
   * failing with 402.
   */
  const saved = { ...process.env };
  try {
    process.env.LAYA_SYSTEMONE_ENDPOINT = 'http://127.0.0.1:9/v1/systemone';
    process.env.LAYA_API_KEY = 'lsk_live_test';
    delete process.env.LAYA_SYSTEMONE_MODE;

    const { decide, layaLastDecision } = await import('../lib/laya');
    const started = await decide({ state: 'سلام', questions: { q: { type: 'noul', instructions: 'hi?' } } });

    assert.equal(started.decision, null, 'an unreachable endpoint must not produce a decision');
    const last = layaLastDecision();
    assert.ok(last, 'a failed call must still be recorded — silence is what hid the 402');
    assert.equal(last!.status, 'failed');
  } finally {
    process.env = saved;
  }
});
