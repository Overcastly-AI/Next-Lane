/**
 * E2E coverage for @mention autocomplete in the comment composer.
 *
 * Flow:
 *  - User A owns a workspace+project; user B is a co-member.
 *  - A creates an issue and opens the issue drawer.
 *  - Typing `@` opens the member-picker dropdown.
 *  - Filtering by partial email narrows the list.
 *  - Keyboard navigation (ArrowDown / ArrowUp) moves selection.
 *  - Enter inserts `@<email>` and closes the picker.
 *  - Clicking a suggestion inserts it (mobile-friendly path).
 *  - Escape dismisses without inserting.
 *  - Submitting a comment with @<email> triggers a MENTIONED notification for B.
 *
 * Tests run on desktop AND mobile viewports via playwright.config.ts projects.
 */
import { test, expect } from '@playwright/test';
import {
  registerNewUser,
  createWorkspace,
  createProject,
  addWorkspaceMember,
  createIssue,
  login,
  API_URL,
} from './helpers';

/** Open an issue drawer for the given issue id on the project board. */
async function openIssueDrawer(
  page: import('@playwright/test').Page,
  projectId: string,
  issueId: string,
) {
  await page.goto(`/projects/${projectId}/board?issue=${issueId}`);
  // Wait for the comment composer to appear
  await expect(page.getByTestId('comment-composer')).toBeVisible({
    timeout: 15_000,
  });
}

