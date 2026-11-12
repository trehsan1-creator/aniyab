/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  lib/agent/tools.ts — tool registry (zod-validated, server-executed)
 * ─────────────────────────────────────────────────────────────────────────────
 *  Design rules:
 *   • The model NEVER supplies customer_id / conversation_id — the server binds
 *     them from the session (see executeTool's ToolContext).
 *   • Every argument is parsed with zod; unknown keys are stripped.
 *   • Every tool returns `{ ok, data?, error?, ui?, memory? }` so the agent loop
 *     can narrate truthfully ("ثبت شد" only when ok === true).
 *   • There is deliberately NO create_order / cart / payment tool.
 */

import { z } from 'zod';

import { getProduct, PRODUCTS } from '@/content/catalog';
import { OBJECTIONS, matchObjection } from '@/content/objections.fa';
import {
  createFoundReport,
  createLostReport,
  createNewspaperAd,
  createPostShipment,
  createSecureCall,
  latestConsultation,
  listLostReports,
  logEvent,
  lookupRegistry,
  trackingCode,
  upsertConsultation,
  upsertMemory,
} from '@/lib/db/store';
import { buildAdText, DOC_TYPES, NEWSPAPERS, AD_SIZES, quoteNewspaperAd, jalaliDate } from '@/lib/pricing';
import { validateImei, validateNationalId, maskImei } from '@/lib/validators';

/* ── context bound by the server, never by the model ───────────────────────── */

export interface ToolContext {
  customerId: string;
  conversationId: string;
  flow: string;
}

/* ── result envelope ───────────────────────────────────────────────────────── */

export interface UiCard {
  card: string;
  props: Record<string, unknown>;
}

export interface ToolResult {
  ok: boolean;
  /** Short Persian sentence the model can adapt when narrating. */
  summaryFa: string;
  data?: Record<string, unknown>;
  ui?: UiCard[];
  error?: string;
  /** Facts worth remembering, written by the memory engine. */
  memory?: Array<{ kind: 'fact' | 'preference' | 'item' | 'event' | 'concern'; key: string; value: string; confidence?: number }>;
}

/* ── schemas ───────────────────────────────────────────────────────────────── */

const imeiSchema = z
  .object({ imei: z.string().min(1).max(32) })
  .strict();

const recommendSchema = z
  .object({
    objectType: z.string().min(1).max(120),
    recommendedProduct: z.enum(['ani-park', 'ani-pro']),
    reasonFa: z.string().min(1).max(400),
    budgetHint: z.string().max(60).optional(),
    objections: z.array(z.string().max(60)).max(8).optional(),
    stage: z.enum(['discovery', 'recommended', 'objection', 'cta_shown']).optional(),
  })
  .strict();

const lostReportSchema = z
  .object({
    itemType: z.string().min(1).max(80),
    imei: z.string().max(32).optional(),
    brandModel: z.string().max(80).optional(),
    lastSeenPlace: z.string().max(160).optional(),
    lastSeenAt: z.string().max(80).optional(),
  })
  .strict();

const reportStatusSchema = z.object({ trackingCode: z.string().max(32).optional() }).strict();

const nationalIdSchema = z.object({ nationalId: z.string().min(1).max(20) }).strict();

const foundItemSchema = z
  .object({
    itemType: z.string().min(1).max(80),
    identifierKind: z.enum(['qr', 'serial']),
    identifier: z.string().min(1).max(120),
    descriptionPublic: z.string().min(3).max(400),
    descriptionPrivate: z.string().max(400).optional(),
    area: z.string().max(120).optional(),
  })
  .strict();

const secureCallSchema = z.object({ foundReportId: z.string().uuid().optional() }).strict();

const newspaperSchema = z
  .object({
    docType: z.enum(DOC_TYPES.map((d) => d.id) as [string, ...string[]]),
    newspaper: z.enum(NEWSPAPERS.map((n) => n.id) as [string, ...string[]]),
    size: z.enum(AD_SIZES.map((s) => s.id) as [string, ...string[]]).optional(),
    days: z.number().int().min(1).max(7).optional(),
    highlighted: z.boolean().optional(),
    publishDate: z.string().max(40).optional(),
    itemName: z.string().max(160).optional(),
    place: z.string().max(120).optional(),
  })
  .strict();

const postSchema = z.object({ lostReportId: z.string().uuid().optional() }).strict();

const objectionSchema = z.object({ topic: z.string().min(1).max(60) }).strict();

/* ── tool definitions (OpenAI tool-calling schema) ─────────────────────────── */

export interface ToolDefinition {
  name: string;
  labelFa: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: unknown, ctx: ToolContext) => Promise<ToolResult>;
}

