import { test, expect } from '@playwright/test';
import {
  API_URL,
  addWorkspaceMember,
  createIssue,
  createProject,
  createWorkspace,
  login,
  registerNewUser,
  setupIsolatedProject,
} from './helpers';
import { editorMarkdown, editorSurface, typeInEditor } from './editor';

/**
 * Regressions from the independent QA round on the rich editor
 * (docs/BACKLOG.md § Already Done, "Rich editor QA round").
 */

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const IMG = 'https://example.com/a.png';

async function issueWith(request: import('@playwright/test').APIRequestContext, token: string, projectId: string, description: string, title = 'QA') {
  const issue = await createIssue(request, token, projectId, { title });
  await request.patch(`${API_URL}/api/issues/${issue.id}`, { headers: auth(token), data: { description } });
  return issue;
}
async function stored(request: import('@playwright/test').APIRequestContext, token: string, id: string) {
  const r = await request.get(`${API_URL}/api/issues/${id}`, { headers: auth(token) });
  return ((await r.json()) as { description: string | null }).description;
}

test.describe('P1 — block atoms at the edges of a document', () => {
  for (const [name, desc, kept] of [
    ['image last', `text\n\n![pic](${IMG})`, `![pic](${IMG})`],
    ['raw-HTML comment last', 'text\n\n<!-- keep me -->', '<!-- keep me -->'],
    ['image only', `![solo](${IMG})`, `![solo](${IMG})`],
  ] as const) {
    test(`opening and typing straight away keeps the ${name}`, async ({ page, request }) => {
      const ctx = await setupIsolatedProject(page, request, { label: 'qa-edge', openBoard: false });
      const issue = await issueWith(request, ctx.token, ctx.project.id, desc);
      await page.goto(`/projects/${ctx.project.id}/board?issue=${issue.id}`);
      await page.getByRole('button', { name: 'Edit description' }).click();
      await expect(editorSurface(page, 'description-editor')).toBeFocused({ timeout: 15_000 });
      await page.keyboard.type('hello', { delay: 10 });
      await page.getByTestId('issue-title-input').click();
      await expect.poll(() => stored(request, ctx.token, issue.id)).toContain('hello');
      expect(await stored(request, ctx.token, issue.id)).toContain(kept);
    });
  }

  test('Ctrl+Home on a doc that starts with a raw-HTML block keeps it', async ({ page, request }) => {
    const ctx = await setupIsolatedProject(page, request, { label: 'qa-start', openBoard: false });
    const issue = await issueWith(request, ctx.token, ctx.project.id, '<!-- first -->\n\nbody');
    await page.goto(`/projects/${ctx.project.id}/board?issue=${issue.id}`);
    await page.getByRole('button', { name: 'Edit description' }).click();
    await expect(editorSurface(page, 'description-editor')).toBeFocused({ timeout: 15_000 });
    await page.keyboard.press('Control+Home');
    await page.keyboard.type('top', { delay: 10 });
    await page.getByTestId('issue-title-input').click();
    await expect.poll(() => stored(request, ctx.token, issue.id)).toContain('top');
    expect(await stored(request, ctx.token, issue.id)).toContain('<!-- first -->');
  });

  test('consecutive block images stay separate after an edit, with no editor errors', async ({ page, request }) => {
    const { project, token } = await setupIsolatedProject(page, request, { label: 'qa-imgs', openBoard: false });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const content = `![a](${IMG})\n\n![b](${IMG}?2)\n\n![c](${IMG}?3)\n\nend`;
    const r = await request.post(`${API_URL}/api/projects/${project.id}/pages`, { headers: auth(token), data: { title: 'Imgs', content } });
    const { id } = (await r.json()) as { id: string };
    await page.goto(`/projects/${project.id}/pages/${id}`);
    await page.getByTestId('page-edit').click();
    await expect(editorSurface(page, 'page-content-editor')).toBeFocused({ timeout: 15_000 });
    expect(await editorSurface(page, 'page-content-editor').evaluate((el) => Array.from(el.children).filter((c) => c.tagName === 'IMG' && !c.classList.contains('ProseMirror-separator')).length)).toBe(0);
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' more', { delay: 10 });
    await page.getByTestId('page-save').click();
    await expect(page.getByTestId('page-edit')).toBeVisible();
    const saved = (await (await request.get(`${API_URL}/api/pages/${id}`, { headers: auth(token) })).json()) as { content: string };
    expect(saved.content).toBe(`${content} more`);
    expect(errors).toEqual([]);
  });
});

