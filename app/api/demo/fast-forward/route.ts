import { NextResponse } from 'next/server';

import { demoAllowedOnServer } from '@/lib/demo-flag';

import { fastForwardLostReports, findOrCreateCustomer } from '@/lib/db/store';
import { statusFa } from '@/lib/status';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/demo/fast-forward  { deviceId }
 *
 * Presenter-only: advances every open ticket one step so the timeline can be
 * shown in six minutes instead of twenty. Disabled in production unless
 * NEXT_PUBLIC_DEMO_TOOLS=1.
 */
export async function POST(request: Request): Promise<Response> {
  // Server-side switch (NEXT_PUBLIC_* is inlined at build time and would need a rebuild).
  const demoAllowed = demoAllowedOnServer();
  if (!demoAllowed) {
    return NextResponse.json({ ok: false, error: 'demo tools are disabled' }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { deviceId?: string } | null;
  const deviceId = body?.deviceId?.trim();
  if (!deviceId) {
    return NextResponse.json({ ok: false, error: 'deviceId لازم است.' }, { status: 400 });
  }

  const customer = await findOrCreateCustomer({ authUserId: deviceId });
  const updated = await fastForwardLostReports(customer.id);

  return NextResponse.json(
    {
      ok: true,
      count: updated.length,
      tickets: updated.map((r) => ({
        trackingCode: r.tracking_code,
        status: r.status,
        statusFa: statusFa(r.status),
      })),
      messageFa: updated.length
        ? `${updated.length} پرونده یک مرحله جلو رفت.`
        : 'پروندهٔ بازی برای جلو بردن پیدا نشد.',
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
