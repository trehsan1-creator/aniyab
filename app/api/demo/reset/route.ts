import { NextResponse } from 'next/server';

import { demoAllowedOnServer } from '@/lib/demo-flag';

import { deleteMemory, findOrCreateCustomer, getOrCreateConversation, logEvent, listLostReports } from '@/lib/db/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/demo/reset { deviceId }
 *
 * Restores a persona to its "first visit" state: memories wiped, conversations
 * closed, tickets left intact (they are the point of the returning-customer demo).
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
  const removedMemories = await deleteMemory(customer.id);
  const tickets = await listLostReports(customer.id);
  await getOrCreateConversation({ customerId: customer.id, flow: 'general' }).catch(() => null);
  await logEvent({ customerId: customer.id, type: 'demo.reset', payload: { removedMemories } });

  return NextResponse.json(
    {
      ok: true,
      removedMemories,
      keptTickets: tickets.length,
      messageFa: 'پرسونا برای اجرای بعدی آماده شد.',
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
