import { NextResponse } from 'next/server';

import { findOrCreateCustomer, listLostReports, getLostReportByCode } from '@/lib/db/store';
import { STEP_ORDER } from '@/lib/status';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/tickets?deviceId=…        → the device's tickets
 * GET /api/tickets?code=AN-L-XXXXXX  → a single public-safe ticket
 *
 * Status is derived from created_at on read (no cron, no status worker), which
 * is what makes the demo timeline move on its own.
 */
export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code')?.trim();
  const deviceId = searchParams.get('deviceId')?.trim();

  if (code) {
    const report = await getLostReportByCode(code.toUpperCase());
    if (!report) {
      return NextResponse.json({ ok: false, error: 'پرونده‌ای با این کد یافت نشد.' }, { status: 404 });
    }
    return NextResponse.json(
      { ok: true, tickets: [toPublic(report)] },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  if (!deviceId) {
    return NextResponse.json({ ok: false, error: 'deviceId یا code لازم است.' }, { status: 400 });
  }

  const customer = await findOrCreateCustomer({ authUserId: deviceId });
  const reports = await listLostReports(customer.id);

  return NextResponse.json(
    { ok: true, count: reports.length, tickets: reports.map(toPublic) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

function toPublic(report: Awaited<ReturnType<typeof getLostReportByCode>> extends null ? never : NonNullable<Awaited<ReturnType<typeof getLostReportByCode>>>) {
  return {
    trackingCode: report.tracking_code,
    trackingCodeFa: report.tracking_code,
    itemType: report.item_type,
    status: report.status,
    statusIndex: Math.max(0, STEP_ORDER.indexOf(report.status)),
    stepCount: STEP_ORDER.length,
    createdAt: report.created_at,
    place: report.last_seen_place,
    brandModel: report.brand_model,
  };
}
