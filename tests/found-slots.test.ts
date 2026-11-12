import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractFoundSlots, extractPrivateMarks, extractArea } from '../lib/agent/found-slots';
import { routeIntent } from '../lib/agent/router';

/**
 * These pin the bug that made found-item reports useless: the record dropped
 * everything the finder said, so ownership could never be verified and every
 * report looked identical.
 */

test('the private marks survive: colour, material and contents are kept', () => {
  const slots = extractFoundSlots('یک کیف چرم مشکی با کارت دانشجویی پیدا کردم توی مترو تجریش');
  assert.equal(slots.itemType, 'کیف');
  assert.ok(slots.descriptionPrivate, 'marks must not be dropped');
  assert.match(slots.descriptionPrivate!, /مشکی/);
  assert.match(slots.descriptionPrivate!, /چرم/);
  assert.match(slots.descriptionPrivate!, /کارت دانشجویی/);
});

test('a colour written with ZWNJ still matches (قهوه‌ای)', () => {
  // `\b` does not work on Persian text, and a ZWNJ inside the word used to
  // break the match — both produced silently empty marks.
  assert.match(extractPrivateMarks('کیف قهوه‌ای پیدا کردم') ?? '', /قهوه‌ای/);
});

test('the landmark is kept, not just the coarse place type', () => {
  assert.equal(extractArea('کیف پیدا کردم توی مترو تجریش'), 'مترو تجریش');
  assert.equal(extractArea('کلید پیدا کردم تو پارکینگ'), 'پارکینگ');
  assert.equal(extractArea('شی پیدا کردم'), null);
});

test('the public description never contains a private mark', () => {
  const slots = extractFoundSlots('کیف چرم مشکی با کارت دانشجویی پیدا کردم در مترو تجریش');
  assert.doesNotMatch(slots.descriptionPublic, /مشکی|چرم|دانشجویی/);
  // …but it does say what and where, so a nearby owner can recognise it.
  assert.match(slots.descriptionPublic, /کیف/);
  assert.match(slots.descriptionPublic, /مترو تجریش/);
});

test('an identity document is not registered as a phone', () => {
  assert.equal(extractFoundSlots('کارت ملی پیدا کردم').itemType, 'کارت ملی');
  assert.equal(extractFoundSlots('کارت بانکی پیدا کردم').itemType, 'کارت بانکی');
});

test('an unnamed item asks a follow-up instead of inventing a record', () => {
  const routed = routeIntent('یک شی پیدا کردم');
  assert.equal(routed.kind, 'need-slot');
  if (routed.kind === 'need-slot') assert.equal(routed.slot, 'item-type');
});

test('a named found item routes to the tool with real arguments', () => {
  const routed = routeIntent('یه گوشی سامسونگ آبی پیدا کردم تو تاکسی');
  assert.equal(routed.kind, 'tool');
  if (routed.kind !== 'tool') return;
  assert.equal(routed.tool, 'register_found_item');
  assert.equal(routed.args.itemType, 'گوشی موبایل');
  assert.equal(routed.args.area, 'تاکسی');
  assert.match(String(routed.args.descriptionPrivate), /آبی/);
  // No more hardcoded city: an unstated place must stay unstated.
  assert.notEqual(routed.args.area, 'تهران');
});

test('an unstated place is absent rather than guessed as تهران', () => {
  const routed = routeIntent('کیف مشکی پیدا کردم');
  assert.equal(routed.kind, 'tool');
  if (routed.kind !== 'tool') return;
  assert.equal(routed.args.area, undefined);
});

test('an identity document is never treated as its own private mark', () => {
  // «کارت ملی» proves nothing about ownership: it is the item, not a mark.
  assert.equal(extractPrivateMarks('کارت ملی پیدا کردم', 'کارت ملی'), null);
});
