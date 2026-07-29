import { test, expect } from '@playwright/test';
import { openDemoBoard } from './helpers';

/**
 * End-to-end coverage of the Reports page for the seeded "Next Lane" project,
 * which has an ACTIVE Sprint 1 with story-pointed issues (some completed):
 *  - the Reports tab is reachable from ProjectNav,
 *  - the velocity bar chart renders,
 *  - the burndown line chart renders and defaults to the active sprint,
 *  - switching the sprint selector keeps the burndown chart visible,
 *  - the Cumulative Flow Diagram section renders with its stacked-area chart.
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
    await page.locator('nav[aria-label="Project navigation"]').getByRole('link', { name: 'Reports' }).click();
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

  test('cumulative flow chart renders with stacked areas and window selector', async ({
    page,
  }) => {
    await openDemoBoard(page);

    // Navigate to Reports.
    await page.locator('nav[aria-label="Project navigation"]').getByRole('link', { name: 'Reports' }).click();
    await expect(page).toHaveURL(/\/reports$/, { timeout: 15_000 });

    // Cumulative Flow section heading.
    await expect(
      page.getByRole('heading', { name: 'Cumulative Flow', level: 2 }),
    ).toBeVisible();

    // The CFD SVG chart should be present (either the chart or an empty state).
    // The demo project has issues so the chart should render.
    const cfdChart = page.getByRole('img', {
      name: /cumulative flow diagram/i,
    });
    await expect(cfdChart).toBeVisible({ timeout: 15_000 });

    // The stacked-area chart uses <path> for each band (3 bands: TODO,
    // IN_PROGRESS, DONE) plus <polyline> border strokes — at least 3 paths.
    expect(await cfdChart.locator('path').count()).toBeGreaterThanOrEqual(3);

    // The time-window selector should default to "Last 30 days".
    const windowSelect = page.getByRole('combobox', { name: /time window/i });
    await expect(windowSelect).toBeVisible();
    await expect(windowSelect).toHaveValue('30');

    // Switching to 14 days reloads the chart (still visible).
    await windowSelect.selectOption('14');
    await expect(cfdChart).toBeVisible({ timeout: 10_000 });

    // Switching to 90 days (may have more data points).
    await windowSelect.selectOption('90');
    await expect(cfdChart).toBeVisible({ timeout: 10_000 });
  });

  test('cumulative flow chart legend shows status categories', async ({
    page,
  }) => {
    await openDemoBoard(page);
    await page.locator('nav[aria-label="Project navigation"]').getByRole('link', { name: 'Reports' }).click();
    await expect(page).toHaveURL(/\/reports$/, { timeout: 15_000 });

    // Wait for chart to load.
    await expect(
      page.getByRole('img', { name: /cumulative flow diagram/i }),
    ).toBeVisible({ timeout: 15_000 });

    // Legend labels for all three categories must be visible.
    // Scope to the section via aria-labelledby to avoid matching SVG tooltip text.
    const cfdSection = page.locator('section[aria-labelledby="cfd-heading"]');
    // Use data-testid="cfd-legend-item" (set on LegendSwatch span) — stable
    // across design-system color/class changes.
    const legendItems = cfdSection.getByTestId('cfd-legend-item');
    await expect(legendItems.filter({ hasText: 'Done' })).toBeVisible();
    await expect(legendItems.filter({ hasText: 'In Progress' })).toBeVisible();
    await expect(legendItems.filter({ hasText: 'To Do' })).toBeVisible();
  });
});
