import { test, expect } from '@playwright/test';
import { API_URL, setupIsolatedProject } from './helpers';

/**
 * page-templates.spec.ts
 *
 * Doc templates end-to-end: the built-in starters appear in a brand-new
 * workspace, choosing one pre-fills the title and creates a page whose
 * `{{tokens}}` are already substituted, and a project-scoped template is
 * offered alongside the inherited workspace ones.
 *
 * Runs on chromium-desktop AND mobile-chrome (playwright.config.ts), so the
 * picker is exercised at 390px too — a radio list inside a modal is exactly
 * the kind of thing that overflows on a phone.
 */

/** Today's date the way `{{date}}` renders it — local, zero-padded. */
function localIsoDate(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

test.describe('doc templates', () => {
  test('starters are seeded, and creating from one renders its tokens', async ({
    page,
    request,
  }) => {
    const { project } = await setupIsolatedProject(page, request, {
      label: 'doctpl',
      projectName: 'Doc Templates QA',
      openBoard: false,
    });

    await page.goto(`/projects/${project.id}/pages`);

    await test.step('the picker offers Blank plus the seeded starters', async () => {
      await page.getByTestId('page-create-first').click();
      const picker = page.getByTestId('create-page-template-picker');
      await expect(picker).toBeVisible();
      // Blank must stay the default so the pre-template behaviour is intact.
      await expect(page.getByTestId('create-page-template-blank')).toHaveAttribute(
        'aria-checked',
        'true',
      );
      await expect(
        picker.getByRole('radio', { name: /Meeting notes/ }),
      ).toBeVisible();
      await expect(picker.getByRole('radio', { name: /Runbook/ })).toBeVisible();

      // Rows must fit INSIDE the modal. A bare `grid` sizes its implicit
      // column to max-content, which pushed these wider than the dialog and
      // clipped every description mid-word (worst on a 390px phone). Compare
      // against the dialog, not the viewport — the modal is the real bound.
      const dialog = page.getByRole('dialog');
      const dialogBox = await dialog.boundingBox();
      const rowBox = await picker
        .getByRole('radio', { name: /Meeting notes/ })
        .boundingBox();
      expect(dialogBox).not.toBeNull();
      expect(rowBox).not.toBeNull();
      expect(rowBox!.x + rowBox!.width).toBeLessThanOrEqual(
        dialogBox!.x + dialogBox!.width + 1,
      );
    });

    await test.step('choosing a template pre-fills the title from its default', async () => {
      await page.getByTestId('create-page-template-picker')
        .getByRole('radio', { name: /Meeting notes/ })
        .click();
      await expect(page.getByTestId('create-page-title-input')).toHaveValue(
        `Meeting notes — ${localIsoDate()}`,
      );
    });

    await test.step('the created page has its tokens already substituted', async () => {
      await page.getByTestId('create-page-submit').click();
      await expect(page.getByTestId('page-title')).toHaveText(
        `Meeting notes — ${localIsoDate()}`,
      );
      const body = page.getByTestId('page-content');
      await expect(body).toContainText('Action items');
      // {{author}} resolved to the real user, and nothing is left unrendered.
      await expect(body).not.toContainText('{{');
    });
  });

  test('a typed title survives choosing a template', async ({ page, request }) => {
    // Regression guard: adopting the template's default title must never
    // clobber something the user already typed.
    const { project } = await setupIsolatedProject(page, request, {
      label: 'doctpl2',
      projectName: 'Doc Templates Typed',
      openBoard: false,
    });

    await page.goto(`/projects/${project.id}/pages`);
    await page.getByTestId('page-create-first').click();

    const titleInput = page.getByTestId('create-page-title-input');
    await titleInput.click();
    await titleInput.pressSequentially('My Own Title', { delay: 15 });

    await page
      .getByTestId('create-page-template-picker')
      .getByRole('radio', { name: /Runbook/ })
      .click();

    await expect(titleInput).toHaveValue('My Own Title');

    await page.getByTestId('create-page-submit').click();
    await expect(page.getByTestId('page-title')).toHaveText('My Own Title');
    // The body still comes from the chosen template.
    await expect(page.getByTestId('page-content')).toContainText('Rollback');
  });

  test('blank stays the default and still creates an empty page', async ({
    page,
    request,
  }) => {
    const { project } = await setupIsolatedProject(page, request, {
      label: 'doctpl3',
      projectName: 'Doc Templates Blank',
      openBoard: false,
    });

    await page.goto(`/projects/${project.id}/pages`);
    await page.getByTestId('page-create-first').click();
    await page.getByTestId('create-page-title-input').fill('Plain Doc');
    await page.getByTestId('create-page-submit').click();

    await expect(page.getByTestId('page-title')).toHaveText('Plain Doc');
    // An empty page renders the placeholder instead of a body node — asserting
    // on that is the real signal that NO template content was applied.
    await expect(page.getByText(/This page is empty/i)).toBeVisible();
  });

  test('a project template is offered above the inherited workspace ones', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'doctpl4',
      projectName: 'Doc Templates Scoped',
      openBoard: false,
    });

    // Create a project-local template via the API — this spec is about the
    // picker, not the management form.
    const res = await request.post(
      `${API_URL}/api/projects/${ctx.project.id}/page-templates`,
      {
        headers: { Authorization: `Bearer ${ctx.token}` },
        data: {
          name: 'Project Playbook',
          description: 'Only for this project',
          titleTemplate: 'Playbook: ',
          content: '# {{title}}\n\nProject-specific steps.\n',
        },
      },
    );
    expect(res.ok()).toBeTruthy();

    await page.goto(`/projects/${ctx.project.id}/pages`);
    await page.getByTestId('page-create-first').click();

    const picker = page.getByTestId('create-page-template-picker');
    await expect(picker.getByRole('radio', { name: /Project Playbook/ })).toBeVisible();

    // Project rows sort ahead of inherited workspace rows: index 0 is Blank,
    // index 1 must be the project's own template.
    const labels = await picker.getByRole('radio').allInnerTexts();
    expect(labels[0]).toContain('Blank page');
    expect(labels[1]).toContain('Project Playbook');
    expect(labels[1]).toContain('Project');
  });
});
