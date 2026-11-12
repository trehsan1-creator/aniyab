/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  lib/agent/scripted.ts — `?scripted=1` canned turns
 * ─────────────────────────────────────────────────────────────────────────────
 *  Purpose: never let a live demo die because of a network hiccup, an expired
 *  API key or a rate limit. When scripted mode is on, the orchestrator still
 *  runs the real deterministic tools (so the cards are genuine data) but the
 *  narration comes from this file instead of the model.
 *
 *  The copy is deliberately the same voice as the prompt: short, warm, Persian,
 *  no exclamation-mark spam, no fake urgency.
 */

import type { ToolResult } from './tools';

export interface ScriptedReply {
  text: string;
  /** Skip the model entirely. */
  servedBy: 'scripted';
}

/** Lines used before any tool has run (pure conversation). */
export function scriptedChitChat(message: string, flow: string): string {
  const m = message.trim();

  if (/^(سلام|درود|وقت بخیر|صبح بخیر|شب بخیر)/.test(m)) {
    return [
      'سلام! من دستیار آنی‌یاب هستم.',
      'دو کار بیشتر از همه انجام می‌دهم: انتخاب برچسب هوشمند مناسب، و پیگیری وسایل گم‌شده یا پیدا‌شده.',
      'از کدام یکی شروع کنیم؟',
    ].join('\n');
  }

  if (/فراموشم کن|پاک کن|حافظه/.test(m)) {
    return 'حتماً. همهٔ چیزهایی که درباره‌ات یادم مانده پاک می‌شود؛ از این به بعد از صفر شروع می‌کنیم.';
  }

  if (/قیمت|هزینه|چند/.test(m)) {
    return [
      'آنی پارک ۳۴۹٬۰۰۰ تومان است (برای خودرو و پارکینگ) و آنی پرو ۶۹۴٬۰۰۰ تومان (برای وسایل همراه).',
      'هر دو یک‌بار خریداری می‌شوند و اشتراک ماهانه ندارند.',
    ].join('\n');
  }

  if (flow === 'lost-report') {
    return [
      'برای ثبت مفقودی سه چیز لازم است: نوع شیء، جایی که آخرین بار دیدی، و اگر گوشی است کد IMEI.',
      'کد IMEI با شماره‌گیری *#06# روی صفحهٔ گوشی می‌آید.',
    ].join('\n');
  }

  if (flow === 'found-report') {
    return [
      'خوب کردی که می‌خواهی ثبتش کنی. فقط توضیح عمومی را طوری بنویس که صاحب واقعی بتواند اثبات کند مال اوست — نشانه‌های دقیق را خصوصی نگه می‌داریم.',
    ].join('\n');
  }

  return [
    'بگو دنبال چه چیزی هستی — برچسب برای یک وسیله، یا پیگیری یک پروندهٔ گم‌شده؟',
  ].join('\n');
}

/** Narration after a tool produced cards: grounded in the real result. */
export function scriptedAfterTool(results: ToolResult[]): string {
  const last = [...results].reverse()[0];
  if (!last) return scriptedChitChat('', 'general');

  if (!last.ok) {
    return [
      last.summaryFa,
      '',
      'اگر داده‌ها را دوباره چک کردی و درست بود، بگو تا مسیر دیگری امتحان کنیم. پشتیبانی هم شبانه‌روزی روی ۰۲۱-۶۲۸۰۱ هست.',
    ].join('\n');
  }

  const cards = new Set((last.ui ?? []).map((u) => u.card));

  if (cards.has('ProductComparisonCard')) {
    return [
      last.summaryFa,
      '',
      'هر دو گزینه یک‌بار خریده می‌شوند و هزینهٔ اشتراک ندارند. اگر بگویی بیشتر کجا استفاده می‌کنی، بین این دو یکی را با اطمینان انتخاب می‌کنیم.',
    ].join('\n');
  }

  if (cards.has('ReportTicketCard')) {
    return [
      last.summaryFa,
      '',
      'کد پیگیری را جایی نگه دار. هر وقت خواستی، همین‌جا بنویس «پیگیری» تا وضعیت را بگویم.',
    ].join('\n');
  }

  if (cards.has('LookupResultCard')) {
    return [
      last.summaryFa,
      '',
      'برای تحویل، کارت ملی و مدرک مالکیت را همراه داشته باش. آدرس دفتر و شمارهٔ تماس در کارت بالا آمده است.',
    ].join('\n');
  }

  if (cards.has('ReceiptCard')) {
    return [
      last.summaryFa,
      '',
      'رسید و کد رهگیری را نگه دار. اگر صاحب شیء پیدا شد، از همین کد می‌توانی بدون نمایش شماره‌ات با او هماهنگ کنی.',
    ].join('\n');
  }

  if (cards.has('NewspaperQuoteCard')) {
    return [
      last.summaryFa,
      '',
      'این پیش‌فاکتور چیزی از حساب تو کم نمی‌کند؛ فقط با تأیید تو آگهی ثبت می‌شود.',
    ].join('\n');
  }

  if (cards.has('PostShipmentCard')) {
    return [
      last.summaryFa,
      '',
      'کد پستی را تا ۲۴ ساعت آینده پیامک می‌کنیم. اگر شیء ارزشمند است، تحویل حضوری در دفتر هم ممکن است.',
    ].join('\n');
  }

  return last.summaryFa;
}
