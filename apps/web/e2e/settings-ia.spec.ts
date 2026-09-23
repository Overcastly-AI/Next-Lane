/**
 * settings-ia.spec.ts
 *
 * Covers the settings information architecture itself — the rail, the
 * redirects and the responsive collapse — as opposed to the sections it
 * navigates between, which their own specs already cover.
 *
 * This exists because the migration that split project settings into
 * grouped routes proved every section still WORKS, and proved nothing about
 * whether you can still FIND one. The rail, the `/settings` redirect and the
 * 393px select are the whole deliverable of that change; none of them had a
 * single assertion against them.
 *
 * The five group segments are written out literally rather than imported
 * from `settingsGroups.ts`. Importing the source of truth into its own test
 * means a typo in that file is mirrored by the test instead of caught by it.
 */
import { test, expect, type Page } from '@playwright/test';
import { setupIsolatedProject, type IsolatedContext } from './helpers';

/** One marker per group that ONLY that group renders. */
const GROUP_MARKERS: ReadonlyArray<{
  to: string;
  marker: (page: Page) => ReturnType<Page['locator']>;
}> = [
  { to: 'general', marker: (p) => p.locator('#settings-name') },
  { to: 'people', marker: (p) => p.getByTestId('members-section') },
  { to: 'work', marker: (p) => p.getByTestId('components-section') },
  { to: 'templates', marker: (p) => p.getByTestId('templates-manager') },
  { to: 'integrations', marker: (p) => p.getByTestId('github-section') },
];

async function isolated(page: Page, request: Parameters<typeof setupIsolatedProject>[1]): Promise<IsolatedContext> {
  return setupIsolatedProject(page, request, {
    label: 'settings-ia',
    projectName: `Settings IA QA ${Date.now()}`,
    openBoard: false,
  });
}

test.describe('Settings IA', () => {
  /*
   * `/projects/:id/settings` is in the docs site, the README, MCP output and
   * every deep link anyone has ever saved. The split must not break it.
   */
  test('the bare /settings URL still resolves, landing on General', async ({
    page,
    request,
  }) => {
    const ctx = await isolated(page, request);

    await page.goto(`/projects/${ctx.project.id}/settings`);
    await expect(page).toHaveURL(
      new RegExp(`/projects/${ctx.project.id}/settings/general$`),
      { timeout: 15_000 },
    );
    await expect(page.locator('#settings-name')).toBeVisible();
  });

  /*
   * Without the nested catch-all route, an unknown segment falls through to
   * the app-level `*` and ejects you to `/` — losing the project entirely.
   * Assert the URL, not merely that something rendered.
   */
  test('an unknown group redirects to General without leaving the project', async ({
    page,
    request,
  }) => {
    const ctx = await isolated(page, request);

    await page.goto(`/projects/${ctx.project.id}/settings/not-a-real-group`);
    await expect(page).toHaveURL(
      new RegExp(`/projects/${ctx.project.id}/settings/general$`),
      { timeout: 15_000 },
    );
    await expect(page.locator('#settings-name')).toBeVisible();
  });

  test('every group is reachable from the rail and renders its own content', async ({
    page,
    request,
  }) => {
    test.skip(
      test.info().project.name === 'mobile-chrome',
      'the rail collapses to a select below md — covered by its own test',
    );
    const ctx = await isolated(page, request);
    await page.goto(`/projects/${ctx.project.id}/settings/general`);
    await expect(page.getByTestId('settings-rail')).toBeVisible({
      timeout: 15_000,
    });

    for (const { to, marker } of GROUP_MARKERS) {
      await page.getByTestId(`settings-rail-${to}`).click();
      await expect(page).toHaveURL(
        new RegExp(`/projects/${ctx.project.id}/settings/${to}$`),
      );
      await expect(marker(page)).toBeVisible({ timeout: 15_000 });
    }
  });

  /*
   * A rail that only works after client-side navigation is a rail that breaks
   * on refresh — the exact class of bug the workspace-switcher suite exists
   * to catch. Load each URL cold.
   */
  test('every group deep-links cold', async ({ page, request }) => {
    const ctx = await isolated(page, request);

    for (const { to, marker } of GROUP_MARKERS) {
      await page.goto(`/projects/${ctx.project.id}/settings/${to}`);
      await expect(marker(page)).toBeVisible({ timeout: 15_000 });
    }
  });

  test('the active rail entry is marked, and only that one', async ({
    page,
    request,
  }) => {
    test.skip(
      test.info().project.name === 'mobile-chrome',
      'no rail below md',
    );
    const ctx = await isolated(page, request);

    await page.goto(`/projects/${ctx.project.id}/settings/work`);
    const rail = page.getByTestId('settings-rail');
    await expect(rail).toBeVisible({ timeout: 15_000 });

    await expect(page.getByTestId('settings-rail-work')).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(rail.locator('[aria-current="page"]')).toHaveCount(1);
  });

  test('at 393px the rail becomes a labelled select that navigates', async ({
    page,
    request,
  }) => {
    const ctx = await isolated(page, request);
    await page.setViewportSize({ width: 393, height: 852 });
    await page.goto(`/projects/${ctx.project.id}/settings/general`);

    const select = page.getByTestId('settings-rail-select');
    await expect(select).toBeVisible({ timeout: 15_000 });
    // The full rail must not compete with it for space or focus order.
    await expect(page.getByTestId('settings-rail')).toBeHidden();

    await select.selectOption('integrations');
    await expect(page).toHaveURL(
      new RegExp(`/projects/${ctx.project.id}/settings/integrations$`),
    );
    await expect(page.getByTestId('github-section')).toBeVisible({
      timeout: 15_000,
    });

    // No horizontal page scroll at phone width.
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow, 'horizontal overflow at 393px').toBeLessThanOrEqual(0);
  });
});
