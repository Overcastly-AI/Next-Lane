/**
 * All DISPATCH palette scales below are CSS-custom-property-backed (defined
 * in `src/index.css`'s `:root` for light and `.dark` for dark) so the entire
 * token layer — including every existing component that already consumes
 * `ink-*` / `slate-*` / `red-*` / etc. Tailwind classes — gets dark mode for
 * free with ZERO per-component changes. See `docs/BACKLOG.md` "Light / dark
 * mode" and the design rationale comment block at the top of `index.css`.
 *
 * `withOpacity` restores Tailwind's `/NN` opacity-modifier support for these
 * CSS-var colors (e.g. `bg-ink-900/35`) via `color-mix()` — the var itself
 * stays a plain hex string (so e.g. `getComputedStyle(...).getPropertyValue
 * ('--nl-signal-600')` in e2e tests keeps returning a hex value, unaffected)
 * while Tailwind utilities that consume it can still apply opacity.
 * `color-mix()` is supported by all evergreen browsers (Chrome 111+, Firefox
 * 113+, Safari 16.4+) — well within this app's self-hosted target range.
 *
 * NOTE: Tailwind's textColor/backgroundColor/etc. corePlugins ALWAYS invoke a
 * function-based color with an `opacityValue`, even with no `/NN` modifier —
 * in that case it's the *string* `"var(--tw-text-opacity)"` (the legacy
 * `text-opacity-*` utility's variable, defaulting to 1), not `undefined` and
 * not a plain number. This app doesn't use those legacy opacity utilities, so
 * anything that isn't a genuine numeric string from an explicit `/NN`
 * modifier is treated as "fully opaque" and passed straight through.
 */
function withOpacity(varName) {
  return ({ opacityValue }) => {
    const n = typeof opacityValue === 'string' ? Number(opacityValue) : NaN;
    if (Number.isNaN(n)) return `var(${varName})`;
    return `color-mix(in srgb, var(${varName}) ${n * 100}%, transparent)`;
  };
}

/** Build a full 50–900 shade map for a CSS-var-backed color family. */
function varScale(prefix) {
  const shades = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900'];
  return Object.fromEntries(shades.map((s) => [s, withOpacity(`--nl-${prefix}-${s}`)]));
}

/** @type {import('tailwindcss').Config} */
export default {
  // Class-based dark mode: a `.dark` class on <html>, toggled synchronously
  // before first paint (see index.html's inline bootstrap script) and kept in
  // sync by ThemeContext. Never media-query-only — a manual toggle needs a
  // class to override the OS preference.
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        /*
         * DISPATCH palette — graphite-ink neutrals with cool blue undertone (~220°).
         * NOT flat gray (hue 0°), not warm slate, not cream.
         * Named "ink" to be evocative: the dispatch board is ink on paper.
         *
         * Role of each shade is fixed across light AND dark (only the literal
         * color changes): 50/100 = faint wash / muted fill, 200/300 = default
         * / strong border (+ disabled text), 400-600 = muted → secondary
         * text, 700-900 = body → primary text. See index.css for exact values.
         */
        ink: varScale('ink'),

        /*
         * Signal accent — electric cobalt #2563EB by default.
         * Used ONLY for: primary buttons, active nav states, in-progress status
         * signals, focus rings, and the issue-key chip. Everything else is ink.
         *
         * Why this hue: sits between true-blue and engineering-blue.
         * Reads as "signal", "priority", "active dispatch" — not generic SaaS
         * indigo (#6366f1 which reads purple), not teal/cyan (old brand),
         * not sky-blue (too soft). Passes WCAG AA on white at all weights ≥500.
         *
         * CSS-var backed so runtime theming can swap the full 50–900 scale
         * when a workspace sets a custom brandColor (`applyBrandColor.ts`) —
         * that function is dark-mode-aware too: it mixes toward the dark
         * canvas/paper endpoints instead of white/black when `.dark` is
         * active, so a custom brand color composes correctly with dark mode.
         */
        signal: varScale('signal'),

        /*
         * Legacy alias — kept so existing `brand-*` classes in components
         * continue to resolve without a mass find-replace. Points to signal vars.
         */
        brand: varScale('signal'),

        /*
         * Status-progression palette — semantic signal arc.
         * todo: graphite (queued, resting)
         * inprogress: cobalt (dispatched, in motion) — inherits signal accent
         * done: eucalyptus (resolved, arrived)
         */
        status: {
          todo:            withOpacity('--nl-status-todo-dot'),
          'todo-bg':       withOpacity('--nl-canvas'),
          inprogress:      withOpacity('--nl-signal-600'),
          'inprogress-bg': withOpacity('--nl-signal-50'),
          done:            withOpacity('--nl-status-done-dot'),
          'done-bg':       withOpacity('--nl-emerald-100'),
        },

        /*
         * Neutral/semantic Tailwind-default scales, re-pointed at CSS vars so
         * every existing `slate-*` / `red-*` / `amber-*` / `emerald-*` /
         * `green-*` / `blue-*` / `gray-*` / `orange-*` usage across the app
         * (badges, chips, status text, form validation, chart colors) gets
         * dark-mode-legible values automatically — the "handful of stragglers
         * that bypass tokens" fixed once at the token layer instead of
         * hundreds of per-component edits. Light-mode values are byte-
         * identical to Tailwind's stock palette (see index.css `:root`).
         */
        slate:   varScale('slate'),
        red:     varScale('red'),
        amber:   varScale('amber'),
        emerald: varScale('emerald'),
        green:   varScale('green'),
        blue:    varScale('blue'),
        gray:    varScale('gray'),
        orange:  varScale('orange'),

        /*
         * Surface — replaces the many hardcoded `bg-white` card/input/modal
         * backgrounds with a token that becomes a dark elevated surface in
         * dark mode. `white` itself is left untouched (Tailwind default,
         * literal #fff) because `text-white` is deliberately used for
         * high-contrast text on colored buttons/badges in BOTH modes.
         */
        surface: {
          DEFAULT: withOpacity('--nl-surface'),
          raised:  withOpacity('--nl-surface-raised'),
          overlay: withOpacity('--nl-surface-overlay'),
        },
        canvas: withOpacity('--nl-canvas'),

        /**
         * Scrim — modal/drawer backdrop dimmer. Deliberately NOT dark-mode
         * aware (same value in both modes): a translucent near-black overlay
         * correctly dims the page whether the canvas underneath is light or
         * already dark. Decoupled from `ink-900` (which DOES flip to a light
         * text color in dark mode) specifically so backdrops never invert.
         */
        scrim: withOpacity('--nl-scrim'),
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
        /*
         * 2-tier shadow system — ink-tinted, not warm gray. CSS-var backed
         * (see index.css `:root`/`.dark`) so dark mode can swap soft ambient
         * shadows (which read as "muddy" on a dark canvas) for a crisp
         * 1px border-tinted shadow instead — per CLAUDE.md's design-elevation
         * guidance, "reduce/replace shadows with borders in dark".
         */
        'xs':        'var(--nl-shadow-xs)',
        'sm':        'var(--nl-shadow-sm)',
        'card':      'var(--nl-shadow-card)',
        'cardHover': 'var(--nl-shadow-cardHover)',
        'modal':     'var(--nl-shadow-modal)',
        'dropdown':  'var(--nl-shadow-dropdown)',
        'signal':    'var(--nl-shadow-signal)',  /* cobalt glow for focus */
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
