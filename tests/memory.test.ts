import { test } from 'node:test';
import assert from 'node:assert/strict';

import { REPORT_STEPS, STEP_ORDER, deriveStatusIndex, deriveStatus, nextStatus, statusFa } from '../lib/status';

/** The timeline is the product's "it's alive" trick — it must be exact. */
test('timeline thresholds map to the five steps', () => {
  const created = new Date('2026-11-12T10:00:00Z').toISOString();
  const at = (minutes: number) => new Date('2026-11-12T10:00:00Z').getTime() + minutes * 60_000;

  assert.equal(deriveStatus(created, 'submitted', at(0)), 'submitted');
  assert.equal(deriveStatus(created, 'submitted', at(1)), 'referred');
  assert.equal(deriveStatus(created, 'submitted', at(3)), 'reviewing');
  assert.equal(deriveStatus(created, 'submitted', at(8)), 'matched');
  assert.equal(deriveStatus(created, 'submitted', at(20)), 'delivered');
  assert.equal(deriveStatus(created, 'submitted', at(999)), 'delivered');
});

test('a human-updated status is a floor, never a regression', () => {
  const created = new Date('2026-11-12T10:00:00Z').toISOString();
  const now = new Date('2026-11-12T10:00:10Z').getTime(); // 10s in → derived = submitted
  assert.equal(deriveStatus(created, 'matched', now), 'matched');
});

test('status index never exceeds the step count', () => {
  const created = new Date(Date.now() - 10 * 60 * 60_000).toISOString();
  const index = deriveStatusIndex(created, 'delivered');
  assert.ok(index >= 0 && index < STEP_ORDER.length);
  assert.equal(STEP_ORDER.length, REPORT_STEPS.length);
});

test('nextStatus stops at delivered', () => {
  assert.equal(nextStatus('submitted'), 'referred');
  assert.equal(nextStatus('matched'), 'delivered');
  assert.equal(nextStatus('delivered'), 'delivered');
});

test('status labels are Persian', () => {
  for (const step of REPORT_STEPS) {
    assert.match(statusFa(step.key), /[\u0600-\u06FF]/);
  }
});
