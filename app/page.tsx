import { ChatShell } from '@/components/shell/chat-shell';

/**
 * Home — the assistant.
 *
 * Query params (all optional, all safe to share):
 *   ?demo=1      → reveals the presenter console (persona switcher, reset, FF)
 *   ?scripted=1  → canned narration instead of the model (offline fallback)
 *   ?xray=1      → opens with the X-Ray panel on
 *   ?flow=       → smart-tag | lost-report | found-report
 */

export default function HomePage({
  searchParams,
}: {
  searchParams?: { demo?: string; scripted?: string; flow?: string };
}) {
  const demoRequested = searchParams?.demo === '1';
  const demoAllowed =
    process.env.NEXT_PUBLIC_DEMO_TOOLS === '1' || process.env.NODE_ENV !== 'production';
  const scriptedDefault =
    searchParams?.scripted === '1' || process.env.NEXT_PUBLIC_DEMO_SCRIPTED === '1';

  return (
    <main className="relative h-[100dvh] overflow-hidden bg-midnight">
      <ChatShell demoMode={demoRequested && demoAllowed} scriptedDefault={scriptedDefault} />
    </main>
  );
}
