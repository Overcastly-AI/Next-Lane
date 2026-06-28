/**
 * Runtime brand-color theming for workspace customization.
 *
 * Generates a full 50–900 signal scale from a single brandColor hex (treated
 * as the "600" anchor), then writes the CSS variables on documentElement so
 * every Tailwind class using `signal-*` or `brand-*` picks them up instantly.
 *
 * Scale-generation approach:
 *   - The input hex is placed at slot 600 (the "one bold action" anchor).
 *   - Slots 50–500 are linear interpolations toward white (mixing toward #ffffff).
 *   - Slots 700–900 are linear interpolations toward black (mixing toward #000000).
 *   - The mix percentages mirror the relative lightness steps of the default
 *     electric-cobalt scale, keeping the proportional feel across any hue.
 *
 * When brandColor is null or cleared, the inline overrides are removed so the
 * `:root` defaults in index.css (the original electric-cobalt values) take
 * effect — zero custom style leakage.
 */

// Proportion of white to mix into brandColor for each sub-600 shade.
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

// Proportion of black to mix into brandColor for each super-600 shade.
const BLACK_MIX: Record<string, number> = {
  '700': 0.108,
  '800': 0.288,
  '900': 0.435,
};

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

/** Mix [r,g,b] toward white by `t` (0 = original, 1 = full white). */
function mixWhite(r: number, g: number, b: number, t: number): string {
  const nr = Math.round(r + (255 - r) * t);
  const ng = Math.round(g + (255 - g) * t);
  const nb = Math.round(b + (255 - b) * t);
  return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`;
}

/** Mix [r,g,b] toward black by `t` (0 = original, 1 = full black). */
function mixBlack(r: number, g: number, b: number, t: number): string {
  const nr = Math.round(r * (1 - t));
  const ng = Math.round(g * (1 - t));
  const nb = Math.round(b * (1 - t));
  return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`;
}

/**
 * Apply a brand color to the document root as a full 50–900 CSS-variable scale,
 * or remove the inline overrides when `brandColor` is null/undefined.
 *
 * Safe to call on every workspace switch; idempotent and synchronous.
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

  // Generate and apply each shade.
  for (const shade of shades) {
    let hex: string;
    if (shade === '600') {
      // Anchor shade — exact brand color.
      hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    } else if (shade in WHITE_MIX) {
      hex = mixWhite(r, g, b, WHITE_MIX[shade]);
    } else {
      hex = mixBlack(r, g, b, BLACK_MIX[shade]);
    }
    root.style.setProperty(`--nl-signal-${shade}`, hex);
  }
}
