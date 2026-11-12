import { NextResponse } from 'next/server';

import { buildCustomerBrief } from '@/lib/agent/memory';
import { findOrCreateCustomer, getOrCreateConversation } from '@/lib/db/store';
import { supabaseConfigured } from '@/lib/db/client';

/**
 * GET /api/identity?deviceId=…
 *
 * Binds the anonymous device identity to a customer row and returns everything
 * the welcome screen needs: greeting (proactive continuity), status chips,
 * visit count and the open conversation id.
 *
 * The device id is a random UUID the browser keeps; it is NOT a phone number and
 * carries no personal data. A phone number is only attached after demo-OTP.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const deviceId = searchParams.get('deviceId')?.slice(0, 120);

  if (!deviceId) {
    return NextResponse.json({ ok: false, error: 'deviceId required' }, { status: 400 });
  }

  const customer = await findOrCreateCustomer({ authUserId: deviceId });
  const conversation = await getOrCreateConversation({ customerId: customer.id, flow: 'general' });
  const brief = await buildCustomerBrief({ customer, conversation });

  return NextResponse.json(
    {
      ok: true,
      customerId: customer.id,
      conversationId: conversation.id,
      visitCount: customer.visit_count,
      name: brief.name,
      greeting: brief.greetingFa,
      chips: brief.chips,
      memoryCount: brief.memories.length,
      storage: supabaseConfigured() ? 'supabase' : 'ephemeral',
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
