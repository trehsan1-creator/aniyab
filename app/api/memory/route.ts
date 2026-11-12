import { NextResponse } from 'next/server';
import { z } from 'zod';

import { buildCustomerBrief } from '@/lib/agent/memory';
import { findOrCreateCustomer, listMemories, deleteMemory, getOrCreateConversation, logEvent } from '@/lib/db/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET    /api/memory?deviceId=…  → «آنچه درباره شما می‌دانم» panel
 * DELETE /api/memory?deviceId=…  → «فراموشم کن» (right to be forgotten)
 *
 * Memories are only ever scoped by the device identity, never enumerable.
 */

const KIND_LABEL_FA: Record<string, string> = {
  fact: 'واقعیت',
  preference: 'ترجیح',
  item: 'شیء',
  event: 'رویداد',
  concern: 'دغدغه',
};

async function resolveCustomer(deviceId: string) {
  const customer = await findOrCreateCustomer({ authUserId: deviceId });
  return customer;
}

export async function GET(request: Request): Promise<Response> {
  const deviceId = new URL(request.url).searchParams.get('deviceId')?.trim();
  if (!deviceId) {
    return NextResponse.json({ ok: false, error: 'deviceId لازم است.' }, { status: 400 });
  }

  const customer = await resolveCustomer(deviceId);
  const memories = await listMemories(customer.id);
  const brief = await buildCustomerBrief({ customer, memories });

  return NextResponse.json(
    {
      ok: true,
      customerId: customer.id,
      consent: customer.consent_memory,
      count: memories.length,
      memories: memories.map((m) => ({
        id: m.id,
        kind: m.kind,
        labelFa: KIND_LABEL_FA[m.kind] ?? m.kind,
        valueFa: m.value,
        confidencePct: Math.round(m.confidence * 100),
        updatedAt: m.updated_at,
      })),
      brief: { greetingFa: brief.greetingFa, chips: brief.chips, isReturning: brief.isReturning },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

const bodySchema = z.object({ deviceId: z.string().min(3).max(128) }).strict();

export async function DELETE(request: Request): Promise<Response> {
  const raw = await request.text().catch(() => '');
  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {
    const fromQuery = new URL(request.url).searchParams.get('deviceId');
    body = fromQuery ? { deviceId: fromQuery } : null;
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'deviceId لازم است.' }, { status: 400 });
  }

  const customer = await resolveCustomer(parsed.data.deviceId);
  const removed = await deleteMemory(customer.id);
  await logEvent({
    customerId: customer.id,
    type: 'memory.cleared',
    payload: { removed, via: 'api' },
  });

  // Close the open conversation so the next visit starts clean too.
  await getOrCreateConversation({ customerId: customer.id, flow: 'general' }).catch(() => null);

  return NextResponse.json(
    {
      ok: true,
      removed,
      messageFa: 'همهٔ اطلاعات شما پاک شد. از این پس گفتگو از صفر شروع می‌شود.',
      hotlineFa: '۰۲۱-۶۲۸۰۱',
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
