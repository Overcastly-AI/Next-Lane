import { describe, expect, it } from 'vitest';
import { computeDropdownPlacement, type DropdownPlacementInput } from './caretCoordinates';

// `getCaretCoordinates` builds a hidden mirror <div> and reads its computed
// layout — that needs a real DOM/layout engine, which this repo's vitest
// config deliberately doesn't provide (environment: 'node', see
// vitest.config.ts). `computeDropdownPlacement` is the pure placement math
// extracted specifically so the flip/clamp behavior — the part most likely
// to regress — is fully unit-testable without one.

const base: DropdownPlacementInput = {
  textareaRect: { top: 100, left: 50, width: 600, height: 800 },
  caret: { top: 40, left: 20, height: 20 },
  scrollTop: 0,
  scrollLeft: 0,
  dropdownWidth: 320,
  dropdownHeight: 224,
  viewportWidth: 1280,
  viewportHeight: 900,
};

describe('computeDropdownPlacement', () => {
  it('places the dropdown just below the caret line when there is room below', () => {
    const result = computeDropdownPlacement(base);
    expect(result.placement).toBe('below');
    // caretViewportTop = 100 + 40 - 0 = 140; caretBottom = 160; + gap(4) = 164
    expect(result.top).toBe(164);
    expect(result.left).toBe(70); // textareaRect.left(50) + caret.left(20)
  });

  it('flips above the caret when the caret is near the bottom of the viewport (the reported bug)', () => {
    // Regression case: a tall full-page textarea, caret scrolled deep into a
    // long document so it's near the BOTTOM of the visible viewport — this is
    // exactly the scenario the old `top-full` (bottom-of-textarea) anchor got
    // wrong, requiring a scroll to find the picker.
    const input: DropdownPlacementInput = {
      ...base,
      textareaRect: { top: 0, left: 50, width: 600, height: 900 },
      caret: { top: 820, left: 20, height: 20 }, // near the very bottom
      viewportHeight: 900,
    };
    const result = computeDropdownPlacement(input);
    expect(result.placement).toBe('above');
    // caretViewportTop = 0 + 820 = 820; above = 820 - 224 - 4 = 592
    expect(result.top).toBe(592);
    // Crucially: nowhere near the bottom of a 900px-tall textarea/viewport —
    // this is the assertion that would fail against the old bottom-anchored
    // implementation (which would put it at ~900, off-screen).
    expect(result.top).toBeLessThan(700);
  });

  it('accounts for the textarea being internally scrolled (scrollTop)', () => {
    // Caret coordinates are always in UNSCROLLED content space; a scrolled
    // textarea must subtract scrollTop to land at the caret's VISIBLE spot.
    const scrolled = computeDropdownPlacement({ ...base, caret: { top: 2040, left: 20, height: 20 }, scrollTop: 2000 });
    const unscrolled = computeDropdownPlacement({ ...base, caret: { top: 40, left: 20, height: 20 }, scrollTop: 0 });
    expect(scrolled.top).toBe(unscrolled.top);
    expect(scrolled.left).toBe(unscrolled.left);
  });

  it('clamps horizontally so the dropdown never overflows the right edge of the viewport', () => {
    const input: DropdownPlacementInput = {
      ...base,
      textareaRect: { top: 100, left: 50, width: 600, height: 800 },
      caret: { top: 40, left: 590, height: 20 }, // caret near the far right of a wide textarea
      viewportWidth: 700,
    };
    const result = computeDropdownPlacement(input);
    // maxLeft = 700 - 320 - 4 = 376
    expect(result.left).toBe(376);
    expect(result.left + input.dropdownWidth).toBeLessThanOrEqual(input.viewportWidth);
  });

  it('clamps horizontally so the dropdown never sits left of the viewport edge', () => {
    const input: DropdownPlacementInput = { ...base, textareaRect: { top: 100, left: -30, width: 600, height: 800 } };
    const result = computeDropdownPlacement(input);
    expect(result.left).toBeGreaterThanOrEqual(4);
  });

  it('clamps vertically so a below-flip near the very bottom of the viewport still fits', () => {
    const input: DropdownPlacementInput = {
      ...base,
      textareaRect: { top: 0, left: 50, width: 600, height: 900 },
      caret: { top: 700, left: 20, height: 20 },
      viewportHeight: 900,
      dropdownHeight: 224,
    };
    const result = computeDropdownPlacement(input);
    expect(result.top + input.dropdownHeight).toBeLessThanOrEqual(input.viewportHeight - 4 + 0.001);
    expect(result.top).toBeGreaterThanOrEqual(0);
  });

  it('prefers whichever side has more room when neither side fully fits a tall dropdown', () => {
    const input: DropdownPlacementInput = {
      ...base,
      textareaRect: { top: 0, left: 50, width: 600, height: 400 },
      caret: { top: 200, left: 20, height: 20 }, // caret roughly mid-viewport
      viewportHeight: 400,
      dropdownHeight: 300, // taller than either half
    };
    const result = computeDropdownPlacement(input);
    // spaceBelow (400 - 220 = 180) vs spaceAbove (200) — above has (slightly) more room.
    expect(result.placement).toBe('above');
  });
});
