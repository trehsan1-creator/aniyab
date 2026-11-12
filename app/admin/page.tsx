import { adminConfigured, isAuthed } from '@/lib/admin/auth';
import { AdminDashboard } from '@/components/admin/admin-dashboard';
import { AdminLogin } from '@/components/admin/admin-login';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'داشبورد مدیریت' };

/**
 * /admin — Customer-360 Live.
 * Server-renders the gate; all data comes from /api/admin/* behind the cookie.
 */
export default async function AdminPage() {
  if (!adminConfigured()) {
    return (
      <main className="grid min-h-[100dvh] place-items-center bg-midnight p-6" dir="rtl">
        <div className="max-w-md rounded-2xl border border-white/10 bg-deep-900/60 p-6 text-center">
          <h1 className="text-base font-bold text-white">داشبورد تنظیم نشده است</h1>
          <p className="mt-2 text-[12px] leading-6 text-slate-400">
            برای فعال‌سازی، متغیر محیطی <code className="rounded bg-white/10 px-1">ADMIN_PASSWORD</code> را
            تنظیم کنید و دوباره deploy بزنید.
          </p>
        </div>
      </main>
    );
  }

  if (!(await isAuthed())) {
    return <AdminLogin />;
  }

  return <AdminDashboard />;
}
