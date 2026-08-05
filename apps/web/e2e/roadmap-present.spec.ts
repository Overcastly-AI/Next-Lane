import { test, expect, type APIRequestContext } from '@playwright/test';
import { API_URL, setupIsolatedProject } from './helpers';

/**
 * Presenting mode: the roadmap on a screen in a room.
 *
 * The two things that can quietly break it are both structural rather than
 * visual — the app chrome creeping back in, and an edit affordance surviving
 * into a view that is supposed to be safe to leave in front of an audience.
 * Both are asserted here.
 */
function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function createIssue(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
): Promise<{ id: string; key: string }> {
  const res = await request.post(`${API_URL}/api/issues`, {
    headers: auth(token),
    data,
  });
  expect(res.ok(), `create issue failed: ${res.status()}`).toBeTruthy();
  return (await res.json()) as { id: string; key: string };
}

const iso = (d: string) => `${d}T00:00:00.000Z`;

test.describe('Roadmap presenting mode', () => {
  test('presents full-bleed, read-only, and comes back', async ({
    page,
    request,
  }) => {
    const { token, project } = await setupIsolatedProject(page, request, {
      label: 'rm-present',
      projectName: 'Roadmap Present QA',
      openBoard: false,
    });
    const epic = await createIssue(request, token, {
      projectId: project.id,
      type: 'EPIC',
      title: 'Presented Epic',
      startDate: iso('2026-04-01'),
      dueDate: iso('2026-04-30'),
    });

    await page.goto(`/projects/${project.id}/roadmap`);
    await expect(page.getByTestId('roadmap-epic-bar').first()).toBeVisible({
      timeout: 15_000,
    });

    // An ADMIN sees the edit affordances on the normal chart...
    await expect(page.getByTestId('roadmap-add-epic')).toBeVisible();

    await page.getByTestId('roadmap-present-link').click();
    await expect(page).toHaveURL(/\/roadmap\/present$/);
    await expect(page.getByTestId('roadmap-present')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('roadmap-epic-bar').first()).toBeVisible({
      timeout: 15_000,
    });

    // ...and none of them here, for the same user. Read-only is by
    // construction (no handlers passed), so this is the assertion that would
    // catch someone re-wiring them in.
    await expect(page.getByTestId('roadmap-add-epic')).toHaveCount(0);
    await expect(page.getByTestId('roadmap-link-handle')).toHaveCount(0);
    await expect(page.getByTestId('roadmap-epic-bar').first()).toHaveAttribute(
      'data-draggable',
      'false',
    );

    // Full-bleed: the app chrome is gone.
    await expect(page.getByTestId('nav-sidebar')).toHaveCount(0);
    await expect(page.getByTestId('nav-sidebar-drawer-toggle')).toHaveCount(0);

    // Diving into an epic still works — that is the point of presenting with a
    // mouse — and Escape must close the drawer WITHOUT also ending the
    // presentation, which would be a bad surprise in front of a room.
    await page.getByTestId('roadmap-epic-bar').first().click();
    await expect(page).toHaveURL(new RegExp(`issue=${epic.id}`));
    await page.keyboard.press('Escape');
    await expect(page).not.toHaveURL(new RegExp(`issue=${epic.id}`));
    await expect(page).toHaveURL(/\/roadmap\/present/);

    // A second Escape, with nothing left to close, stops presenting.
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/roadmap$/);
    await expect(page.getByTestId('roadmap-add-epic')).toBeVisible({
      timeout: 15_000,
    });
  });

  test('the exit control is reachable by keyboard and stops presenting', async ({
    page,
    request,
  }) => {
    const { token, project } = await setupIsolatedProject(page, request, {
      label: 'rm-present-kb',
      projectName: 'Roadmap Present KB QA',
      openBoard: false,
    });
    await createIssue(request, token, {
      projectId: project.id,
      type: 'EPIC',
      title: 'Keyboard Epic',
      startDate: iso('2026-04-01'),
      dueDate: iso('2026-04-30'),
    });

    await page.goto(`/projects/${project.id}/roadmap/present`);
    const exit = page.getByTestId('roadmap-present-exit');
    await expect(exit).toBeVisible({ timeout: 15_000 });

    /*
     * The chrome fades out when the pointer goes still. Focusing it must bring
     * it back and hold it: a keyboard user cannot move a mouse to recover the
     * control they are standing on.
     */
    await exit.focus();
    await page.waitForTimeout(3200);
    await expect(exit).toBeFocused();
    await expect(page.locator('#roadmap-present-chrome')).toHaveCSS(
      'opacity',
      '1',
    );

    await exit.press('Enter');
    await expect(page).toHaveURL(/\/roadmap$/);
  });
});
