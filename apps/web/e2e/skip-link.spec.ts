import { test, expect } from '@playwright/test';
import { setupIsolatedProject } from './helpers';

/**
 * skip-link.spec.ts
 *
 * The sidebar precedes page content in DOM order, so without a skip link a
 * keyboard user tabs through the workspace switcher, every project, every
 * project view and three more groups before reaching anything on the page —
 * measured at 10+ presses, scaling with project count, on every page load.
 *
 * Asserts the three things that make a skip link real rather than decorative:
 * it is the FIRST tab stop, it becomes VISIBLE on focus, and activating it
 * actually moves focus (not just the scroll position) — the last being the one
 * that is usually broken, because the target needs `tabindex="-1"` to accept
 * focus at all and without it the next Tab lands back in the sidebar.
 */
test.describe('Skip to content', () => {
  test('is the first tab stop, appears on focus, and moves focus to the page', async ({
    page,
    request,
  }) => {
    const { project } = await setupIsolatedProject(page, request, {
      label: 'skip-link',
      projectName: 'Skip Link QA',
    });
    await page.goto(`/projects/${project.id}/board`);
    await expect(page.getByTestId('skip-to-content')).toBeAttached();

    // Hidden until focused — it must not occupy space in the normal layout.
    const link = page.getByTestId('skip-to-content');
    await expect(link).not.toBeInViewport();

    // First Tab from the document body reaches it.
    await page.locator('body').press('Tab');
    await expect(link).toBeFocused();
    await expect(link).toBeInViewport();

    // Activating it moves FOCUS, not merely the scroll position.
    await link.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();

    // And the next Tab continues into the page rather than back into the
    // sidebar — the whole point of the exercise.
    await page.keyboard.press('Tab');
    const insideSidebar = await page.evaluate(() => {
      const el = document.activeElement;
      const main = document.getElementById('main-content');
      return !!(el && main && !main.contains(el));
    });
    expect(insideSidebar, 'focus escaped back out of the main region').toBe(false);
  });
});