const obj = (
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> => ({ type: 'object', properties, required, additionalProperties: false });

export const TOOLS: ToolDefinition[] = [
  /* ── Flow A: consultation ──────────────────────────────────────────────── */
  {
    name: 'recommend_product',
    labelFa: 'انتخاب محصول پیشنهادی',
    description:
      'Records the consultation outcome and shows a side-by-side product comparison card. Call once, after you have asked enough discovery questions. Never takes an order.',
    parameters: obj(
      {
        objectType: { type: 'string', description: 'What the tag will protect, in Persian (e.g. کیف لپ‌تاپ).' },
        recommendedProduct: { type: 'string', enum: ['ani-park', 'ani-pro'] },
        reasonFa: {
          type: 'string',
          description: 'One Persian sentence tying the recommendation to what the customer said.',
        },
        budgetHint: { type: 'string', description: 'e.g. «حساس به قیمت» or «بودجه باز».' },
        objections: {
          type: 'array',
          items: { type: 'string' },
          description: 'Objection ids raised so far, e.g. ["price","privacy"].',
        },
        stage: { type: 'string', enum: ['discovery', 'recommended', 'objection', 'cta_shown'] },
      },
      ['objectType', 'recommendedProduct', 'reasonFa'],
    ),
    async execute(raw, ctx) {
      const parsed = recommendSchema.safeParse(raw);
      if (!parsed.success) return invalid('recommend_product', parsed.error.issues[0]?.message);

      const product = getProduct(parsed.data.recommendedProduct);
      if (!product) return { ok: false, summaryFa: 'محصول انتخابی نامعتبر است.', error: 'unknown_product' };

      await upsertConsultation({
        customerId: ctx.customerId,
        conversationId: ctx.conversationId,
        objectType: parsed.data.objectType,
        budgetHint: parsed.data.budgetHint ?? null,
        recommendedProduct: product.id,
        objections: parsed.data.objections,
        stage: parsed.data.stage ?? 'recommended',
      });
      await logEvent({
        customerId: ctx.customerId,
        type: 'consultation.recommended',
        payload: { product: product.id, objectType: parsed.data.objectType },
      });

      return {
        ok: true,
        summaryFa: `محصول پیشنهادی ${product.nameFa} (${product.priceFa}) ثبت شد؛ کارت مقایسه نمایش داده شد.`,
        data: {
          productId: product.id,
          productNameFa: product.nameFa,
          priceFa: product.priceFa,
          shopUrl: process.env.NEXT_PUBLIC_SHOP_URL?.trim() || 'https://aniyab.com',
        },
        ui: [
          {
            card: 'ProductComparisonCard',
            props: {
              recommended: product.id,
              reasonFa: parsed.data.reasonFa,
              objectType: parsed.data.objectType,
              products: PRODUCTS.map((p) => ({
                id: p.id,
                nameFa: p.nameFa,
                subtitleFa: p.subtitleFa,
                priceFa: p.priceFa,
                featuresFa: p.featuresFa,
                bestForFa: p.bestForFa,
                badgeFa: p.badgeFa,
                accent: p.accent,
              })),
            },
          },
        ],
        memory: [
          { kind: 'item', key: 'object_of_interest', value: parsed.data.objectType, confidence: 0.8 },
          {
            kind: 'preference',
            key: 'product_interest',
            value: product.nameFa,
            confidence: 0.75,
          },
        ],
      };
    },
  },

  /* ── Flow B: IMEI + lost report ────────────────────────────────────────── */
  {
    name: 'validate_imei',
    labelFa: 'بررسی کد IMEI',
    description:
      'Validates a 15-digit IMEI (length + Luhn checksum). Returns valid/invalid and a Persian reason. Use before creating a lost report.',
    parameters: obj({ imei: { type: 'string', description: 'The IMEI the customer typed, digits only or mixed.' } }, ['imei']),
    async execute(raw) {
      const parsed = imeiSchema.safeParse(raw);
      if (!parsed.success) return invalid('validate_imei', parsed.error.issues[0]?.message);

      const result = validateImei(parsed.data.imei);
      if (!result.ok) {
        return {
          ok: false,
          summaryFa: result.messageFa ?? 'کد IMEI معتبر نیست.',
          error: 'invalid_imei',
          data: { valid: false },
        };
      }
      return {
        ok: true,
        summaryFa: 'کد IMEI معتبر است (۱۵ رقم و چک‌سام درست).',
        data: { valid: true, maskedImei: maskImei(result.value!) },
      };
    },
  },
  {
    name: 'create_lost_report',
    labelFa: 'ثبت اعلام مفقودی',
    description:
      'Creates a simulated lost report and a tracking code (AN-L-…). Only call when you have at least the item type; IMEI is optional but must be valid if given.',
    parameters: obj(
      {
        itemType: { type: 'string' },
        imei: { type: 'string' },
        brandModel: { type: 'string' },
        lastSeenPlace: { type: 'string' },
        lastSeenAt: { type: 'string', description: 'Free text, e.g. «دیشب حدود ۹» — converted to a Jalali label.' },
      },
      ['itemType'],
    ),
    async execute(raw, ctx) {
      const parsed = lostReportSchema.safeParse(raw);
      if (!parsed.success) return invalid('create_lost_report', parsed.error.issues[0]?.message);

      let imei: string | null = null;
      if (parsed.data.imei) {
        const check = validateImei(parsed.data.imei);
        if (!check.ok) {
          return { ok: false, summaryFa: check.messageFa ?? 'کد IMEI معتبر نیست.', error: 'invalid_imei' };
        }
        imei = check.value!;
      }

      const report = await createLostReport({
        customerId: ctx.customerId,
        itemType: parsed.data.itemType,
        imei,
        brandModel: parsed.data.brandModel ?? null,
        lastSeenPlace: parsed.data.lastSeenPlace ?? null,
        lastSeenAt: parsed.data.lastSeenAt ?? null,
      });

      await logEvent({
        customerId: ctx.customerId,
        type: 'lost_report.created',
        payload: { trackingCode: report.tracking_code, itemType: report.item_type },
      });

      return {
        ok: true,
        summaryFa: `اعلام مفقودی با کد پیگیری ${report.tracking_code} ثبت شد.`,
        data: { trackingCode: report.tracking_code, itemType: report.item_type, status: report.status },
        ui: [
          {
            card: 'ReportTicketCard',
            props: {
              trackingCode: report.tracking_code,
              itemType: report.item_type,
              createdAt: report.created_at,
              status: report.status,
              imeiMasked: imei ? maskImei(imei) : null,
            },
          },
        ],
        memory: [
          { kind: 'event', key: 'last_lost_report', value: `${report.item_type} — ${report.tracking_code}`, confidence: 0.9 },
          ...(parsed.data.lastSeenPlace
            ? [{ kind: 'fact' as const, key: 'last_seen_place', value: parsed.data.lastSeenPlace, confidence: 0.6 }]
            : []),
        ],
      };
    },
  },
  {
    name: 'get_report_status',
    labelFa: 'پیگیری وضعیت پرونده',
    description: 'Returns the status timeline of the customer\'s most recent lost report (or a specific tracking code).',
    parameters: obj({ trackingCode: { type: 'string' } }),
    async execute(raw, ctx) {
      const parsed = reportStatusSchema.safeParse(raw);
      if (!parsed.success) return invalid('get_report_status', parsed.error.issues[0]?.message);

      const reports = await listLostReports(ctx.customerId);
      const wanted = parsed.data.trackingCode?.trim().toUpperCase();
      const match = wanted ? reports.find((r) => r.tracking_code === wanted) : reports[0];

      if (!match) {
        return { ok: false, summaryFa: 'پرونده‌ای برای این حساب پیدا نشد.', error: 'not_found' };
      }
      return {
        ok: true,
        summaryFa: `آخرین وضعیت پرونده ${match.tracking_code} ارسال شد.`,
        data: { trackingCode: match.tracking_code, status: match.status },
        ui: [
          {
            card: 'ReportTicketCard',
            props: {
              trackingCode: match.tracking_code,
              itemType: match.item_type,
              createdAt: match.created_at,
              status: match.status,
              imeiMasked: match.imei ? maskImei(match.imei) : null,
            },
          },
        ],
      };
    },
  },

  /* ── Flow C: national-ID lookup ────────────────────────────────────────── */
  {
    name: 'lookup_registry',
    labelFa: 'استعلام دفتر یافته‌ها',
    description:
      'Looks up found documents held at Aniyab offices by national ID (validated with the real Iranian checksum; only a hash is stored). Returns masked matches.',
    parameters: obj({ nationalId: { type: 'string', description: '10-digit Iranian national ID.' } }, ['nationalId']),
    async execute(raw, ctx) {
      const parsed = nationalIdSchema.safeParse(raw);
      if (!parsed.success) return invalid('lookup_registry', parsed.error.issues[0]?.message);

      const check = validateNationalId(parsed.data.nationalId);
      if (!check.ok) {
        return { ok: false, summaryFa: check.messageFa ?? 'کد ملی معتبر نیست.', error: 'invalid_national_id' };
      }

      const { hashNationalId } = await import('@/lib/crypto');
      const hash = await hashNationalId(check.value!);
      const entries = await lookupRegistry(hash);

      await logEvent({
        customerId: ctx.customerId,
        type: 'registry.lookup',
        payload: { matches: entries.length },
      });

      if (entries.length === 0) {
        return {
          ok: true,
          summaryFa: 'موردی با این کد ملی در دفاتر یافته‌ها نیست.',
          data: { matches: 0 },
          ui: [{ card: 'LookupResultCard', props: { matches: [], empty: true } }],
        };
      }

      return {
        ok: true,
        summaryFa: `${entries.length} مورد یافته‌شده مرتبط پیدا شد.`,
        data: { matches: entries.length },
        ui: [
          {
            card: 'LookupResultCard',
            props: {
              empty: false,
              matches: entries.map((e) => ({
                id: e.id,
                itemType: e.item_type,
                descriptionMasked: e.description_masked,
                heldAt: e.held_at,
                receivedAt: e.received_at,
                receivedAtFa: jalaliDate(e.received_at),
                status: e.status,
              })),
            },
          },
        ],
      };
    },
  },

  /* ── Flow D: found item + secure call ──────────────────────────────────── */
  {
    name: 'register_found_item',
    labelFa: 'ثبت شیء پیداشده',
    description:
      'Registers a found item (QR or serial), issues a tracking code (AN-F-…) and returns a receipt with a QR image.',
    parameters: obj(
      {
        itemType: { type: 'string' },
        identifierKind: { type: 'string', enum: ['qr', 'serial'] },
        identifier: { type: 'string' },
        descriptionPublic: { type: 'string', description: 'Safe for public display. No personal data.' },
        descriptionPrivate: {
          type: 'string',
          description: 'Identifying marks only the true owner could know. Never shown publicly.',
        },
        area: { type: 'string' },
      },
      ['itemType', 'identifierKind', 'identifier', 'descriptionPublic'],
    ),
    async execute(raw, ctx) {
      const parsed = foundItemSchema.safeParse(raw);
      if (!parsed.success) return invalid('register_found_item', parsed.error.issues[0]?.message);

      const report = await createFoundReport({
        customerId: ctx.customerId,
        itemType: parsed.data.itemType,
        identifierKind: parsed.data.identifierKind,
        identifier: parsed.data.identifier,
        descriptionPublic: parsed.data.descriptionPublic,
        descriptionPrivate: parsed.data.descriptionPrivate ?? null,
        area: parsed.data.area ?? null,
      });

      await logEvent({
        customerId: ctx.customerId,
        type: 'found_report.created',
        payload: { trackingCode: report.tracking_code, itemType: report.item_type },
      });

      return {
        ok: true,
        summaryFa: `شیء پیداشده با کد ${report.tracking_code} ثبت شد.`,
        data: { trackingCode: report.tracking_code, foundReportId: report.id },
        ui: [
          {
            card: 'ReceiptCard',
            props: {
              trackingCode: report.tracking_code,
              itemType: report.item_type,
              area: report.area,
              createdAt: report.created_at,
              url: `/f/${report.tracking_code}`,
            },
          },
          { card: 'SecureCallCard', props: { foundReportId: report.id, minutes: 15 } },
        ],
      };
    },
  },
  {
    name: 'open_secure_call',
    labelFa: 'ساخت شماره تماس امن',
    description:
      'Creates a temporary relay phone number (15 minutes) so owner and finder never see each other real numbers.',
    parameters: obj({ foundReportId: { type: 'string' } }),
    async execute(raw, ctx) {
      const parsed = secureCallSchema.safeParse(raw);
      if (!parsed.success) return invalid('open_secure_call', parsed.error.issues[0]?.message);
      if (!parsed.data.foundReportId) {
        return { ok: false, summaryFa: 'برای ساخت تماس امن ابتدا باید شیء پیداشده ثبت شود.', error: 'missing_report' };
      }
      const call = await createSecureCall(parsed.data.foundReportId);
      await logEvent({ customerId: ctx.customerId, type: 'secure_call.created', payload: { id: call.id } });
      return {
        ok: true,
        summaryFa: 'شماره واسط موقت ساخته شد؛ ۱۵ دقیقه اعتبار دارد.',
        data: { relayNumber: call.relay_number, expiresAt: call.expires_at },
        ui: [
          {
            card: 'SecureCallCard',
            props: { foundReportId: parsed.data.foundReportId, relayNumber: call.relay_number, expiresAt: call.expires_at, minutes: 15 },
          },
        ],
      };
    },
  },

  /* ── Flow E: پست یافته + روزنامه ───────────────────────────────────────── */
  {
    name: 'request_found_post',
    labelFa: 'درخواست پست یافته',
    description: 'Creates a simulated pickup/delivery request for a verified owner.',
    parameters: obj({ lostReportId: { type: 'string' } }),
    async execute(raw, ctx) {
      const parsed = postSchema.safeParse(raw);
      if (!parsed.success) return invalid('request_found_post', parsed.error.issues[0]?.message);

      const shipment = await createPostShipment({
        customerId: ctx.customerId,
        lostReportId: parsed.data.lostReportId ?? null,
      });
      await logEvent({ customerId: ctx.customerId, type: 'post.requested', payload: { code: shipment.tracking_code } });

      return {
        ok: true,
        summaryFa: `درخواست پست یافته با کد ${shipment.tracking_code} ثبت شد.`,
        data: { trackingCode: shipment.tracking_code },
        ui: [
          {
            card: 'PostShipmentCard',
            props: { trackingCode: shipment.tracking_code, status: shipment.status, createdAt: shipment.created_at },
          },
        ],
      };
    },
  },
  {
    name: 'quote_newspaper_ad',
    labelFa: 'پیش‌فاکتور آگهی روزنامه',
    description:
      'Computes a deterministic price quote for a lost-item newspaper ad and returns a preview of the ad text. Never charges anything.',
    parameters: obj(
      {
        docType: { type: 'string', enum: DOC_TYPES.map((d) => d.id) },
        newspaper: { type: 'string', enum: NEWSPAPERS.map((n) => n.id) },
        size: { type: 'string', enum: AD_SIZES.map((s) => s.id) },
        days: { type: 'integer', minimum: 1, maximum: 7 },
        highlighted: { type: 'boolean' },
        publishDate: { type: 'string' },
        itemName: { type: 'string' },
        place: { type: 'string' },
      },
      ['docType', 'newspaper'],
    ),
    async execute(raw, ctx) {
      const parsed = newspaperSchema.safeParse(raw);
      if (!parsed.success) return invalid('quote_newspaper_ad', parsed.error.issues[0]?.message);

      const quote = quoteNewspaperAd({
        newspaperId: parsed.data.newspaper as never,
        docTypeId: parsed.data.docType as never,
        sizeId: (parsed.data.size ?? 'small') as never,
        days: parsed.data.days ?? 1,
        highlighted: parsed.data.highlighted ?? false,
      });

      const doc = DOC_TYPES.find((d) => d.id === parsed.data.docType);
      const adText = buildAdText({
        docTypeId: parsed.data.docType as never,
        itemName: parsed.data.itemName ?? `${doc?.nameFa ?? 'مدارک'} گم‌شده`,
        placeFa: parsed.data.place ?? 'نامشخص',
      });

      const publishDate = parsed.data.publishDate ?? new Date().toISOString();
      const ad = await createNewspaperAd({
        customerId: ctx.customerId,
        docType: parsed.data.docType,
        newspaper: parsed.data.newspaper,
        publishDate,
        priceBreakdown: quote,
        adText,
      });

      await logEvent({ customerId: ctx.customerId, type: 'newspaper.quoted', payload: { code: ad.tracking_code } });

      return {
        ok: true,
        summaryFa: `پیش‌فاکتور آگهی ${ad.tracking_code} صادر شد؛ مبلغ ${quote.totalFa}.`,
        data: { trackingCode: ad.tracking_code, totalFa: quote.totalFa },
        ui: [
          {
            card: 'NewspaperQuoteCard',
            props: {
              trackingCode: ad.tracking_code,
              totalFa: quote.totalFa,
              lines: quote.lines,
              explainFa: quote.explainFa,
              adText,
              publishDateFa: jalaliDate(publishDate),
              newspaperFa: NEWSPAPERS.find((n) => n.id === parsed.data.newspaper)?.nameFa ?? '',
            },
          },
        ],
      };
    },
  },

  /* ── memory / preferences ──────────────────────────────────────────────── */
  {
    name: 'remember_customer_fact',
    labelFa: 'به‌خاطر سپردن',
    description:
      'Stores one durable fact about the customer (name, city, item, preference). Use sparingly, only for things they would expect you to remember.',
    parameters: obj(
      {
        kind: { type: 'string', enum: ['fact', 'preference', 'item', 'event', 'concern'] },
        key: { type: 'string' },
        value: { type: 'string' },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
      },
      ['kind', 'key', 'value'],
    ),
    async execute(raw, ctx) {
      const schema = z
        .object({
          kind: z.enum(['fact', 'preference', 'item', 'event', 'concern']),
          key: z.string().min(1).max(64),
          value: z.string().min(1).max(500),
          confidence: z.number().min(0).max(1).optional(),
        })
        .strict();
      const parsed = schema.safeParse(raw);
      if (!parsed.success) return invalid('remember_customer_fact', parsed.error.issues[0]?.message);

      const saved = await upsertMemory({
        customerId: ctx.customerId,
        kind: parsed.data.kind,
        key: parsed.data.key,
        value: parsed.data.value,
        confidence: parsed.data.confidence ?? 0.7,
      });
      if (!saved) return { ok: false, summaryFa: 'ذخیره در حافظه ناموفق بود.', error: 'memory_failed' };

      return {
        ok: true,
        summaryFa: 'این نکته برای دفعه بعد ذخیره شد.',
        data: { key: saved.key, value: saved.value },
        ui: [{ card: 'MemoryToast', props: { text: saved.value } }],
      };
    },
  },
  {
    name: 'forget_customer',
    labelFa: 'فراموش کردن حافظه',
    description: 'Deletes stored memories for this customer. Call when the user says «فراموشم کن» / «حافظه‌ام را پاک کن».',
    parameters: obj({}),
    async execute(_raw, ctx) {
      const { deleteMemory } = await import('@/lib/db/store');
      const removed = await deleteMemory(ctx.customerId);
      await logEvent({ customerId: ctx.customerId, type: 'memory.cleared', payload: { removed } });
      return {
        ok: true,
        summaryFa: 'همه‌چیز درباره شما پاک شد.',
        data: { removed },
        ui: [{ card: 'MemoryToast', props: { text: 'حافظه شما پاک شد.', cleared: true } }],
      };
    },
  },

  /* ── objection library (read-only helper) ──────────────────────────────── */
  {
    name: 'get_objection_answer',
    labelFa: 'پاسخ به تردید مشتری',
    description:
      'Returns the approved answer for a sales objection. Prefer this over free-forming an answer, so copy stays consistent.',
    parameters: obj({ topic: { type: 'string', description: 'e.g. price, privacy, durability, secure call' } }, ['topic']),
    async execute(raw, ctx) {
      const parsed = objectionSchema.safeParse(raw);
      if (!parsed.success) return invalid('get_objection_answer', parsed.error.issues[0]?.message);

      const match =
        matchObjection(parsed.data.topic) ??
        OBJECTIONS.find((o) => o.id === parsed.data.topic.toLowerCase());

      if (!match) {
        return {
          ok: false,
          summaryFa: 'پاسخ تأییدشده‌ای برای این موضوع نداریم؛ صادقانه بگو که باید با پشتیبانی چک شود.',
          error: 'no_answer',
          data: { hotline: '۰۲۱-۶۲۸۰۱' },
        };
      }

      await upsertConsultation({
        customerId: ctx.customerId,
        conversationId: ctx.conversationId,
        objections: [match.id],
        stage: 'objection',
      });

      return {
        ok: true,
        summaryFa: match.answerFa,
        data: { id: match.id, labelFa: match.labelFa, answerFa: match.answerFa },
      };
    },
  },
];

/* ── helpers ───────────────────────────────────────────────────────────────── */

function invalid(tool: string, detail?: string): ToolResult {
  return {
    ok: false,
    summaryFa: 'اطلاعات ورودی کامل یا معتبر نبود.',
    error: `invalid_args:${detail ?? tool}`,
  };
}

export function findTool(name: string): ToolDefinition | undefined {
  return TOOLS.find((t) => t.name === name);
}

/** OpenAI `tools` payload (JSON-schema function definitions). */
export function openAiToolSpecs(): Array<{
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}> {
  return TOOLS.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

/** Executes a tool by name with validated args. Never throws. */
export async function executeTool(name: string, args: unknown, ctx: ToolContext): Promise<ToolResult> {
  const tool = findTool(name);
  if (!tool) {
    return { ok: false, summaryFa: 'این ابزار در دسترس نیست.', error: `unknown_tool:${name}` };
  }
  try {
    return await tool.execute(args, ctx);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[aniyab/tool] ${name} threw`, (err as Error).message);
    return { ok: false, summaryFa: 'انجام این کار ممکن نشد.', error: 'tool_exception' };
  }
}

export { trackingCode };
