import { test } from 'node:test';
import assert from 'node:assert/strict';

import { quoteNewspaperAd, buildAdText } from '../lib/pricing';

const base = {
  newspaperId: 'hamshahri' as const,
  docTypeId: 'national-id' as const,
  sizeId: 'small' as const,
  days: 1,
  highlighted: false,
};

test('quote is deterministic for identical input', () => {
  const input = { ...base, docTypeId: 'passport' as const, sizeId: 'medium' as const, days: 2, highlighted: true };
  assert.equal(quoteNewspaperAd(input).totalToman, quoteNewspaperAd(input).totalToman);
});

test('adding repeat days costs more than a single day', () => {
  const one = quoteNewspaperAd({ ...base, newspaperId: 'iran' });
  const three = quoteNewspaperAd({ ...base, newspaperId: 'iran', days: 3 });
  assert.ok(three.totalToman > one.totalToman);
});

test('VAT is exactly 9% of the subtotal', () => {
  const q = quoteNewspaperAd({ ...base, newspaperId: 'kayhan', docTypeId: 'phone', sizeId: 'large' });
  assert.equal(q.vatToman, Math.round(q.subtotalToman * 0.09));
  assert.equal(q.totalToman, q.subtotalToman + q.vatToman);
});

test('price lines always sum to the subtotal', () => {
  const q = quoteNewspaperAd({ ...base, newspaperId: 'shargh', docTypeId: 'passport', sizeId: 'medium', days: 3, highlighted: true });
  assert.equal(q.lines.reduce((a, l) => a + l.amountToman, 0), q.subtotalToman);
});

test('days are clamped to 1..7', () => {
  const q = quoteNewspaperAd({ ...base, days: 99 });
  assert.ok(q.totalToman > 0);
  assert.ok(q.explainFa.includes('۷'));
});

test('total renders with Persian digits only', () => {
  const q = quoteNewspaperAd(base);
  assert.match(q.totalFa, /[۰-۹]/);
  assert.ok(!/[0-9]/.test(q.totalFa), 'no ASCII digits in a Persian price');
});

test('ad text never leaks private marks', () => {
  const text = buildAdText({ docTypeId: 'bank-card', itemName: 'کارت بانکی', placeFa: 'مترو ونک' });
  assert.ok(text.includes('مترو ونک'));
  assert.ok(text.includes('آنی‌یاب'));
});
