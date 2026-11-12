import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  toEnDigits,
  toFaDigits,
  digitsOnly,
  luhnValid,
  validateImei,
  validateNationalId,
  validateIranMobile,
  maskMobile,
  maskImei,
} from '../lib/validators';

test('Persian digits convert to ASCII', () => {
  assert.equal(toEnDigits('۰۱۲۳۴۵۶۷۸۹'), '0123456789');
});

test('ASCII digits convert to Persian', () => {
  assert.equal(toFaDigits('349000'), '۳۴۹۰۰۰');
});

test('digitsOnly strips separators and normalises Persian digits', () => {
  assert.equal(digitsOnly('۳۵۶ ۹۳۸-۰۳۵۶'), '3569380356');
});

test('Luhn accepts a valid IMEI', () => {
  assert.equal(luhnValid('356938035643809'), true);
});

test('Luhn rejects a corrupted IMEI', () => {
  assert.equal(luhnValid('356938035643808'), false);
});

test('validateImei rejects 14 digits with a Persian-length message', () => {
  const r = validateImei('35693803564380');
  assert.equal(r.ok, false);
  assert.match(String(r.messageFa), /۱۵ رقم/);
});

test('validateImei accepts Persian digits', () => {
  const r = validateImei('۳۵۶۹۳۸۰۳۵۶۴۳۸۰۹');
  assert.equal(r.ok, true);
  assert.equal(r.value, '356938035643809');
});

test('validateNationalId accepts a checksum-correct code', () => {
  const r = validateNationalId('0499370899');
  assert.equal(r.ok, true, r.messageFa);
});

test('validateNationalId rejects an all-identical placeholder', () => {
  assert.equal(validateNationalId('1111111111').ok, false);
});

test('validateNationalId rejects a wrong check digit', () => {
  assert.equal(validateNationalId('0499370898').ok, false);
});

test('validateNationalId requires exactly 10 digits', () => {
  const r = validateNationalId('049937089');
  assert.equal(r.ok, false);
  assert.match(String(r.messageFa), /۱۰ رقم/);
});

test('validateIranMobile accepts 09xxxxxxxxx', () => {
  assert.equal(validateIranMobile('09121234567').ok, true);
});

test('validateIranMobile normalises +98', () => {
  assert.equal(validateIranMobile('+989121234567').value, '09121234567');
});

test('validateIranMobile rejects a landline', () => {
  assert.equal(validateIranMobile('02162801000').ok, false);
});

test('maskImei keeps only the first 4 and last 2 digits', () => {
  const masked = maskImei('356938035643809');
  assert.ok(masked.startsWith('۳۵۶۹'));
  assert.ok(masked.endsWith('۰۹'));
  assert.ok(!masked.includes('۳۸۰۳۵۶'));
});

test('maskMobile hides the middle digits', () => {
  assert.equal(maskMobile('09121234567'), '۰۹۱۲***۴۵۶۷');
});
