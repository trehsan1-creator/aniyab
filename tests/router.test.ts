import { test } from 'node:test';
import assert from 'node:assert/strict';

import { routeIntent } from '../lib/agent/router';

test('a 15-digit number routes to validate_imei', () => {
  const r = routeIntent('گوشی‌ام گم شد، IMEI: 356938035643809');
  assert.equal(r.kind, 'tool');
  if (r.kind === 'tool') {
    assert.equal(r.tool, 'validate_imei');
    assert.equal(r.args.imei, '356938035643809');
  }
});

test('a Persian-digit IMEI also routes', () => {
  const r = routeIntent('کد ۳۵۶۹۳۸۰۳۵۶۴۳۸۰۹ را بررسی کن');
  assert.equal(r.kind, 'tool');
});

test('«فراموشم کن» clears memory', () => {
  assert.equal(routeIntent('لطفاً فراموشم کن').kind, 'memory-clear');
});

test('a valid national ID with استعلام routes to lookup_registry', () => {
  const r = routeIntent('استعلام کد ملی 0499370899');
  assert.equal(r.kind, 'tool');
  if (r.kind === 'tool') assert.equal(r.tool, 'lookup_registry');
});

test('an invalid national ID does NOT route (asks the user instead)', () => {
  const r = routeIntent('استعلام کد ملی 0499370898');
  assert.notEqual(r.kind === 'tool' ? r.tool : '', 'lookup_registry');
});

test('tag keywords switch the flow', () => {
  const r = routeIntent('قیمت آنی پرو برای کیف چمدان چقدر است؟');
  assert.equal(r.kind, 'flow-switch');
  if (r.kind === 'flow-switch') assert.equal(r.flow, 'smart-tag');
});

test('«پیگیری» routes to status', () => {
  const r = routeIntent('می‌خوام پرونده‌ام را پیگیری کنم');
  assert.equal(r.kind === 'tool' ? r.tool : '', 'get_report_status');
});

test('a bare mobile number is captured for identity binding', () => {
  const r = routeIntent('شماره من ۰۹۱۲۱۲۳۴۵۶۷ است');
  assert.equal(r.kind, 'tool');
  if (r.kind === 'tool') assert.equal(r.tool, '__bind_phone');
});

test('found-item registration is deterministic', () => {
  const r = routeIntent('یک کیف چرمی در پارک لاله پیدا کردم');
  assert.equal(r.kind, 'tool');
  if (r.kind === 'tool') {
    assert.equal(r.tool, 'register_found_item');
    assert.equal(r.args.itemType, 'کیف');
  }
});

test('«کارت ملی پیدا کردم» registers an item instead of a registry lookup', () => {
  const r = routeIntent('کارت ملی پیدا کردم');
  assert.equal(r.kind === 'tool' ? r.tool : '', 'register_found_item');
});

test('a pickup sentence routes to status, not to a new report', () => {
  const r = routeIntent('رسید شیء پیداشده‌ام را می‌خواهم');
  assert.equal(r.kind === 'tool' ? r.tool : '', 'get_report_status');
});

test('ambiguous text routes to none', () => {
  assert.equal(routeIntent('سلام، خوبی؟').kind, 'none');
});
