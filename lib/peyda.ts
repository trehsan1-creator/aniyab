import localFont from 'next/font/local';

/**
 * Peyda (پیدا) — the official Aniyab typeface.
 *
 * `PeydaWebFaNum` is the Persian-numeral build of Peyda: Latin digits 0-9 are
 * substituted with ۰-۹ at the glyph level, so Persian numerals stay correct even
 * inside strings that originate from the LLM or from Latin-only data sources.
 *
 * Files live in `public/fonts/` and are self-hosted (no third-party CDN, no
 * flash of unstyled text, no Google Fonts request from inside Iran).
 */
export const peyda = localFont({
  src: [
    { path: '../public/fonts/PeydaWebFaNum-Light.woff2', weight: '300', style: 'normal' },
    { path: '../public/fonts/PeydaWebFaNum-Regular.woff2', weight: '400', style: 'normal' },
    { path: '../public/fonts/PeydaWebFaNum-Medium.woff2', weight: '500', style: 'normal' },
    { path: '../public/fonts/PeydaWebFaNum-SemiBold.woff2', weight: '600', style: 'normal' },
    { path: '../public/fonts/PeydaWebFaNum-Bold.woff2', weight: '700', style: 'normal' },
    { path: '../public/fonts/PeydaWebFaNum-ExtraBold.woff2', weight: '800', style: 'normal' },
  ],
  variable: '--font-peyda',
  display: 'swap',
  preload: true,
  adjustFontFallback: false,
  fallback: ['Vazirmatn', 'IRANSansX', 'Segoe UI', 'Tahoma', 'Arial', 'sans-serif'],
});
