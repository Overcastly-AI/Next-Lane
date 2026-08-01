import { test, expect, type Page } from '@playwright/test';
import { setupIsolatedProject } from './helpers';

/**
 * header-alignment.spec.ts
 *
 * The header's right-hand cluster — search trigger, notifications, quick links,
 * avatar — must be one row of equal-height controls.
 *
 * This exists because the search trigger was 40px while every neighbour was
 * 36px, so the ONE element in the group with a visible border was also the only
 * one standing 2px proud of the others top and bottom. Nobody had specified its
 * height; it was whatever the ⌘K chip computed to, and the chip was 26px tall
 * because a 10px glyph inherited the button's absolute 20px line-height.
 *
 * Asserting on geometry rather than on class names: the defect was a computed
 * height, and a class assertion would have passed throughout.
 */
async function headerControls(page: Page) {
  return page.evaluate(() => {
    const search = Array.from(document.querySelectorAll('header button')).find((b) =>
      /search/i.test(b.textContent || ''),
    );
    if (!search) return null;
    // The search trigger and everything AFTER it: notifications, quick links,
    // avatar. Deliberately not the whole parent — the brand wordmark also lives
    // there, and a logo is not a control that has to match a 36px row.
    const cluster: Element[] = [search];
    for (let el = search.nextElementSibling; el; el = el.nextElementSibling) cluster.push(el);
    const boxes = cluster
      .map((c) => {
        const r = c.getBoundingClientRect();
        return {
          label: (c.textContent || c.getAttribute('aria-label') || '').trim().slice(0, 16),
          h: Math.round(r.height),
          top: Math.round(r.top),
        };
      })
      // Hidden-at-this-viewport controls collapse to 0x0 and are not part of
      // the visual row.
      .filter((b) => b.h > 0);
    return {
      boxes,
      searchHeight: Math.round(search.getBoundingClientRect().height),
      kbdHeight: Math.round(search.querySelector('kbd')!.getBoundingClientRect().height),
    };
  });
}

test.describe('AppHeader — right-hand control cluster', () => {
  test('the search trigger is the same height and baseline as its neighbours', async ({
    page,
    request,
  }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile-chrome', 'the trigger is icon-only below sm');

    const { project } = await setupIsolatedProject(page, request, {
      label: 'hdr-align',
      projectName: 'Header Alignment QA',
    });
    await page.goto(`/projects/${project.id}/board`);
    await expect(page.getByRole('button', { name: /open command palette/i })).toBeVisible();

    const m = (await headerControls(page))!;
    expect(m, 'header cluster not found').toBeTruthy();

    // Every visible control in the cluster shares one height and one top edge.
    const heights = [...new Set(m.boxes.map((b) => b.h))];
    const tops = [...new Set(m.boxes.map((b) => b.top))];
    expect(heights, `mixed heights: ${JSON.stringify(m.boxes)}`).toHaveLength(1);
    expect(tops, `mixed baselines: ${JSON.stringify(m.boxes)}`).toHaveLength(1);
    expect(m.searchHeight).toBe(36);

    // The ⌘K chip must not be what decides the button's height. At 10px type it
    // has no business being 26px tall, which is what it was when it inherited
    // the button's absolute line-height.
    expect(m.kbdHeight).toBeLessThan(20);
    expect(m.kbdHeight).toBeLessThan(m.searchHeight);
  });
});
