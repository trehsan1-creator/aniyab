/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  lib/agent/router.ts — deterministic intent & slot router
 * ─────────────────────────────────────────────────────────────────────────────
 *  Why this exists: a CEO demo must never depend on the model deciding to call a
 *  tool. This router catches the unambiguous cases (a validated IMEI in the
 *  text, a national ID, "follow up my case", "forget me") and pre-executes the
 *  matching tool, so behaviour is identical regardless of model quality.
 *
 *  It is intentionally conservative: anything ambiguous is left to the model.
 */

import { digitsOnly, toEnDigits, validateImei, validateNationalId, validateIranMobile } from '@/lib/validators';

export type RoutedIntent =
  | { kind: 'tool'; tool: string; args: Record<string, unknown>; reasonFa: string }
  | { kind: 'memory-clear'; reasonFa: string }
  | { kind: 'flow-switch'; flow: 'smart-tag' | 'lost-report' | 'found-report' | 'general'; reasonFa: string }
  | { kind: 'none' };

const FA_NORMALISE = (t: string) => t.replace(/\u064A/g, 'ی').replace(/\u0643/g, 'ک');

/**
 * Looks at the latest user utterance and returns a deterministic action.
 * Never returns a customer id — the server binds identity separately.
 */
export function routeIntent(rawText: string, opts?: { lastAssistantAskedImei?: boolean }): RoutedIntent {
  const text = FA_NORMALISE(rawText ?? '').trim();
  if (!text) return { kind: 'none' };

  /* ── memory controls ───────────────────────────────────────────────────── */
  if (/(فراموشم کن|فراموش کن|حافظه‌?ام را پاک|همه چیز را پاک|همه‌چیز را پاک)/.test(text)) {
    return { kind: 'memory-clear', reasonFa: 'درخواست پاک کردن حافظه' };
  }

  /* ── a 15-digit number is an IMEI, full stop ───────────────────────────── */
  const longDigits = digitsOnly(text);
  const imeiCandidates = text.match(/\d{15}/g) ?? (longDigits.length === 15 ? [longDigits] : null);
  if (imeiCandidates?.length) {
    const imei = imeiCandidates[0];
    return {
      kind: 'tool',
      tool: 'validate_imei',
      args: { imei },
      reasonFa: 'کد ۱۵ رقمی در متن پیدا شد (IMEI)',
    };
  }
  // Persian-digit IMEI: ۱۵ رقم
  const faImei = /[۰-۹]{15}/.exec(text)?.[0];
  if (faImei) {
    return { kind: 'tool', tool: 'validate_imei', args: { imei: faImei }, reasonFa: 'کد IMEI فارسی پیدا شد' };
  }

  /* ── national-ID lookup ────────────────────────────────────────────────── */
  if (/(استعلام|کد ملی)/.test(text)) {
    const ten = /\b\d{10}\b/.exec(text)?.[0] ?? /[۰-۹]{10}/.exec(text)?.[0];
    if (ten && validateNationalId(ten).ok) {
      return { kind: 'tool', tool: 'lookup_registry', args: { nationalId: ten }, reasonFa: 'کد ملی معتبر در متن' };
    }
  }

  /* ── status follow-up ──────────────────────────────────────────────────── */
  if (
    /(پیگیری|وضعیت|کد رهگیری|رهگیری|رسید|پرونده|تیکت|چی شد)/.test(text) &&
    !/(گم شد|مفقود|پیدا کردم|پیدا شده|یافتم)/.test(text)
  ) {
    return { kind: 'tool', tool: 'get_report_status', args: {}, reasonFa: 'درخواست پیگیری وضعیت' };
  }

  /* ── found-item registration ───────────────────────────────────────────── */
  // Deterministic so the receipt + secure-call cards always appear, even if the
  // model is having a bad day. Public copy is intentionally vague; the private
  // description is never shown on the public report page.
  if (/(پیدا کردم|پیداشده|پیدا شده|یافتم|تحویل بدم|تحویل بدهم)/.test(text)) {
    const itemType = /کیف/.test(text)
      ? 'کیف'
      : /گوشی|موبایل/.test(text)
        ? 'گوشی موبایل'
        : /کارت ملی/.test(text)
          ? 'کارت ملی'
          : /کارت بانکی|بانک/.test(text)
            ? 'کارت بانکی'
            : /کلید/.test(text)
              ? 'کلید'
              : /عینک/.test(text)
                ? 'عینک'
                : /گذرنامه/.test(text)
                  ? 'گذرنامه'
                  : 'شیء پیداشده';
    const serial = /\b[A-Z]{2,5}-?\d{3,}[A-Z0-9-]*\b/.exec(toEnDigits(text))?.[0] ?? null;
    return {
      kind: 'tool',
      tool: 'register_found_item',
      args: {
        itemType,
        identifierKind: serial ? 'serial' : 'qr',
        identifier: serial ?? `QR-${Date.now().toString(36).toUpperCase().slice(-6)}`,
        descriptionPublic: `${itemType} پیدا شد و به دفتر آنی‌یاب تحویل داده شد. برای دریافت، کد رهگیری را ارائه دهید.`,
        area: 'تهران',
      },
      reasonFa: 'درخواست ثبت شیء پیداشده',
    };
  }

  /* ── flow switches ─────────────────────────────────────────────────────── */
  if (/(برچسب|آنی پارک|آنی پرو|خرید|قیمت|لپ\s*تاپ|کیف)/.test(text)) {
    return { kind: 'flow-switch', flow: 'smart-tag', reasonFa: 'موضوع خرید برچسب' };
  }
  if (/(گم شد|مفقود|دزدیده|گوشی‌ام را|گوشیم را)/.test(text)) {
    return { kind: 'flow-switch', flow: 'lost-report', reasonFa: 'موضوع مفقودی' };
  }
  if (/(پیدا کردم|پیداشده|پیدا شده|یافتم)/.test(text)) {
    return { kind: 'flow-switch', flow: 'found-report', reasonFa: 'موضوع شیء پیداشده' };
  }

  /* ── a bare mobile number (identity collection) ─────────────────────────── */
  // Mobile detection must work on Persian digits too (the common case in RTL UI).
  // Normalise first, then match: one regex covers ASCII and Persian input.
  const asciiText = toEnDigits(text);
  const phoneCandidate =
    asciiText.match(/(?:\+98|0098|0)?9\d{9}/)?.[0] ??
    (/^\d{10}$/.test(digitsOnly(asciiText)) ? digitsOnly(asciiText) : null);
  const phone = phoneCandidate ? digitsOnly(phoneCandidate) : null;
  if (phone && validateIranMobile(phone).ok) {
    return { kind: 'tool', tool: '__bind_phone', args: { phone }, reasonFa: 'شماره موبایل در متن' };
  }

  return { kind: 'none' };
}

/** Quick, non-authoritative flow guess used to keep the UI rail in sync. */
export function guessFlow(text: string): 'smart-tag' | 'lost-report' | 'found-report' | 'general' {
  const r = routeIntent(text);
  if (r.kind === 'flow-switch') return r.flow;
  if (r.kind === 'tool' && r.tool === 'lookup_registry') return 'general';
  return 'general';
}
