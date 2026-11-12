import { NextResponse } from 'next/server';

import { supabaseConfigured } from '@/lib/db/client';
import { demoAllowedOnServer } from '@/lib/demo-flag';
import { layaConfig } from '@/lib/laya';
import { defaultProvider, hasLayaInference, hasNvidiaKey, nvidiaModelChain, systemOneConfig } from '@/lib/llm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/health — cheap readiness probe for uptime monitors and the demo.
 * Never touches the network and never reveals key material.
 */
export async function GET(): Promise<Response> {
  const provider = defaultProvider();
  const laya = layaConfig();
  const systemOne = systemOneConfig();

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
        laya: {
          mode: laya.mode,
          configured: systemOne.enabled,
          endpointHost: systemOne.endpoint ? safeHost(systemOne.endpoint) : null,
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
