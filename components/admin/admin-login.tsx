'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Lock } from 'lucide-react';

/** Password gate for /admin. Posts once, then the server sets an httpOnly cookie. */
export function AdminLogin() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? 'رمز عبور نادرست است.');
        return;
      }
      router.refresh();
    } catch {
      setError('ارتباط با سرور برقرار نشد.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-[100dvh] place-items-center bg-midnight p-6" dir="rtl">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl border border-white/10 bg-deep-900/70 p-6 shadow-card backdrop-blur"
      >
        <div className="mb-4 flex items-center gap-2">
          <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-l from-[#FF7A00] to-[#f05327] text-white">
            <Lock className="size-4" aria-hidden />
          </span>
          <div>
            <h1 className="text-[14px] font-bold text-white">داشبورد آنی‌یاب</h1>
            <p className="text-[10.5px] text-slate-400">Customer-360 · نسخه نمایشی</p>
          </div>
        </div>

        <label htmlFor="admin-pass" className="mb-1.5 block text-[11.5px] text-slate-300">
          رمز عبور مدیریت
        </label>
        <input
          id="admin-pass"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={Boolean(error)}
          className="w-full rounded-xl border border-white/12 bg-midnight-800 px-3 py-2.5 text-[13px] text-white focus:border-signal/60 focus:outline-none"
        />

        {error ? (
          <p role="alert" className="mt-2 text-[11.5px] text-rose-300">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy || !password}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-l from-[#FF7A00] to-[#f05327] px-4 py-2.5 text-[13px] font-bold text-white shadow-signal disabled:opacity-40"
        >
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          ورود
        </button>
      </form>
    </main>
  );
}
