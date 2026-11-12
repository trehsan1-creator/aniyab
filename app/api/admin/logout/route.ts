import { NextResponse } from 'next/server';

import { destroySession } from '@/lib/admin/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(): Promise<Response> {
  await destroySession();
  return NextResponse.json({ ok: true });
}
