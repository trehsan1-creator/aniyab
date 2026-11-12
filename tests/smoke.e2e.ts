/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  End-to-end smoke test (Playwright)
 * ─────────────────────────────────────────────────────────────────────────────
 *  Covers the three moments the CEO demo depends on:
 *    B) lost report with a valid IMEI
 *    E) newspaper ad quote
 *    +  returning-customer greeting
 *
 *  Run:
 *    npx playwright install --with-deps chromium
 *    npm run dev            # or: npm run build && npm start
 *    npm run test:e2e
 *
 *  The test is deliberately chat-first (no CSS selectors on internals) so a
 *  restyle never breaks it.
 */

import { test, expect, type Page } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

/** A fresh device id per test, so memory assertions stay isolated. */
function withDevice(page: Page, deviceId: string) {
  return page.addInitScript((id) => {
    window.localStorage.setItem('aniyab:device', id);
  }, deviceId);
}

async function sendMessage(page: Page, text: string) {
  const box = page.getByRole('textbox').first();
  await box.fill(text);
  await box.press('Enter');
}

test.describe('Aniyab assistant', () => {
  test('B — lost report validates an IMEI', async ({ page }) => {
    await withDevice(page, 'e2e-imei');
    await page.goto(BASE);
    await sendMessage(page, 'گوشی‌ام گم شد، IMEI: 356938035643809');

    await expect(page.getByText(/IMEI|چک‌سام/).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/۱۵ رقم/).first()).toBeVisible();
  });

  test('B — an invalid IMEI is rejected in Persian', async ({ page }) => {
    await withDevice(page, 'e2e-bad-imei');
    await page.goto(BASE);
    await sendMessage(page, 'گوشی‌ام گم شد، IMEI: 356938035643808');

    await expect(page.getByText(/معتبر نیست|نادرست|چک‌سام/).first()).toBeVisible({ timeout: 30_000 });
  });

  test('E — newspaper ad produces a quote card', async ({ page }) => {
    await withDevice(page, 'e2e-ad');
    await page.goto(BASE);
    await sendMessage(page, 'برای گوشی گم‌شده‌ام می‌خواهم آگهی روزنامه بدهم');

    await expect(page.getByText(/پیش‌فاکتور/).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/تومان/).first()).toBeVisible();
  });

  test('returning customer sees a greeting and continuity chips', async ({ page }) => {
    const device = 'e2e-returning';
    await withDevice(page, device);

    // First visit: have a conversation, which writes memory.
    await page.goto(BASE);
    await sendMessage(page, 'برای کیف لپ‌تاپ برچسب می‌خواهم');
    await expect(page.getByText(/آنی پرو|آنی پارک/).first()).toBeVisible({ timeout: 30_000 });

    // Second visit: the greeting must acknowledge the return.
    await page.reload();
    await expect(page.getByText(/خوش برگشتی/).first()).toBeVisible({ timeout: 20_000 });
  });

  test('admin dashboard requires a password', async ({ page }) => {
    await page.goto(`${BASE}/admin`);
    await expect(page.getByText(/رمز عبور/).first()).toBeVisible();
  });
});
