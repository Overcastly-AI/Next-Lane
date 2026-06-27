/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Brand: deep teal (cyan family) — "lane/flow" metaphor, not generic indigo
        brand: {
          50:  '#ecfeff',
          100: '#cffafe',
          200: '#a5f3fc',
          300: '#67e8f9',
          400: '#22d3ee',
          500: '#06b6d4',
          600: '#0891b2',
          700: '#0e7490',
          800: '#155e75',
          900: '#164e63',
        },
        // Status-progression palette — designed as a semantic arc
        // todo: neutral stone (resting), in-progress: amber (motion), done: emerald (resolved)
        status: {
          todo:        '#78716c', // stone-500
          'todo-bg':   '#f5f5f4', // stone-100
          inprogress:  '#d97706', // amber-600
          'inprogress-bg': '#fef3c7', // amber-100
          done:        '#059669', // emerald-600
          'done-bg':   '#d1fae5', // emerald-100
        },
      },
      fontFamily: {
        sans: [
          'Plus Jakarta Sans Variable',
          'Plus Jakarta Sans',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'sans-serif',
        ],
        mono: [
          'IBM Plex Mono',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          'Consolas',
          'monospace',
        ],
      },
      fontSize: {
        // Tighter, more refined type scale
        '2xs': ['0.65rem',  { lineHeight: '1rem'    }],
        'xs':  ['0.75rem',  { lineHeight: '1.125rem'}],
        'sm':  ['0.8125rem',{ lineHeight: '1.25rem' }],
        'base':['0.9375rem',{ lineHeight: '1.5rem'  }],
        'lg':  ['1.0625rem',{ lineHeight: '1.625rem'}],
        'xl':  ['1.1875rem',{ lineHeight: '1.75rem' }],
        '2xl': ['1.375rem', { lineHeight: '2rem'    }],
      },
      spacing: {
        // 4px base grid — everything divisible by 4
        '0.5':  '2px',
        '1':    '4px',
        '1.5':  '6px',
        '2':    '8px',
        '2.5':  '10px',
        '3':    '12px',
        '3.5':  '14px',
        '4':    '16px',
        '5':    '20px',
        '6':    '24px',
        '7':    '28px',
        '8':    '32px',
        '9':    '36px',
        '10':   '40px',
        '12':   '48px',
        '14':   '56px',
        '16':   '64px',
      },
      borderRadius: {
        'sm':   '0.25rem',   // 4px  — badges, chips
        DEFAULT:'0.375rem',  // 6px  — inputs, small controls
        'md':   '0.5rem',    // 8px  — cards
        'lg':   '0.625rem',  // 10px — dropdowns
        'xl':   '0.75rem',   // 12px — modals, columns
        '2xl':  '1rem',      // 16px — auth card
        'full': '9999px',    // — pills, avatars
      },
      boxShadow: {
        // Refined 2-tier shadow system
        'xs':        '0 1px 2px 0 rgb(0 0 0 / 0.04)',
        'sm':        '0 1px 3px 0 rgb(0 0 0 / 0.06), 0 1px 2px -1px rgb(0 0 0 / 0.04)',
        'card':      '0 1px 3px 0 rgb(0 0 0 / 0.06), 0 1px 2px -1px rgb(0 0 0 / 0.04)',
        'cardHover': '0 4px 16px -2px rgb(0 0 0 / 0.10), 0 2px 6px -2px rgb(0 0 0 / 0.06)',
        'modal':     '0 20px 60px -12px rgb(0 0 0 / 0.25), 0 8px 20px -8px rgb(0 0 0 / 0.10)',
        'dropdown':  '0 4px 16px -4px rgb(0 0 0 / 0.12), 0 2px 6px -2px rgb(0 0 0 / 0.06)',
      },
      transitionDuration: {
        '150': '150ms',
        '200': '200ms',
        '250': '250ms',
      },
      transitionTimingFunction: {
        'out': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        'nl-toast-in': {
          from: { opacity: '0', transform: 'translateY(-6px) scale(0.98)' },
          to:   { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'nl-drawer-in': {
          from: { opacity: '0', transform: 'translateX(24px)' },
          to:   { opacity: '1', transform: 'translateX(0)' },
        },
        'nl-modal-in': {
          from: { opacity: '0', transform: 'translateY(8px) scale(0.97)' },
          to:   { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'nl-fade-in': {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
      },
      animation: {
        'nl-toast-in':  'nl-toast-in 200ms cubic-bezier(0.16,1,0.3,1) both',
        'nl-drawer-in': 'nl-drawer-in 220ms cubic-bezier(0.16,1,0.3,1) both',
        'nl-modal-in':  'nl-modal-in 180ms cubic-bezier(0.16,1,0.3,1) both',
        'nl-fade-in':   'nl-fade-in 150ms ease both',
      },
    },
  },
  plugins: [],
};
