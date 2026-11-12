import { NextResponse } from 'next/server';
import { z } from 'zod';

import { adminConfigured, createSession, verifyPassword } from '@/lib/admin/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ password: z.string().min(1).max(200) }).strict();

export async function POST(request: Request): Promise<Response> {
  if (!adminConfigured()) {
    return NextResponse.json({ error: 'ADMIN_PASSWORD تنظیم نشده است.' }, { status: 503 });
  }

  const raw = await request.text().catch(() => '');
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'درخواست نامعتبر است.' }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'رمز عبور را وارد کنید.' }, { status: 400 });
  }

  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown';

  const ok = await verifyPassword(parsed.data.password, ip);
  if (!ok) {
    return NextResponse.json({ error: 'رمز عبور نادرست است.' }, { status: 401 });
  }

  await createSession();
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