test.describe('@mention autocomplete in comment composer', () => {
  /**
   * Shared setup: user A + user B in the same workspace+project.
   *
   * The unique part of user B's email (before the @) is guaranteed to be
   * something like "mention-b-<timestamp>-<random>". We use the first 18 chars
   * (the label portion "mention-b-") to filter without including spaces.
   */
  async function setup(
    request: import('@playwright/test').APIRequestContext,
    label = 'mention',
  ) {
    const userA = await registerNewUser(request, `${label}-a`);
    const userB = await registerNewUser(request, `${label}-b`);
    const workspaceId = await createWorkspace(request, userA.token);
    const project = await createProject(request, userA.token, workspaceId, {
      name: 'Mention Test Project',
    });
    await addWorkspaceMember(request, userA.token, workspaceId, userB.email);
    const issue = await createIssue(request, userA.token, project.id, {
      title: 'Issue with mention test',
    });
    // A prefix of user B's local email part (before the @) that uniquely
    // identifies B without containing spaces or ambiguity.
    // Email format: `${label}-b-<timestamp>-<random>@nextlane.dev`
    const bEmailLocal = userB.email.split('@')[0]; // e.g. "mention-b-<ts>-<rng>"
    // Use enough chars to be unique among users in this test
    const bFilterPrefix = bEmailLocal.slice(0, `${label}-b`.length + 1); // e.g. "mention-b-"
    return { userA, userB, project, issue, bFilterPrefix };
  }

  test('typing @ opens picker and selecting with Enter inserts @email token', async ({
    page,
    request,
  }) => {
    const { userA, userB, project, issue, bFilterPrefix } = await setup(request, 'enter');

    await login(page, { email: userA.email, password: userA.password });
    await openIssueDrawer(page, project.id, issue.id);

    const composer = page.getByTestId('comment-composer');

    // Type `@` — picker should appear
    await composer.click();
    await composer.pressSequentially('@', { delay: 30 });
    const picker = page.getByTestId('mention-picker');
    await expect(picker).toBeVisible({ timeout: 5_000 });

    // Type the unique email prefix for B to filter to just B
    await composer.pressSequentially(bFilterPrefix, { delay: 30 });

    // B should appear in the filtered list
    await expect(picker.getByText(userB.name)).toBeVisible({ timeout: 5_000 });

    // Press Enter to select the first (and only) match
    await composer.press('Enter');

    // Picker should close
    await expect(picker).not.toBeVisible();

    // Textarea should contain `@<userB.email>`
    await expect(composer).toHaveValue(
      new RegExp(`@${userB.email.replace(/[.+]/g, '\\$&')}`),
    );
  });

  test('Tab key also inserts the selected suggestion', async ({
    page,
    request,
  }) => {
    const { userA, userB, project, issue, bFilterPrefix } = await setup(request, 'tab');

    await login(page, { email: userA.email, password: userA.password });
    await openIssueDrawer(page, project.id, issue.id);

    const composer = page.getByTestId('comment-composer');
    await composer.click();
    // Type @ + B's unique email prefix to filter to just B
    await composer.pressSequentially(`@${bFilterPrefix}`, { delay: 30 });

    const picker = page.getByTestId('mention-picker');
    await expect(picker).toBeVisible({ timeout: 5_000 });
    await expect(picker.getByText(userB.name)).toBeVisible({ timeout: 5_000 });

    // Tab should insert
    await composer.press('Tab');
    await expect(picker).not.toBeVisible();
    await expect(composer).toHaveValue(
      new RegExp(`@${userB.email.replace(/[.+]/g, '\\$&')}`),
    );
  });

  test('Escape dismisses picker without inserting', async ({
    page,
    request,
  }) => {
    const { userA, userB, project, issue, bFilterPrefix } = await setup(request, 'esc');

    await login(page, { email: userA.email, password: userA.password });
    await openIssueDrawer(page, project.id, issue.id);

    const composer = page.getByTestId('comment-composer');
    await composer.click();
    await composer.pressSequentially(`@${bFilterPrefix}`, { delay: 30 });

    const picker = page.getByTestId('mention-picker');
    await expect(picker).toBeVisible({ timeout: 5_000 });
    await expect(picker.getByText(userB.name)).toBeVisible({ timeout: 5_000 });

    await composer.press('Escape');
    await expect(picker).not.toBeVisible();
    // textarea still has the raw typed text (@prefix), not a resolved email
    const val = await composer.inputValue();
    expect(val).not.toMatch(new RegExp(`@${userB.email.replace(/[.+]/g, '\\$&')}`));
  });

  test('ArrowDown/ArrowUp moves selection through the list', async ({
    page,
    request,
  }) => {
    const { userA, project, issue } = await setup(request, 'arrow');

    await login(page, { email: userA.email, password: userA.password });
    await openIssueDrawer(page, project.id, issue.id);

    const composer = page.getByTestId('comment-composer');
    await composer.click();
    // Type @ with no filter to show all co-members (userA + userB at minimum)
    await composer.pressSequentially('@', { delay: 30 });

    const picker = page.getByTestId('mention-picker');
    await expect(picker).toBeVisible({ timeout: 5_000 });

    // First option is selected by default (aria-selected="true")
    const firstOption = page.getByTestId('mention-option-0');
    await expect(firstOption).toHaveAttribute('aria-selected', 'true');

    // Arrow down moves to second
    await composer.press('ArrowDown');
    const secondOption = page.getByTestId('mention-option-1');
    await expect(secondOption).toHaveAttribute('aria-selected', 'true');
    await expect(firstOption).toHaveAttribute('aria-selected', 'false');

    // Arrow up goes back
    await composer.press('ArrowUp');
    await expect(firstOption).toHaveAttribute('aria-selected', 'true');
  });

  test('clicking a suggestion inserts mention token (pointer/mobile path)', async ({
    page,
    request,
  }) => {
    const { userA, userB, project, issue, bFilterPrefix } = await setup(request, 'click');

    await login(page, { email: userA.email, password: userA.password });
    await openIssueDrawer(page, project.id, issue.id);

    const composer = page.getByTestId('comment-composer');
    await composer.click();
    // Filter to B only
    await composer.pressSequentially(`@${bFilterPrefix}`, { delay: 30 });

    const picker = page.getByTestId('mention-picker');
    await expect(picker).toBeVisible({ timeout: 5_000 });

    // Find and click user B's row in the picker
    const userBRow = picker.getByText(userB.name);
    await expect(userBRow).toBeVisible();
    await userBRow.click();

    await expect(picker).not.toBeVisible();
    await expect(composer).toHaveValue(
      new RegExp(`@${userB.email.replace(/[.+]/g, '\\$&')}`),
    );
    // Focus must stay on the textarea after click-insert
    await expect(composer).toBeFocused();
  });

  test('normal typing (no @) never shows picker', async ({
    page,
    request,
  }) => {
    const { userA, project, issue } = await setup(request, 'nopick');

    await login(page, { email: userA.email, password: userA.password });
    await openIssueDrawer(page, project.id, issue.id);

    const composer = page.getByTestId('comment-composer');
    await composer.click();
    await composer.pressSequentially('Hello world', { delay: 20 });

    await expect(page.getByTestId('mention-picker')).not.toBeVisible();
  });

  test('submitting comment with @mention triggers notification for mentioned user', async ({
    page,
    request,
  }) => {
    const { userA, userB, project, issue, bFilterPrefix } = await setup(request, 'notif');

    // --- A logs in and posts a comment @mentioning B ---
    await login(page, { email: userA.email, password: userA.password });
    await openIssueDrawer(page, project.id, issue.id);

    const composer = page.getByTestId('comment-composer');
    await composer.click();

    // Type the prelude, then `@<B's unique prefix>` to get B in the picker
    await composer.pressSequentially('Hey ', { delay: 20 });
    await composer.pressSequentially(`@${bFilterPrefix}`, { delay: 20 });
    const picker = page.getByTestId('mention-picker');
    await expect(picker).toBeVisible({ timeout: 5_000 });
    await expect(picker.getByText(userB.name)).toBeVisible({ timeout: 5_000 });

    // Select B via Enter
    await composer.press('Enter');
    await expect(picker).not.toBeVisible();

    // Confirm the email token is in the textarea
    await expect(composer).toHaveValue(
      new RegExp(`@${userB.email.replace(/[.+]/g, '\\$&')}`),
    );

    // Append a message body after the mention and submit
    await composer.pressSequentially(' please review', { delay: 20 });

    // Submit via the Comment button
    await page.getByRole('button', { name: /^comment$/i }).click();

    // Composer clears after submit
    await expect(composer).toHaveValue('');

    // --- B logs in and sees the MENTIONED notification ---
    await login(page, { email: userB.email, password: userB.password });

    const badge = page.getByTestId('notification-badge');
    await expect(badge).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: /notifications/i }).click();
    const panel = page.getByRole('menu', { name: /notifications/i });
    await expect(panel).toBeVisible();
    await expect(panel.getByText(/mentioned you/i)).toBeVisible();
  });

  test('focus is retained in textarea while picker is open (no focus-loss regression)', async ({
    page,
    request,
  }) => {
    const { userA, userB, project, issue, bFilterPrefix } = await setup(request, 'focus');

    await login(page, { email: userA.email, password: userA.password });
    await openIssueDrawer(page, project.id, issue.id);

    const composer = page.getByTestId('comment-composer');
    await composer.click();

    // Type @ per-keystroke to catch any focus-loss bug
    await composer.pressSequentially('@', { delay: 30 });
    const picker = page.getByTestId('mention-picker');
    await expect(picker).toBeVisible({ timeout: 5_000 });

    // Keep typing — textarea must remain focused throughout
    for (const ch of bFilterPrefix) {
      await composer.pressSequentially(ch, { delay: 30 });
      await expect(composer).toBeFocused();
    }
  });
});
