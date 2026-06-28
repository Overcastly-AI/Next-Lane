/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        /*
         * DISPATCH palette — graphite-ink neutrals with cool blue undertone (~220°).
         * NOT flat gray (hue 0°), not warm slate, not cream.
         * Named "ink" to be evocative: the dispatch board is ink on paper.
         */
        ink: {
          50:  '#f4f6f9',  // canvas — very faint graphite wash
          100: '#edf0f5',  // surface borders, muted fills
          200: '#dde1e9',  // default border
          300: '#c4cad6',  // strong border, disabled text
          400: '#8b95a8',  // muted text
          500: '#6b7280',  // secondary icons, placeholders
          600: '#4b5563',  // secondary text
          700: '#374151',  // body text mid
          800: '#1f2937',  // near-headings
          900: '#111827',  // primary text — near-black with blue cast
        },

        /*
         * Signal accent — electric cobalt #2563EB.
         * Used ONLY for: primary buttons, active nav states, in-progress status
         * signals, focus rings, and the issue-key chip. Everything else is ink.
         *
         * Why this hue: sits between true-blue and engineering-blue.
         * Reads as "signal", "priority", "active dispatch" — not generic SaaS
         * indigo (#6366f1 which reads purple), not teal/cyan (old brand),
         * not sky-blue (too soft). Passes WCAG AA on white at all weights ≥500.
         */
        /*
         * Signal accent — CSS-var backed so runtime theming can swap the full
         * 50–900 scale when a workspace sets a custom brandColor.
         * The `:root` defaults in index.css initialise these to the exact same
         * electric-cobalt hex values that were previously hard-coded here, so the
         * rendered output is byte-identical when no workspace brand color is set.
         */
        signal: {
          50:  'var(--nl-signal-50)',
          100: 'var(--nl-signal-100)',
          200: 'var(--nl-signal-200)',
          300: 'var(--nl-signal-300)',
          400: 'var(--nl-signal-400)',
          500: 'var(--nl-signal-500)',
          600: 'var(--nl-signal-600)',
          700: 'var(--nl-signal-700)',
          800: 'var(--nl-signal-800)',
          900: 'var(--nl-signal-900)',
        },

        /*
         * Legacy alias — kept so existing `brand-*` classes in components
         * continue to resolve without a mass find-replace. Points to signal vars.
         */
        brand: {
          50:  'var(--nl-signal-50)',
          100: 'var(--nl-signal-100)',
          200: 'var(--nl-signal-200)',
          300: 'var(--nl-signal-300)',
          400: 'var(--nl-signal-400)',
          500: 'var(--nl-signal-500)',
          600: 'var(--nl-signal-600)',
          700: 'var(--nl-signal-700)',
          800: 'var(--nl-signal-800)',
          900: 'var(--nl-signal-900)',
        },

        /*
         * Status-progression palette — semantic signal arc.
         * todo: graphite (queued, resting)
         * inprogress: cobalt (dispatched, in motion) — inherits signal accent
         * done: eucalyptus (resolved, arrived)
         */
        status: {
          todo:            '#6b7280', // ink-500 — resting
          'todo-bg':       '#f4f6f9', // ink-50
          inprogress:      '#2563EB', // cobalt signal — in motion
          'inprogress-bg': '#eff6ff', // signal-50
          done:            '#059669', // eucalyptus — arrived
          'done-bg':       '#d1fae5', // emerald-100
        },
      },

      fontFamily: {
        /*
         * Display — Space Grotesk: geometric, technical, used for headings
         * and brand mark text. Restrained: only h1-h6 and .nl-display.
         */
        display: [
          'Space Grotesk',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'sans-serif',
        ],
        /*
         * Sans — IBM Plex Sans: the primary UI/body face.
         * Replaces Plus Jakarta Sans. More precise, engineered, technical.
         * Used for all body text, labels, form controls, nav.
         */
        sans: [
          'IBM Plex Sans',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'sans-serif',
        ],
        /*
         * Mono — IBM Plex Mono: data signature.
         * Issue keys, timestamps, story points, code blocks.
         * The "dispatch board" data layer.
         */
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
        /* Refined type scale — slightly tighter than default for precision */
        '2xs': ['0.625rem',  { lineHeight: '0.9375rem' }],
        'xs':  ['0.75rem',   { lineHeight: '1.125rem'  }],
        'sm':  ['0.8125rem', { lineHeight: '1.25rem'   }],
        'base':['0.9375rem', { lineHeight: '1.5rem'    }],
        'lg':  ['1.0625rem', { lineHeight: '1.625rem'  }],
        'xl':  ['1.1875rem', { lineHeight: '1.75rem'   }],
        '2xl': ['1.375rem',  { lineHeight: '2rem'      }],
        '3xl': ['1.625rem',  { lineHeight: '2.25rem'   }],
      },

      spacing: {
        /* 4px base grid */
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
        /* Tighter radii — more engineered, less bubbly */
        'sm':   '0.1875rem',  // 3px  — chips, badges
        DEFAULT:'0.3125rem',  // 5px  — inputs, small controls
        'md':   '0.4375rem',  // 7px  — cards
        'lg':   '0.625rem',   // 10px — dropdowns
        'xl':   '0.875rem',   // 14px — modals, columns
        '2xl':  '1.125rem',   // 18px — auth card
        'full': '9999px',
      },

      boxShadow: {
        /* 2-tier shadow system — ink-tinted, not warm gray */
        'xs':        '0 1px 2px 0 rgb(17 24 39 / 0.05)',
        'sm':        '0 1px 3px 0 rgb(17 24 39 / 0.07), 0 1px 2px -1px rgb(17 24 39 / 0.05)',
        'card':      '0 1px 3px 0 rgb(17 24 39 / 0.06), 0 1px 2px -1px rgb(17 24 39 / 0.04)',
        'cardHover': '0 4px 16px -2px rgb(17 24 39 / 0.12), 0 2px 6px -2px rgb(17 24 39 / 0.07)',
        'modal':     '0 24px 64px -12px rgb(17 24 39 / 0.28), 0 8px 24px -8px rgb(17 24 39 / 0.12)',
        'dropdown':  '0 4px 16px -4px rgb(17 24 39 / 0.14), 0 2px 6px -2px rgb(17 24 39 / 0.07)',
        'signal':    '0 0 0 3px rgb(37 99 235 / 0.18)',  /* cobalt glow for focus */
      },

      transitionDuration: {
        '120': '120ms',
        '150': '150ms',
        '180': '180ms',
        '200': '200ms',
        '240': '240ms',
      },

      transitionTimingFunction: {
        'out': 'cubic-bezier(0.16, 1, 0.3, 1)',
        'in':  'cubic-bezier(0.4, 0, 1, 1)',
      },

      keyframes: {
        'nl-toast-in': {
          from: { opacity: '0', transform: 'translateY(-8px) scale(0.97)' },
          to:   { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'nl-drawer-in': {
          from: { opacity: '0', transform: 'translateX(20px)' },
          to:   { opacity: '1', transform: 'translateX(0)' },
        },
        'nl-modal-in': {
          from: { opacity: '0', transform: 'translateY(6px) scale(0.98)' },
          to:   { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'nl-fade-in': {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
        'nl-card-merge-in': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
      },

      animation: {
        'nl-toast-in':      'nl-toast-in 200ms cubic-bezier(0.16,1,0.3,1) both',
        'nl-drawer-in':     'nl-drawer-in 240ms cubic-bezier(0.16,1,0.3,1) both',
        'nl-modal-in':      'nl-modal-in 160ms cubic-bezier(0.16,1,0.3,1) both',
        'nl-fade-in':       'nl-fade-in 140ms ease both',
        'nl-card-merge-in': 'nl-card-merge-in 280ms cubic-bezier(0.16,1,0.3,1) both',
      },
    },
  },
  plugins: [],
};