test.describe('P2 — input and pickers', () => {
  test('`- [ ] text` typed per keystroke is a task item and is stored as one', async ({ page, request }) => {
    const ctx = await setupIsolatedProject(page, request, { label: 'qa-task', openBoard: false });
    const issue = await createIssue(request, ctx.token, ctx.project.id, { title: 'Tasks' });
    await page.goto(`/projects/${ctx.project.id}/board?issue=${issue.id}`);
    await expect(page.getByTestId('comment-composer')).toBeVisible({ timeout: 15_000 });
    await typeInEditor(page, 'comment-composer', '- [ ] do thing\nand more');
    await expect(editorSurface(page, 'comment-composer').locator('ul[data-type="taskList"] li')).toHaveCount(2);
    expect(await editorMarkdown(page, 'comment-composer')).toBe('- [ ] do thing\n- [ ] and more');
  });

  test('a resting pointer does not hijack the active mention option', async ({ page, request }, info) => {
    const a = await registerNewUser(request, 'qa-hov-a');
    const ws = await createWorkspace(request, a.token);
    const project = await createProject(request, a.token, ws, { name: 'Hover' });
    for (const l of ['b', 'c', 'd']) {
      const u = await registerNewUser(request, `qa-hov-${l}`);
      await addWorkspaceMember(request, a.token, ws, u.email);
    }
    const issue = await createIssue(request, a.token, project.id, { title: 'Hover' });
    await login(page, { email: a.email, password: a.password });
    await page.goto(`/projects/${project.id}/board?issue=${issue.id}`);
    await expect(page.getByTestId('comment-composer')).toBeVisible({ timeout: 15_000 });
    await typeInEditor(page, 'comment-composer', '@');
    const third = page.getByTestId('mention-option-2');
    await expect(third).toBeVisible();
    const box = (await third.boundingBox())!;
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('mention-picker')).toHaveCount(0);
    // Park the pointer where the third option will appear, then open again.
    if (!info.project.name.includes('mobile')) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.press('Backspace');
    await page.keyboard.type('@', { delay: 20 });
    await expect(page.getByTestId('mention-picker')).toBeVisible();
    await expect(editorSurface(page, 'comment-composer')).toHaveAttribute('aria-activedescendant', 'mention-option-0');
    // A REAL pointer move still highlights.
    if (!info.project.name.includes('mobile')) {
      const second = page.getByTestId('mention-option-1');
      const b2 = (await second.boundingBox())!;
      await page.mouse.move(b2.x + 20, b2.y + 5);
      await page.mouse.move(b2.x + 24, b2.y + 8);
      await expect(second).toHaveAttribute('aria-selected', 'true');
    }
  });

  test('typing immediately after opening never loses characters (cold page loads)', async ({ page, request }) => {
    const ctx = await setupIsolatedProject(page, request, { label: 'qa-boot', openBoard: false });
    const issue = await createIssue(request, ctx.token, ctx.project.id, { title: 'Boot' });
    for (let i = 0; i < 6; i++) {
      await page.goto(`/projects/${ctx.project.id}/board?issue=${issue.id}`);
      await expect(page.getByTestId('description-empty')).toBeVisible();
      await page.getByTestId('description-empty').click();
      await page.keyboard.type('ABCDEFGH', { delay: 0 }); // no wait at all
      await expect(editorSurface(page, 'description-editor')).toHaveText('ABCDEFGH', { timeout: 20_000 });
      await page.keyboard.press('Escape'); // discard, next round starts clean
    }
  });
});

test.describe('P2 — Escape keeps unsent work', () => {
  test('comment draft survives the first Escape; empty composer lets Escape close the drawer', async ({ page, request }) => {
    const ctx = await setupIsolatedProject(page, request, { label: 'qa-esc', openBoard: false });
    const issue = await createIssue(request, ctx.token, ctx.project.id, { title: 'Esc' });
    await page.goto(`/projects/${ctx.project.id}/board?issue=${issue.id}`);
    await expect(page.getByTestId('comment-composer')).toBeVisible({ timeout: 15_000 });
    await typeInEditor(page, 'comment-composer', 'an unsent thought');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('comment-composer')).toHaveText('an unsent thought');
    await expect(page.getByTestId('comment-composer')).not.toBeFocused();
    // Clear it: now Escape closes the drawer as it always did.
    await editorSurface(page, 'comment-composer').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('comment-composer')).toHaveCount(0);
  });

  test('Create issue: Escape in the description keeps the modal and its text; Title is autofocused', async ({ page, request }) => {
    await setupIsolatedProject(page, request, { label: 'qa-esc2' });
    await page.getByRole('button', { name: /\+ Create issue/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Title')).toBeFocused();
    await dialog.getByLabel('Title').pressSequentially('Keep me', { delay: 5 });
    await typeInEditor(dialog, 'create-issue-description', 'half-written detail');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await expect(editorSurface(dialog, 'create-issue-description')).toHaveText('half-written detail');
  });
});

