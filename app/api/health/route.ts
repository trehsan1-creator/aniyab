import { NextResponse } from 'next/server';

import { supabaseConfigured } from '@/lib/db/client';
import { demoAllowedOnServer } from '@/lib/demo-flag';
import { layaConfig, layaLastDecision } from '@/lib/laya';
import { defaultProvider, hasLayaInference, hasNvidiaKey, nvidiaModelChain } from '@/lib/llm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/health — cheap readiness probe for uptime monitors and the demo.
 *
 * Never touches the network (no credits spent, no latency) and never reveals
 * key material. Because it does not call Laya, `configured: true` alone says
 * nothing about whether the decision layer works — so it also reports the last
 * *real* decision, and that record is where a 402/401 shows up.
 */
export async function GET(): Promise<Response> {
  const provider = defaultProvider();
  const laya = layaConfig();
  const last = layaLastDecision();

  const decisionLayer =
    !laya.enabled
      ? 'off'
      : last === null
        ? 'unverified'
        : last.status === 'ok'
          ? 'ok'
          : last.status;

  return NextResponse.json(
    {
      ok: true,
      service: 'aniyab-assistant',
      version: '2.0.0',
      uptimeSeconds: Math.round(process.uptime()),
      time: new Date().toISOString(),
      checks: {
        llm: {
          provider,
          configured: provider === 'laya' ? hasLayaInference() : hasNvidiaKey(),
          models: nvidiaModelChain(process.env.NVIDIA_MODEL),
        },
        /**
         * `decisionLayer` is the field to alert on:
         *   off        → no key/endpoint; the keyword router is serving
         *   unverified → key present, but this instance has not observed a
         *                decision yet (Vercel functions are per-instance, so a
         *                cold instance honestly reports "unknown", not "broken")
         *   ok         → decisions are being made
         *   failed     → a real call failed; `last.error` says why (402 = no
         *                credits, 401 = bad key, 422 = invalid question)
         */
        laya: {
          configured: laya.enabled,
          decisionLayer,
          model: laya.model,
          endpointHost: laya.endpoint ? safeHost(laya.endpoint) : null,
          timeoutMs: laya.timeoutMs,
          last,
        },
        supabase: {
          configured: supabaseConfigured(),
          mode: supabaseConfigured() ? 'supabase' : 'memory',
        },
        admin: { configured: Boolean(process.env.ADMIN_PASSWORD?.trim()) },
        demo: {
          otp: process.env.DEMO_OTP ? 'configured' : 'default',
          badge: process.env.NEXT_PUBLIC_DEMO_BADGE ?? '1',
          tools: demoAllowedOnServer(),
          scriptedDefault: process.env.NEXT_PUBLIC_DEMO_SCRIPTED === '1',
        },
      },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

function safeHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return 'invalid-url';
  }
}
