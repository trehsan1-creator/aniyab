import type { Metadata, Viewport } from 'next';

import { PwaRegister } from '@/components/shell/pwa-register';
import { peyda } from '@/lib/peyda';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'دستیار هوشمند آنی‌یاب | مرکز ملی گمشده‌ها و پیداشده‌ها',
    template: '%s | آنی‌یاب',
  },
  description:
    'دستیار هوشمند آنی‌یاب؛ ثبت مفقودی، ردیابی IMEI، خرید برچسب هوشمند آنی پارک و آنی پرو و ثبت اشیای پیداشده — پشتیبانی ۲۴ ساعته ۰۲۱-۶۲۸۰۱.',
  applicationName: 'آنی‌یاب',
  keywords: [
    'آنی‌یاب',
    'گمشده‌ها',
    'پیداشده‌ها',
    'ردیابی IMEI',
    'برچسب هوشمند',
    'آنی پارک',
    'آنی پرو',
    'پست یافته',
    'آگهی مفقودی روزنامه',
  ],
  authors: [{ name: 'مرکز ملی گمشده‌ها و پیداشده‌های آنی‌یاب' }],
  openGraph: {
    title: 'دستیار هوشمند آنی‌یاب',
    description:
      'مرکز ملی گمشده‌ها و پیداشده‌ها — دستیار هوشمند ۲۴ ساعته برای اعلام مفقودی، ردیابی و ثبت اشیای پیداشده.',
    locale: 'fa_IR',
    type: 'website',
  },
  robots: { index: true, follow: true },
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
  appleWebApp: {
    capable: true,
    title: 'آنی‌یاب',
    statusBarStyle: 'black-translucent',
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: '#102333',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl" className={`${peyda.variable} h-full dark`} suppressHydrationWarning>
      <body className="h-full bg-midnight font-peyda text-white antialiased selection:bg-signal/30 selection:text-white">
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
