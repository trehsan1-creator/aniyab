import type { Config } from 'tailwindcss';

/**
 * ────────────────────────────────────────────────────────────────────────────
 *  ANIYAB DESIGN SYSTEM — tailwind.config.ts
 *  Midnight Navy / Deep Blue / Signal Orange · strict RTL · Peyda typeface
 * ────────────────────────────────────────────────────────────────────────────
 */
const config: Config = {
  content: [
    './app/**/*.{ts,tsx,mdx}',
    './components/**/*.{ts,tsx,mdx}',
    './lib/**/*.{ts,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        /* Primary app background */
        midnight: {
          DEFAULT: '#102333',
          50: '#E7EDF3',
          100: '#C3D2E0',
          200: '#8FA6BF',
          300: '#5B7A9B',
          400: '#33506E',
          500: '#1B3A55',
          600: '#152C41',
          700: '#102333', // ← Primary App Background
          800: '#0B1A26',
          900: '#071119',
          950: '#040A0F',
        },
        /* Elevated cards · assistant bubbles · header · input bar */
        deep: {
          DEFAULT: '#1E3A72',
          50: '#EBF0FA',
          100: '#CFDAF1',
          200: '#A3B7E4',
          300: '#7391D4',
          400: '#476EBF',
          500: '#2A4FA0',
          600: '#1E3A72', // ← Elevated surfaces
          700: '#182E5B',
          800: '#122344',
          900: '#0D192F',
          950: '#080F1C',
        },
        /* Primary accent · user bubbles · CTAs · active states */
        signal: {
          DEFAULT: '#FF7A00',
          50: '#FFF3E6',
          100: '#FFE0BF',
          200: '#FFC180',
          300: '#FFA340',
          400: '#FF8C1A',
          500: '#FF7A00', // ← Signal Orange
          600: '#E06A00',
          700: '#B85600',
          800: '#8F4300',
          900: '#663000',
        },
        ember: {
          DEFAULT: '#f05327',
          500: '#f05327', // ← Gradient terminus
          600: '#D8410F',
        },
        /* Secondary metadata / timestamps */
        slate: {
          100: '#F1F5F9',
          200: '#E2E8F0',
          300: '#CBD5E1', // ← Slate Gray (metadata)
          400: '#94A3B8',
          500: '#64748B',
          600: '#475569',
        },
      },

      fontFamily: {
        /** default body font — wired to next/font CSS variable with static fallbacks */
        peyda: [
          'var(--font-peyda)',
          'Peyda',
          'PeydaWebFaNum',
          'Vazirmatn',
          'IRANSans',
          'Segoe UI',
          'Tahoma',
          'sans-serif',
        ],
        sans: [
          'var(--font-peyda)',
          'Peyda',
          'PeydaWebFaNum',
          'Vazirmatn',
          'IRANSans',
          'Segoe UI',
          'Tahoma',
          'sans-serif',
        ],
      },

      fontWeight: {
        thin: '200',
        light: '300',
        normal: '400',
        medium: '500',
        semibold: '600',
        bold: '700',
        extrabold: '800',
      },

      /* Persian typography needs looser leading + slightly tighter tracking */
      letterSpacing: {
        peyda: '0em',
      },
      lineHeight: {
        peyda: '1.85',
        'peyda-tight': '1.55',
      },

      backgroundImage: {
        /* CTA / user bubble gradient — RTL: orange on the right edge */
        'signal-gradient': 'linear-gradient(to left, #FF7A00 0%, #f05327 100%)',
        'signal-gradient-soft':
          'linear-gradient(to left, rgba(255,122,0,0.22) 0%, rgba(240,83,39,0.14) 100%)',
        'deep-glass':
          'linear-gradient(160deg, rgba(30,58,114,0.92) 0%, rgba(30,58,114,0.68) 100%)',
        'app-radial':
          'radial-gradient(1200px 620px at 85% -10%, rgba(30,58,114,0.75) 0%, rgba(16,35,51,0) 62%), radial-gradient(900px 520px at 8% 108%, rgba(255,122,0,0.14) 0%, rgba(16,35,51,0) 55%)',
        'grid-fade':
          'linear-gradient(to bottom, rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(to left, rgba(255,255,255,0.045) 1px, transparent 1px)',
      },

      boxShadow: {
        card: '0 18px 44px -22px rgba(4,10,15,0.85), 0 2px 10px -4px rgba(4,10,15,0.6)',
        'card-hover':
          '0 26px 60px -26px rgba(4,10,15,0.9), 0 4px 16px -6px rgba(4,10,15,0.7)',
        signal: '0 12px 32px -12px rgba(255,122,0,0.62)',
        'signal-sm': '0 6px 18px -8px rgba(255,122,0,0.55)',
        'inner-hairline': 'inset 0 1px 0 0 rgba(255,255,255,0.08)',
        'glow-slate': '0 0 0 1px rgba(203,213,225,0.08)',
      },

      borderRadius: {
        '4xl': '2rem',
        bubble: '1.25rem',
      },

      spacing: {
        18: '4.5rem',
        22: '5.5rem',
        128: '32rem',
      },

      maxWidth: {
        chat: '52rem',
        shell: '74rem',
      },

      transitionTimingFunction: {
        peyda: 'cubic-bezier(0.22, 1, 0.36, 1)',
        spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },

      keyframes: {
        /* live status badge ring */
        'pulse-ring': {
          '0%': { transform: 'scale(0.85)', opacity: '0.85' },
          '70%': { transform: 'scale(2.1)', opacity: '0' },
          '100%': { transform: 'scale(2.1)', opacity: '0' },
        },
        /* typing indicator dots */
        'typing-dot': {
          '0%, 60%, 100%': { transform: 'translateY(0)', opacity: '0.45' },
          '30%': { transform: 'translateY(-5px)', opacity: '1' },
        },
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(10px) scale(0.985)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'slide-in-rtl': {
          from: { opacity: '0', transform: 'translateX(14px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        'caret-blink': {
          '0%, 45%': { opacity: '1' },
          '50%, 95%': { opacity: '0' },
        },
        shimmer: {
          '100%': { transform: 'translateX(-220%)' },
        },
        'float-slow': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-7px)' },
        },
        'scan-line': {
          '0%': { transform: 'translateY(-100%)', opacity: '0' },
          '35%': { opacity: '0.7' },
          '100%': { transform: 'translateY(320%)', opacity: '0' },
        },
      },

      animation: {
        'pulse-ring': 'pulse-ring 2.4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'typing-dot': 'typing-dot 1.15s ease-in-out infinite',
        'fade-up': 'fade-up 0.42s cubic-bezier(0.22, 1, 0.36, 1) both',
        'fade-in': 'fade-in 0.35s ease-out both',
        'slide-in-rtl': 'slide-in-rtl 0.38s cubic-bezier(0.22, 1, 0.36, 1) both',
        'caret-blink': 'caret-blink 1s steps(1) infinite',
        shimmer: 'shimmer 1.9s ease-in-out infinite',
        'float-slow': 'float-slow 5.5s ease-in-out infinite',
        'scan-line': 'scan-line 2.8s ease-in-out infinite',
      },

      screens: {
        xs: '400px',
      },
    },
  },
  plugins: [],
};

export default config;
