import { NextResponse } from 'next/server';

import { isAuthed } from '@/lib/admin/auth';
import { adminSnapshot } from '@/lib/db/store';
import { supabaseConfigured } from '@/lib/db/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/admin/snapshot — Customer-360 read model (cookie-gated). */
export async function GET(): Promise<Response> {
  if (!(await isAuthed())) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const snapshot = await adminSnapshot();

  const receivedAt = new Date().toISOString();

  return NextResponse.json(
    {
      ok: true,
      receivedAt,
      realtime: supabaseConfigured(),
      ...snapshot,
      kpis: buildKpis(snapshot),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

function buildKpis(snapshot: Awaited<ReturnType<typeof adminSnapshot>>) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isToday = (iso: string) => new Date(iso).getTime() >= today.getTime();

  const activeChats = snapshot.conversations.filter((c) => c.status === 'open').length;
  const ticketsToday =
    snapshot.lostReports.filter((r) => isToday(r.created_at)).length +
    snapshot.foundReports.filter((r) => isToday(r.created_at)).length;
  const hotLeads = snapshot.consultations.filter(
    (c) => c.recommended_product && (c.stage === 'recommended' || c.stage === 'cta_shown'),
  ).length;
  const returning = snapshot.customers.filter((c) => c.visit_count > 1).length;
  const returningRate = snapshot.customers.length
    ? Math.round((returning / snapshot.customers.length) * 100)
    : 0;

  const latencies = snapshot.messages
    .map((m) => m.latency_ms)
    .filter((v): v is number => typeof v === 'number' && v > 0);
  const avgLatency = latencies.length
    ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
    : 0;

  const interest = {
    park: snapshot.consultations.filter((c) => c.recommended_product === 'ani-park').length,
    pro: snapshot.consultations.filter((c) => c.recommended_product === 'ani-pro').length,
  };

  const objections = new Map<string, number>();
  for (const c of snapshot.consultations) {
    for (const o of c.objections ?? []) objections.set(o, (objections.get(o) ?? 0) + 1);
  }

  const shopClicks = snapshot.events.filter((e) => e.type === 'shop_cta_click').length;
  const consults = snapshot.consultations.length;

  return {
    activeChats,
    ticketsToday,
    hotLeads,
    returningRate,
    avgLatency,
    interest,
    objections: [...objections.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
    funnel: {
      chats: snapshot.conversations.length,
      consultations: consults,
      shopClicks,
    },
  };
}
