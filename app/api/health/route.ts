import { NextResponse } from 'next/server';

import { supabaseConfigured } from '@/lib/db/client';
import { demoAllowedOnServer } from '@/lib/demo-flag';
import { layaConfig, layaLastDecision } from '@/lib/laya';
import { defaultProvider, hasLayaInference, hasNvidiaKey, nvidiaModelChain } from '@/lib/llm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/health — cheap readiness probe for uptime monitors and the demo.
 * Never touches the network and never reveals key material.
 */
export async function GET(): Promise<Response> {
  const provider = defaultProvider();
  const laya = layaConfig();
  const last = layaLastDecision();

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
         * Honest, not optimistic: `configured` means the key and endpoint exist.
         * `last` is the most recent real decision this process made — a
         * configured-but-never-called integration reports `last: null` rather
         * than pretending to be connected.
         */
        laya: {
          configured: laya.enabled,
          status: laya.enabled ? 'live' : 'off',
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
