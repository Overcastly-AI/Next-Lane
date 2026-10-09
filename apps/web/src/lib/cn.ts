import clsx, { type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind-merge configured for this project's custom theme
 * (`tailwind.config.js`). Without these extensions custom keys fall through
 * to the wrong class group, e.g. `text-2xs` (font size) would be treated as a
 * text *color* and silently clobber/be clobbered by `text-ink-500`, and
 * `shadow-modal` would conflict with shadow colors.
 *
 * Colors (ink/signal/surface/...) need no registration: tailwind-merge's
 * color validator accepts any value, and our palette keys never collide with
 * size/shadow keys.
 */
// `bg-[right_0.5rem_center]` is a valid background-position arbitrary value but
// has no `position:` type hint, so tailwind-merge files it under bg *color* and
// it would then evict `bg-surface`. Recognise keyword-led position values.
const isKeywordPosition = (value: string) =>
  /^\[(?:right|left|center|top|bottom)[_\]]/.test(value);

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'bg-position': [{ bg: [isKeywordPosition] }],
      'font-size': [{ text: ['2xs'] }],
      shadow: [{ shadow: ['card', 'cardHover', 'modal', 'dropdown', 'signal'] }],
      animate: [
        {
          animate: [
            'nl-toast-in',
            'nl-drawer-in',
            'nl-modal-in',
            'nl-fade-in',
            'nl-card-merge-in',
          ],
        },
      ],
    },
  },
});

/**
 * clsx + tailwind-merge: composes conditional Tailwind classes and resolves
 * conflicts so a caller's `className` (e.g. `w-28`) reliably overrides a
 * primitive's defaults (e.g. Select's `w-full`).
 */
export function cn(...inputs: ClassValue[]): string {
  return unprotect(twMerge(protect(clsx(inputs))));
}

/**
 * tailwind-merge splits the class string on whitespace, but Tailwind allows
 * spaces inside arbitrary values (our inline-SVG select chevron
 * `bg-[url('data:image/svg+xml;utf8,<svg xmlns=... fill=...>')]` has many).
 * Naively merging would shred them, so swap whitespace inside `[...]` for a
 * placeholder char before merging and restore it afterwards.
 */
const SPACE = '\u0001';
function protect(classes: string): string {
  if (!classes.includes('[')) return classes;
  let depth = 0;
  let out = '';
  for (const ch of classes) {
    if (ch === '[') depth++;
    else if (ch === ']' && depth > 0) depth--;
    out += depth > 0 && /\s/.test(ch) ? SPACE : ch;
  }
  return out;
}
function unprotect(classes: string): string {
  return classes.includes(SPACE) ? classes.split(SPACE).join(' ') : classes;
}
