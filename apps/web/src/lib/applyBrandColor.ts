/**
 * Runtime brand-color theming for workspace customization.
 *
 * Generates a full 50–900 signal scale from a single brandColor hex (treated
 * as the "600" anchor), then writes the CSS variables on documentElement so
 * every Tailwind class using `signal-*` or `brand-*` picks them up instantly.
 *
 * Scale-generation approach (LIGHT mode):
 *   - The input hex is placed at slot 600 (the "one bold action" anchor).
 *   - Slots 50–500 are linear interpolations toward white (mixing toward #ffffff).
 *   - Slots 700–900 are linear interpolations toward black (mixing toward #000000).
 *   - The mix percentages mirror the relative lightness steps of the default
 *     electric-cobalt scale, keeping the proportional feel across any hue.
 *
 * Scale-generation approach (DARK mode):
 *   - Same anchor-at-600 idea, but slots 50–500 mix toward the dark canvas
 *     color instead of white (so a brand-color "wash" reads as a dark tint,
 *     not a bright patch on a dark canvas) and slots 700–900 mix toward a
 *     bright paper tone instead of black (so brand-color text/icon shades
 *     stay vivid and legible against dark surfaces). This mirrors the same
 *     dark-scale derivation used for the built-in signal/red/amber/emerald/
 *     green/blue/orange scales in index.css's `.dark` block — same method,
 *     applied to whatever hue the workspace picked. This is what makes a
 *     custom brand color "compose correctly with dark mode" per the light/
 *     dark-mode acceptance criteria.
 *
 * Mode detection: reads `document.documentElement.classList.contains('dark')`
 * at call time. Callers (`WorkspaceContext`) re-invoke this whenever the
 * resolved theme changes, so toggling dark mode regenerates the brand scale
 * for the new mode without a reload.
 *
 * When brandColor is null or cleared, the inline overrides are removed so the
 * `:root` / `.dark` defaults in index.css (the built-in electric-cobalt
 * scale for the current mode) take effect — zero custom style leakage.
 */

// LIGHT mode — proportion of white to mix into brandColor for each sub-600 shade.
// Derived from the luminance distance of each default shade from the 600 anchor.
const WHITE_MIX: Record<string, number> = {
  '50':  0.934, // very faint wash
  '100': 0.868,
  '200': 0.749,
  '300': 0.584,
  '400': 0.375,
  '500': 0.136,
  // 600 = brand itself (0 mix)
};

// LIGHT mode — proportion of black to mix into brandColor for each super-600 shade.
const BLACK_MIX: Record<string, number> = {
  '700': 0.108,
  '800': 0.288,
  '900': 0.435,
};

// DARK mode — same anchor-at-600 idea, mixed toward the dark canvas (below
// anchor) / a bright paper tone (above anchor) instead of pure white/black.
// Matches the derivation used for index.css's `.dark` built-in scales.
const DARK_CANVAS_MIX: Record<string, number> = {
  '50':  0.90,
  '100': 0.82,
  '200': 0.68,
  '300': 0.50,
  '400': 0.28,
  '500': 0.08,
};
const DARK_PAPER_MIX: Record<string, number> = {
  '700': 0.28,
  '800': 0.52,
  '900': 0.74,
};
const DARK_CANVAS_RGB: [number, number, number] = [13, 15, 20]; // #0d0f14
const DARK_PAPER_RGB: [number, number, number] = [235, 238, 244]; // off-white, cool cast

/** Parse a `#RRGGBB` or `#RGB` hex string into [r, g, b] 0-255 channels. */
function hexToRgb(hex: string): [number, number, number] | null {
  const clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
    return [r, g, b];
  }
  if (clean.length === 6) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
    return [r, g, b];
  }
  return null;
}

/** Mix [r,g,b] toward a target [r,g,b] by `t` (0 = original, 1 = full target). */
function mixToward(r: number, g: number, b: number, target: [number, number, number], t: number): string {
  const [tr, tg, tb] = target;
  const nr = Math.round(r + (tr - r) * t);
  const ng = Math.round(g + (tg - g) * t);
  const nb = Math.round(b + (tb - b) * t);
  return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`;
}

/** Mix [r,g,b] toward white by `t` (0 = original, 1 = full white). */
function mixWhite(r: number, g: number, b: number, t: number): string {
  return mixToward(r, g, b, [255, 255, 255], t);
}

/** Mix [r,g,b] toward black by `t` (0 = original, 1 = full black). */
function mixBlack(r: number, g: number, b: number, t: number): string {
  return mixToward(r, g, b, [0, 0, 0], t);
}

/** Is dark mode currently active? (`.dark` class on <html>, see ThemeContext.) */
function isDarkModeActive(): boolean {
  return document.documentElement.classList.contains('dark');
}

/**
 * Apply a brand color to the document root as a full 50–900 CSS-variable scale,
 * or remove the inline overrides when `brandColor` is null/undefined.
 *
 * Safe to call on every workspace switch or theme toggle; idempotent and
 * synchronous. Reads the current mode (light/dark) from the `.dark` class on
 * `<html>` so the generated scale is always legible against the active canvas.
 */
export function applyBrandColor(brandColor: string | null | undefined): void {
  const root = document.documentElement;
  const shades = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900'];

  if (!brandColor) {
    // Restore defaults: remove any inline overrides.
    for (const shade of shades) {
      root.style.removeProperty(`--nl-signal-${shade}`);
    }
    return;
  }

  const rgb = hexToRgb(brandColor);
  if (!rgb) {
    // Unparseable color — remove overrides and fall back gracefully.
    for (const shade of shades) {
      root.style.removeProperty(`--nl-signal-${shade}`);
    }
    return;
  }

  const [r, g, b] = rgb;
  const dark = isDarkModeActive();
  const subMix = dark ? DARK_CANVAS_MIX : WHITE_MIX;
  const superMix = dark ? DARK_PAPER_MIX : BLACK_MIX;

  // Generate and apply each shade.
  for (const shade of shades) {
    let hex: string;
    if (shade === '600') {
      // Anchor shade — exact brand color, unchanged across modes.
      hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    } else if (shade in subMix) {
      hex = dark
        ? mixToward(r, g, b, DARK_CANVAS_RGB, subMix[shade])
        : mixWhite(r, g, b, subMix[shade]);
    } else {
      hex = dark
        ? mixToward(r, g, b, DARK_PAPER_RGB, superMix[shade])
        : mixBlack(r, g, b, superMix[shade]);
    }
    root.style.setProperty(`--nl-signal-${shade}`, hex);
  }
}
