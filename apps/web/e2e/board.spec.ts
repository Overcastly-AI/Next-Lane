import { test, expect } from '@playwright/test';
import {
  openDemoBoard,
  setupIsolatedProject,
  createIssue,
  openProjectBoard,
  API_URL,
} from './helpers';

test.describe('Kanban board', () => {
  test('renders columns and issue cards', async ({ page }) => {
    // Read-only against the shared demo project — safe, no writes.
    await openDemoBoard(page);
    await expect(page.getByText(/to do/i).first()).toBeVisible();
    await expect(page.getByText(/in progress/i).first()).toBeVisible();
    await expect(page.getByText(/done/i).first()).toBeVisible();
    // At least one issue card with a project key is present.
    await expect(page.getByText(/NL-\d+/).first()).toBeVisible();
  });

  test('can create a new issue and it appears on the board', async ({
    page,
    request,
  }) => {
    // Isolated project so the create does not pollute the demo.
    await setupIsolatedProject(page, request, { label: 'board' });
    const title = `QA board ${Date.now()}`;
    await page.getByRole('button', { name: /\+ Create issue/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Title').fill(title);
    await dialog.getByRole('button', { name: 'Create' }).click();
    // The newly created card shows up (self-contained: does not depend on seed data).
    await expect(page.getByText(title).first()).toBeVisible({ timeout: 10_000 });
  });

  test('shows a Blocked badge on a card with an unresolved blocker', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'blocked',
      openBoard: false,
    });
    const blocker = await createIssue(request, ctx.token, ctx.project.id, {
      title: 'The blocker',
    });
    const blocked = await createIssue(request, ctx.token, ctx.project.id, {
      title: 'The blocked one',
    });
    // blocker BLOCKS blocked → the blocked card should show the badge.
    const res = await request.post(
      `${API_URL}/api/issues/${blocker.id}/links`,
      {
        headers: { Authorization: `Bearer ${ctx.token}` },
        data: { target: blocked.id, type: 'BLOCKS' },
      },
    );
    expect(res.ok(), `link failed: ${res.status()}`).toBeTruthy();

    await openProjectBoard(page, ctx.project.id);

    const blockedCard = page
      .getByTestId('issue-card')
      .filter({ hasText: 'The blocked one' });
    await expect(blockedCard.getByTestId('issue-blocked-badge')).toBeVisible({
      timeout: 10_000,
    });
    // The blocker itself is not blocked.
    const blockerCard = page
      .getByTestId('issue-card')
      .filter({ hasText: 'The blocker' })
      .first();
    await expect(
      blockerCard.getByTestId('issue-blocked-badge'),
    ).toHaveCount(0);
  });

  test('pins a showOnCard custom field value as a chip', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'cardfield',
      openBoard: false,
    });
    // Create a SELECT field flagged showOnCard.
    const fieldRes = await request.post(
      `${API_URL}/api/projects/${ctx.project.id}/custom-fields`,
      {
        headers: { Authorization: `Bearer ${ctx.token}` },
        data: {
          name: 'Severity',
          type: 'SELECT',
          options: ['Low', 'High', 'Critical'],
          showOnCard: true,
        },
      },
    );
    expect(fieldRes.ok(), `field failed: ${fieldRes.status()}`).toBeTruthy();
    const field = await fieldRes.json();

    // Create an issue carrying a value for that field.
    const issueRes = await request.post(`${API_URL}/api/issues`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
      data: {
        projectId: ctx.project.id,
        title: 'Card with field',
        customFields: { [field.id]: 'Critical' },
      },
    });
    expect(issueRes.ok(), `issue failed: ${issueRes.status()}`).toBeTruthy();

    await openProjectBoard(page, ctx.project.id);

    const card = page
      .getByTestId('issue-card')
      .filter({ hasText: 'Card with field' });
    const chip = card.getByTestId('card-custom-field');
    await expect(chip).toBeVisible({ timeout: 10_000 });
    await expect(chip).toContainText('Severity');
    await expect(chip).toContainText('Critical');
  });
});
