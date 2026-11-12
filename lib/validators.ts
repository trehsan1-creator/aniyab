/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  lib/validators.ts — pure, dependency-free validators (unit tested)
 * ─────────────────────────────────────────────────────────────────────────────
 *  Everything here is deterministic and safe to run on the client or server.
 */

const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
const AR_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

/** Converts Persian/Arabic-Indic digits to ASCII. Keeps every other char. */
export function toEnDigits(input: string): string {
  return input
    .replace(/[۰-۹]/g, (d) => String(Math.max(0, FA_DIGITS.indexOf(d))))
    .replace(/[٠-٩]/g, (d) => String(Math.max(0, AR_DIGITS.indexOf(d))));
}

/** Converts ASCII digits to Persian digits. */
export function toFaDigits(input: string | number): string {
  return String(input).replace(/\d/g, (d) => FA_DIGITS[Number(d)] ?? d);
}

/** Strips everything except ASCII digits (after normalising Persian digits). */
export function digitsOnly(input: string): string {
  return toEnDigits(input).replace(/\D/g, '');
}

export interface ValidationResult {
  ok: boolean;
  /** Persian message for humans; undefined when valid. */
  messageFa?: string;
  /** Normalised value (digits only) when useful. */
  value?: string;
}

/**
 * Luhn checksum — used by IMEI (15 digits, last digit is the check digit).
 */
export function luhnValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = Number(digits[i]);
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

/** IMEI must be exactly 15 digits and pass Luhn. */
export function validateImei(raw: string): ValidationResult {
  const digits = digitsOnly(raw);
  if (!digits) return { ok: false, messageFa: 'کد IMEI را وارد کنید.' };
  if (digits.length !== 15) {
    return {
      ok: false,
      messageFa: `کد IMEI باید دقیقاً ۱۵ رقم باشد؛ شما ${toFaDigits(digits.length)} رقم وارد کردید.`,
    };
  }
  if (!luhnValid(digits)) {
    return {
      ok: false,
      messageFa: 'این کد IMEI معتبر نیست. با شماره‌گیری ‎*#۰۶#‎ دوباره بررسی کنید.',
    };
  }
  return { ok: true, value: digits };
}

/**
 * Iranian national ID (کد ملی) checksum.
 * 10 digits; the 10th digit is a check digit computed from the first 9.
 */
export function validateNationalId(raw: string): ValidationResult {
  const digits = digitsOnly(raw);
  if (!digits) return { ok: false, messageFa: 'کد ملی را وارد کنید.' };
  if (digits.length !== 10) {
    return {
      ok: false,
      messageFa: `کد ملی باید ۱۰ رقم باشد؛ شما ${toFaDigits(digits.length)} رقم وارد کردید.`,
    };
  }
  // Obvious placeholders are never valid.
  if (/^(\d)\1{9}$/.test(digits)) {
    return { ok: false, messageFa: 'این کد ملی معتبر نیست. لطفاً کد واقعی خودتان را وارد کنید.' };
  }

  const check = Number(digits[9]);
  let sum = 0;
  for (let i = 0; i < 9; i += 1) sum += Number(digits[i]) * (10 - i);
  const remainder = sum % 11;

  const valid = remainder < 2 ? check === remainder : check === 11 - remainder;
  if (!valid) {
    return { ok: false, messageFa: 'کد ملی وارد شده معتبر نیست. لطفاً دوباره بررسی کنید.' };
  }
  return { ok: true, value: digits };
}

/** Iranian mobile: 09xxxxxxxxx (11 digits) or +989xxxxxxxxx. */
export function validateIranMobile(raw: string): ValidationResult {
  const digits = digitsOnly(raw).replace(/^0098/, '0').replace(/^98(?=9)/, '0');
  if (!digits) return { ok: false, messageFa: 'شماره موبایل را وارد کنید.' };
  if (!/^09\d{9}$/.test(digits)) {
    return { ok: false, messageFa: 'شماره موبایل باید با ۰۹ شروع شود و ۱۱ رقم باشد.' };
  }
  return { ok: true, value: digits };
}

/** Masks a mobile for display: 09121234567 → 0912***4567 */
export function maskMobile(digits: string): string {
  if (digits.length < 8) return toFaDigits(digits);
  return `${toFaDigits(digits.slice(0, 4))}***${toFaDigits(digits.slice(-4))}`;
}

/** Masks an IMEI: keeps first 4 and last 2. */
export function maskImei(digits: string): string {
  if (digits.length < 7) return toFaDigits(digits);
  return `${toFaDigits(digits.slice(0, 4))}${'*'.repeat(digits.length - 6)}${toFaDigits(digits.slice(-2))}`;
}

/** Masks a national ID completely except length. */
export function maskNationalId(digits: string): string {
  return toFaDigits('*'.repeat(Math.max(0, digits.length - 2)) + digits.slice(-2));
}
