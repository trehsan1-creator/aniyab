import { NextResponse } from 'next/server';
import { z } from 'zod';

import { findOrCreateCustomer, logEvent } from '@/lib/db/store';

/** POST /api/events — funnel analytics (CTA clicks, feedback, demo actions). */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z
  .object({
    type: z.string().min(1).max(60),
    payload: z.record(z.string(), z.unknown()).optional(),
    deviceId: z.string().max(120).optional(),
  })
  .strict();

export async function POST(request: Request): Promise<Response> {
  const raw = await request.text().catch(() => '');
  if (raw.length > 8_192) return NextResponse.json({ ok: false }, { status: 413 });

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const result = schema.safeParse(parsed);
  if (!result.success) return NextResponse.json({ ok: false }, { status: 400 });

  const customer = result.data.deviceId
    ? await findOrCreateCustomer({ authUserId: result.data.deviceId })
    : null;

  await logEvent({
    customerId: customer?.id ?? null,
    type: result.data.type,
    payload: result.data.payload ?? {},
  });

  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
