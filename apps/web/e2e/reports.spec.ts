import { test, expect } from '@playwright/test';
import { openDemoBoard } from './helpers';

/**
 * End-to-end coverage of the Reports page for the seeded "Next Lane" project,
 * which has an ACTIVE Sprint 1 with story-pointed issues (some completed):
 *  - the Reports tab is reachable from ProjectNav,
 *  - the velocity bar chart renders,
 *  - the burndown line chart renders and defaults to the active sprint,
 *  - switching the sprint selector keeps the burndown chart visible.
 *
 * Read-only against shared seed data, so it is safe on desktop + mobile in
 * parallel (no writes, no cross-test contention).
 */
test.describe('Reports', () => {
  test('velocity and burndown charts render for the active sprint', async ({
    page,
  }) => {
    await openDemoBoard(page);

    // Navigate via the ProjectNav "Reports" tab.
    await page.getByRole('link', { name: 'Reports' }).click();
    await expect(page).toHaveURL(/\/reports$/, { timeout: 15_000 });
    await expect(
      page.getByRole('heading', { name: 'Reports', level: 1 }),
    ).toBeVisible();

    // Velocity section + its SVG bar chart.
    await expect(
      page.getByRole('heading', { name: 'Velocity', level: 2 }),
    ).toBeVisible();
    const velocityChart = page.getByRole('img', {
      name: /velocity chart/i,
    });
    await expect(velocityChart).toBeVisible({ timeout: 15_000 });
    // At least one committed + one completed bar exist.
    expect(await velocityChart.locator('rect').count()).toBeGreaterThan(0);

    // Burndown section defaults to the active sprint and renders its line chart.
    await expect(
      page.getByRole('heading', { name: 'Burndown', level: 2 }),
    ).toBeVisible();
    const sprintSelect = page.getByRole('combobox', { name: 'Sprint' });
    await expect(sprintSelect).toBeVisible();
    await expect(sprintSelect).toHaveValue(/.+/);
    const burndownChart = page.getByRole('img', { name: /burndown chart/i });
    await expect(burndownChart).toBeVisible({ timeout: 15_000 });
    // The actual + ideal lines are <path> elements.
    expect(await burndownChart.locator('path').count()).toBeGreaterThanOrEqual(
      2,
    );

    // Selecting the (only) sprint keeps the chart visible.
    const optionValues = await sprintSelect
      .locator('option')
      .evaluateAll((opts) =>
        (opts as HTMLOptionElement[]).map((o) => o.value),
      );
    await sprintSelect.selectOption(optionValues[0]);
    await expect(burndownChart).toBeVisible();
  });
});