test.describe('P2 — mobile toolbar affordance', () => {
  test('a tappable "more tools" cue reveals the hidden tools at 393px', async ({ page, request }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    const ctx = await setupIsolatedProject(page, request, { label: 'qa-more', openBoard: false });
    const issue = await createIssue(request, ctx.token, ctx.project.id, { title: 'More' });
    await page.goto(`/projects/${ctx.project.id}/board?issue=${issue.id}`);
    await page.getByRole('button', { name: 'Edit description' }).click();
    const frame = page.getByTestId('description-editor-frame');
    const more = frame.getByTestId('editor-tools-more');
    await expect(more).toBeVisible();
    const table = frame.getByTestId('editor-tool-table');
    const inView = async () => {
      const b = (await table.boundingBox())!;
      const f = (await frame.boundingBox())!;
      return b.x + b.width <= f.x + f.width + 1;
    };
    expect(await inView()).toBe(false);
    for (let i = 0; i < 6 && !(await inView()); i++) await more.click({ timeout: 3000 }).catch(() => {});
    await expect.poll(inView).toBe(true);
  });
});

test.describe('Small QA fixes', () => {
  test('long comment drafts scroll inside the composer instead of growing it', async ({ page, request }) => {
    const ctx = await setupIsolatedProject(page, request, { label: 'qa-grow', openBoard: false });
    const issue = await createIssue(request, ctx.token, ctx.project.id, { title: 'Grow' });
    await page.goto(`/projects/${ctx.project.id}/board?issue=${issue.id}`);
    const surface = editorSurface(page, 'comment-composer');
    await surface.click();
    await surface.evaluate((el) => {
      const dt = new DataTransfer();
      dt.setData('text/plain', Array.from({ length: 80 }, (_, i) => `line ${i} of a long pasted draft`).join('\n'));
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    const h = (await page.getByTestId('comment-composer-frame').boundingBox())!.height;
    expect(h).toBeLessThan(420);
  });

  test('pasted <img src="javascript:…"> is dropped; nl-image docs raise no failed requests', async ({ page, request }) => {
    const ctx = await setupIsolatedProject(page, request, { label: 'qa-paste', openBoard: false });
    const issue = await createIssue(request, ctx.token, ctx.project.id, { title: 'Paste' });
    const failed: string[] = [];
    page.on('requestfailed', (r) => { if (r.url().startsWith('nl-image')) failed.push(r.url()); });
    await page.goto(`/projects/${ctx.project.id}/board?issue=${issue.id}`);
    const surface = editorSurface(page, 'comment-composer');
    await surface.click();
    await surface.evaluate((el) => {
      const dt = new DataTransfer();
      dt.setData('text/html', '<p>safe <img src="javascript:alert(1)" alt="x"> text</p>');
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    expect(await editorMarkdown(page, 'comment-composer')).not.toContain('javascript:');

    const { project, token } = await setupIsolatedProject(page, request, { label: 'qa-nlimg', openBoard: false });
    const r = await request.post(`${API_URL}/api/projects/${project.id}/pages`, { headers: auth(token), data: { title: 'NL', content: 'x\n\n![s](nl-image:cmabc123)' } });
    const { id } = (await r.json()) as { id: string };
    await page.goto(`/projects/${project.id}/pages/${id}`);
    await page.getByTestId('page-edit').click();
    await expect(editorSurface(page, 'page-content-editor')).toBeFocused({ timeout: 15_000 });
    await page.waitForTimeout(500);
    expect(failed).toEqual([]);
  });

  test('dark mode: link colour is AA (>=4.5:1) in the editor and in read mode', async ({ page, request }) => {
    await page.addInitScript(() => localStorage.setItem('nl.theme', 'dark'));
    const ctx = await setupIsolatedProject(page, request, { label: 'qa-dark', openBoard: false });
    const issue = await issueWith(request, ctx.token, ctx.project.id, 'see [docs](https://example.com)');
    await page.goto(`/projects/${ctx.project.id}/board?issue=${issue.id}`);
    const ratio = async (sel: string) =>
      page.locator(sel).first().evaluate((a) => {
        const lum = (rgb: number[]) => {
          const [r, g, b] = rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const parse = (s: string) => (s.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
        const fg = parse(getComputedStyle(a).color);
        let bgEl: Element | null = a;
        let bg = [0, 0, 0, 0];
        while (bgEl) {
          const m = (getComputedStyle(bgEl).backgroundColor.match(/[\d.]+/g) ?? []).map(Number);
          if (m.length >= 3 && (m[3] === undefined || m[3] > 0.9)) { bg = m; break; }
          bgEl = bgEl.parentElement;
        }
        const [L1, L2] = [lum(fg), lum(bg.slice(0, 3))].sort((x, y) => y - x);
        return (L1 + 0.05) / (L2 + 0.05);
      });
    expect(await ratio('[data-testid="description-rendered"] a')).toBeGreaterThanOrEqual(4.5);
    await page.getByTestId('description-rendered').locator('p').first().click();
    await expect(editorSurface(page, 'description-editor')).toBeFocused();
    expect(await ratio('[data-testid="description-editor"] a')).toBeGreaterThanOrEqual(4.5);
  });
});
