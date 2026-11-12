import { test } from 'node:test';
import assert from 'node:assert/strict';

import { matchFoundItem, tierForTurn, LAYA_TOOL_OPTIONS, LAYA_THRESHOLDS } from '../lib/agent/laya-decisions';

/**
 * These run with Laya disabled (no endpoint/key in the test env), which is the
 * important half of the contract: the decision layer must degrade to `null`
 * and the caller must keep working. Network behaviour is verified separately,
 * against the local mock (`scripts/mock-laya.cjs`) or the real API.
 */

test('with Laya off, tierForTurn returns no tier rather than throwing', async () => {
  const saved = { ...process.env };
  try {
    delete process.env.LAYA_SYSTEMONE_ENDPOINT;
    delete process.env.LAYA_API_ENDPOINT;
    delete process.env.LAYA_API_KEY;
    const { tier, trace } = await tierForTurn({ message: 'سلام', flow: 'general', hasTools: false });
    assert.equal(tier, null);
    assert.equal(trace.mode, 'off');
    assert.equal(trace.status, 'off');
  } finally {
    process.env = saved;
  }
});

test('with Laya off, matchFoundItem returns no match and an honest trace', async () => {
  const saved = { ...process.env };
  try {
    delete process.env.LAYA_SYSTEMONE_ENDPOINT;
    delete process.env.LAYA_API_ENDPOINT;
    delete process.env.LAYA_API_KEY;
    const { match, trace } = await matchFoundItem({
      itemType: 'کیف',
      lostDescription: 'کیف چرمی مشکی',
      foundDescriptionPrivate: 'کیف مشکی با کارت دانشجویی',
    });
    assert.equal(match, null);
    assert.equal(trace.configured, false);
  } finally {
    process.env = saved;
  }
});

test('the tool question is a real threshold above a coin flip', () => {
  assert.ok(LAYA_THRESHOLDS.tool >= 0.5 && LAYA_THRESHOLDS.tool <= 1);
  assert.ok(LAYA_THRESHOLDS.tier >= 0.3 && LAYA_THRESHOLDS.tier <= 1);
});

test('every registered tool is offered to Laya, and nothing else is', async () => {
  /**
   * `lib/agent/tools.ts` is server-only, so it cannot be imported here. Reading
   * the registry's source is the honest alternative: it still fails the moment
   * the two lists drift, which is the whole point of the test.
   */
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../lib/agent/tools.ts', import.meta.url), 'utf8');
  const registered = [...source.matchAll(/^\s{4}name: '([a-z_]+)'/gm)].map((m) => m[1]).sort();

  assert.ok(registered.length >= 10, 'expected to find the tool registry in tools.ts');
  const offered = LAYA_TOOL_OPTIONS.filter((n) => n !== 'none').sort();

  assert.deepEqual(
    offered,
    registered,
    'the Laya `tool` question and the tool registry drifted apart — Laya can only choose tools we tell it about',
  );
  assert.ok(
    LAYA_TOOL_OPTIONS.includes('none'),
    '`none` must always be an option, or every chat turn would have to pick a tool',
  );
});
