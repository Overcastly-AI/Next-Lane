import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
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
import { editorFrame, editorMarkdown, editorSurface, fillEditorMarkdown, typeInEditor } from './editor';

/**
 * rich-editor.spec.ts — the Tiptap editor, end to end, as a user drives it.
 *
 * The editor stores MARKDOWN and nothing else (server parsers, search, MCP
 * agents and MarkdownRenderer all read that string), so each test checks the
 * stored string through the API — not just what the editor shows — plus what a
 * reader later sees. Typing is per-keystroke on purpose: input rules (`## `,
 * `- `, `**bold**`, `[[link]]`) fire per key, and `.fill()` would skip them.
 */

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function getIssue(request: APIRequestContext, token: string, id: string) {
  const res = await request.get(`${API_URL}/api/issues/${id}`, { headers: auth(token) });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as { description: string | null };
}

async function openDrawer(page: Page, projectId: string, issueId: string) {
  await page.goto(`/projects/${projectId}/board?issue=${issueId}`);
  await expect(page.getByTestId('comment-composer')).toBeVisible({ timeout: 15_000 });
}

test.describe('Rich editor — typing with markdown input rules', () => {
  test('type markdown per keystroke → click away saves → stored markdown + rendered output survive a reload', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, { label: 'rich-rt', openBoard: false });
    const issue = await createIssue(request, ctx.token, ctx.project.id, { title: 'Rich round trip' });
    await openDrawer(page, ctx.project.id, issue.id);

    await page.getByRole('button', { name: 'Edit description' }).click();
    const surface = editorSurface(page, 'description-editor');
    await expect(surface).toBeFocused();

    // `## ` → heading, `- ` → list, Enter Enter leaves the list, then inline rules.
    await surface.pressSequentially('## Plan\n- first\nsecond\n\n', { delay: 15 });
    await surface.pressSequentially(
      'Ship **bold**, _it_ and `code` with [[Runbook]] — NL-12 snake_case #123 a < b',
      { delay: 12 },
    );

    // The structure appeared as it was typed.
    await expect(surface.locator('h2')).toHaveText('Plan');
    await expect(surface.locator('ul > li')).toHaveCount(2);
    await expect(surface.locator('strong')).toHaveText('bold');
    await expect(surface.locator('em')).toHaveText('it');
    await expect(surface.locator('code')).toHaveText('code');
    // (No wiki-link semantics in an issue description: `[[…]]` stays text.)
    await expect(surface).toContainText('[[Runbook]]');

    // Click away → saves (the same blur-to-save the textarea had).
    const patched = page.waitForResponse(
      (r) => r.url().includes(`/api/issues/${issue.id}`) && r.request().method() === 'PATCH',
    );
    await page.getByTestId('issue-title-input').click();
    await patched;

    const expected =
      '## Plan\n\n- first\n- second\n\nShip **bold**, *it* and `code` with [[Runbook]] — NL-12 snake_case #123 a < b';
    expect((await getIssue(request, ctx.token, issue.id)).description).toBe(expected);

    // Reload: the reader sees real formatting, and `NL-12` / `snake_case` /
    // `#123` / `a < b` came through as typed (not escaped into something else).
    await page.reload();
    const rendered = page.getByTestId('description-rendered');
    await expect(rendered.locator('h2')).toHaveText('Plan');
    await expect(rendered.locator('strong')).toHaveText('bold');
    await expect(rendered.locator('em')).toHaveText('it');
    await expect(rendered.locator('code')).toHaveText('code');
    await expect(rendered).toContainText('NL-12 snake_case #123 a < b');
    await expect(rendered).toContainText('[[Runbook]]');

    // And re-opening the editor shows the identical markdown.
    await rendered.click();
    expect(await editorMarkdown(page, 'description-editor')).toBe(expected);
  });

  test('Escape discards, and an unchanged description is never re-saved', async ({ page, request }) => {
    const ctx = await setupIsolatedProject(page, request, { label: 'rich-nowrite', openBoard: false });
    const issue = await createIssue(request, ctx.token, ctx.project.id, { title: 'No spurious write' });
    // Written the way an agent over MCP might write it: `_`/`*` spellings and
    // a loose list the editor would normalise if it ever re-serialised.
    const original = '* one\n\n* two\n\nSome _emphasis_ and __strong__\n\n| a | b |\n|---|---|\n| 1 | 2 |';
    await request.patch(`${API_URL}/api/issues/${issue.id}`, {
      headers: auth(ctx.token),
      data: { description: original },
    });
    await openDrawer(page, ctx.project.id, issue.id);

    const writes: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'PATCH' && r.url().includes(`/api/issues/${issue.id}`)) writes.push(r.postData() ?? '');
    });

    // Open, look, click away without typing: nothing is written.
    await page.getByTestId('description-rendered').click();
    await expect(editorSurface(page, 'description-editor')).toBeFocused();
    await page.getByTestId('issue-title-input').click();
    await expect(page.getByTestId('description-rendered')).toBeVisible();

    // Open, type a character and delete it again (a no-op edit): still no write,
    // and the stored string is byte-for-byte what it was.
    await page.getByTestId('description-rendered').click();
    await expect(editorSurface(page, 'description-editor')).toBeFocused();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('x', { delay: 20 });
    await expect(editorSurface(page, 'description-editor')).toContainText('x');
    await page.keyboard.press('Backspace');
    await page.getByTestId('issue-title-input').click();
    await expect(page.getByTestId('description-rendered')).toBeVisible();
    await page.waitForTimeout(400);
    expect(writes, 'opening/leaving an untouched description must not PATCH').toHaveLength(0);
    expect((await getIssue(request, ctx.token, issue.id)).description).toBe(original);

    // Escape throws an edit away.
    await page.getByTestId('description-rendered').click();
    await expect(editorSurface(page, 'description-editor')).toBeFocused();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' DISCARD ME', { delay: 15 });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('description-rendered')).toBeVisible();
    await page.waitForTimeout(400);
    expect(writes).toHaveLength(0);
    expect((await getIssue(request, ctx.token, issue.id)).description).toBe(original);
  });

  test('a page that is opened for editing and not changed cannot be saved (no phantom version)', async ({
    page,
    request,
  }) => {
    const { project, token } = await setupIsolatedProject(page, request, {
      label: 'rich-page-nowrite',
      openBoard: false,
    });
    const content = '* bullet\n\nSome _emphasis_\n\n| a | b |\n|---|---|\n| 1 | 2 |';
    const created = await request.post(`${API_URL}/api/projects/${project.id}/pages`, {
      headers: auth(token),
      data: { title: 'Untouched', content },
    });
    const { id } = (await created.json()) as { id: string };
    await page.goto(`/projects/${project.id}/pages/${id}`);
    await page.getByTestId('page-edit').click();
    await expect(editorSurface(page, 'page-content-editor')).toBeVisible();
    await expect(page.getByTestId('page-save')).toBeDisabled();

    // Type then delete: back to the loaded document, so still nothing to save.
    await expect(editorSurface(page, 'page-content-editor')).toBeFocused();
    await typeInEditor(page, 'page-content-editor', 'x', { click: false });
    await expect(page.getByTestId('page-save')).toBeEnabled();
    await page.keyboard.press('Backspace');
    await expect(page.getByTestId('page-save')).toBeDisabled();

    // A real edit saves the markdown, and only the edit changes.
    await page.keyboard.press('Control+End');
    await page.keyboard.type('more', { delay: 15 });
    await page.getByTestId('page-save').click();
    await expect(page.getByTestId('page-edit')).toBeVisible();
    const saved = (await (await request.get(`${API_URL}/api/pages/${id}`, { headers: auth(token) })).json()) as {
      content: string;
    };
    // (a real edit normalises: `*` -> `-`, `_x_` -> `*x*`, table padding)
    expect(saved.content).toBe(
      '- bullet\n\nSome *emphasis*\n\n| a   | b   |\n| --- | --- |\n| 1   | 2   |\n\nmore',
    );
    const versions = (await (
      await request.get(`${API_URL}/api/pages/${id}/versions`, { headers: auth(token) })
    ).json()) as { items: unknown[] };
    expect(versions.items).toHaveLength(2); // create + the one real save
  });
});

test.describe('Rich editor — @mentions and [[links]] reach the server in the stored form', () => {
  test('a picked @mention is stored as @email and notifies the member; the chip survives a reload', async ({
    page,
    request,
  }) => {
    const a = await registerNewUser(request, 'rmn-a');
    const b = await registerNewUser(request, 'rmn-b');
    const ws = await createWorkspace(request, a.token);
    const project = await createProject(request, a.token, ws, { name: 'Mention API' });
    await addWorkspaceMember(request, a.token, ws, b.email);
    const issue = await createIssue(request, a.token, project.id, { title: 'Mention me' });

    await login(page, { email: a.email, password: a.password });
    await openDrawer(page, project.id, issue.id);

    await typeInEditor(page, 'comment-composer', 'Hi ');
    await typeInEditor(page, 'comment-composer', `@${b.email.slice(0, 8)}`, { click: false });
    await expect(page.getByTestId('mention-picker')).toBeVisible();
    await page.getByTestId('mention-option-0').click();
    await expect(editorSurface(page, 'comment-composer').locator('.nl-mention')).toHaveText(`@${b.email}`);
    await editorSurface(page, 'comment-composer').pressSequentially('please look', { delay: 15 });
    await page.getByRole('button', { name: 'Comment', exact: true }).click();
    await expect(page.getByTestId('comment-body-rendered').first()).toContainText(b.email);

    // Stored exactly as the server's mention parser expects it…
    const comments = (await (
      await request.get(`${API_URL}/api/issues/${issue.id}/comments`, { headers: auth(a.token) })
    ).json()) as Array<{ body: string }>;
    expect(comments.map((c) => c.body)).toEqual([`Hi @${b.email} please look`]);
    // …so B is notified.
    await expect
      .poll(
        async () => {
          const res = await request.get(`${API_URL}/api/notifications`, { headers: auth(b.token) });
          const body = (await res.json()) as Array<{ type: string }> | { items?: Array<{ type: string }> };
          const list = Array.isArray(body) ? body : (body.items ?? []);
          return list.some((n) => n.type === 'MENTIONED');
        },
        { timeout: 15_000 },
      )
      .toBe(true);

    // Editing the comment later re-opens it with the mention as a chip again.
    const item = page.getByRole('listitem').filter({ hasText: 'please look' });
    await expect(item).toHaveCount(1); // the optimistic copy has been replaced
    await item.hover();
    await item.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(editorSurface(item, 'comment-edit-composer').locator('.nl-mention')).toHaveText(`@${b.email}`);
  });

  test('a picked [[wiki-link]] becomes a chip, is stored as [[Title]], and creates a backlink', async ({
    page,
    request,
  }) => {
    const { project, token } = await setupIsolatedProject(page, request, {
      label: 'rich-wiki',
      openBoard: false,
    });
    const mk = async (title: string, content = '') => {
      const r = await request.post(`${API_URL}/api/projects/${project.id}/pages`, {
        headers: auth(token),
        data: { title, content },
      });
      return (await r.json()) as { id: string };
    };
    const target = await mk('Architecture Overview', 'The target.');
    const hub = await mk('Hub', 'Start.');

    await page.goto(`/projects/${project.id}/pages/${hub.id}`);
    await page.getByTestId('page-edit').click();
    await expect(editorSurface(page, 'page-content-editor')).toBeFocused();
    await page.keyboard.press('Control+End');
    await typeInEditor(page, 'page-content-editor', ' See [[Arch', { click: false });
    await expect(page.getByTestId('wikilink-picker')).toBeVisible();
    await expect(page.getByTestId('wikilink-option-0')).toContainText('Architecture Overview');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('wikilink-picker')).toHaveCount(0);
    const chip = editorSurface(page, 'page-content-editor').locator('.nl-wikilink');
    await expect(chip).toHaveText('Architecture Overview');
    // Typing carries on right after the chip, in the same editor.
    await page.keyboard.type(' for details.', { delay: 12 });
    await page.getByTestId('page-save').click();
    await expect(page.getByTestId('page-edit')).toBeVisible();

    const saved = (await (await request.get(`${API_URL}/api/pages/${hub.id}`, { headers: auth(token) })).json()) as {
      content: string;
    };
    expect(saved.content).toBe('Start. See [[Architecture Overview]] for details.');
    await expect
      .poll(async () => {
        const res = await request.get(`${API_URL}/api/pages/${target.id}/backlinks`, { headers: auth(token) });
        const links = (await res.json()) as Array<{ sourcePageId: string }>;
        return links.some((l) => l.sourcePageId === hub.id);
      })
      .toBe(true);
    // Reader: a resolved, clickable link.
    await expect(page.locator(`.nl-page-content a[href="#page:${target.id}"]`)).toHaveText('Architecture Overview');

    // Typing the closing brackets by hand makes a chip too (no picker needed).
    await page.getByTestId('page-edit').click();
    await expect(editorSurface(page, 'page-content-editor')).toBeFocused();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' And [[Not Yet Written|alias]]', { delay: 12 });
    await expect(editorSurface(page, 'page-content-editor').locator('.nl-wikilink')).toHaveCount(2);
    expect(await editorMarkdown(page, 'page-content-editor')).toBe(
      'Start. See [[Architecture Overview]] for details. And [[Not Yet Written|alias]]',
    );
  });
});

test.describe('Rich editor — Markdown switch', () => {
  test('lossless both ways: raw source in, exact source out, edits carry across', async ({ page, request }) => {
    const ctx = await setupIsolatedProject(page, request, { label: 'rich-toggle', openBoard: false });
    const issue = await createIssue(request, ctx.token, ctx.project.id, { title: 'Toggle' });
    const source = [
      '## Notes',
      '',
      '- [ ] open task',
      '- [x] done task',
      '',
      '| col a | col b |',
      '| ----- | ----- |',
      '| `x`   | [[Page|alias]] |',
      '',
      '```ts',
      'const a = "<b>&</b>"; // _not_ *emphasis*',
      '```',
      '',
      '> quoted',
      '',
      'cc @someone@example.com — see NL-3, snake_case, #12',
      '<details>',
      '<summary>raw html stays</summary>',
      '',
      'inner',
      '',
      '</details>',
    ].join('\n');
    await request.patch(`${API_URL}/api/issues/${issue.id}`, {
      headers: auth(ctx.token),
      data: { description: source },
    });
    await openDrawer(page, ctx.project.id, issue.id);
    await page.getByTestId('description-rendered').click();

    const frame = editorFrame(page, 'description-editor');
    const surface = editorSurface(page, 'description-editor');
    await expect(surface.locator('table')).toBeVisible();
    await expect(surface.locator('ul[data-type="taskList"] li')).toHaveCount(2);

    // Rich → Markdown: byte-for-byte the stored string, even though the visual
    // editor would normalise parts of it (table padding, `_`/`*`…) if asked.
    await frame.getByTestId('editor-markdown-toggle').click();
    const raw = frame.getByTestId('description-editor-markdown');
    await expect(raw).toHaveValue(source);
    await expect(frame.getByTestId('editor-markdown-toggle')).toHaveAttribute('aria-pressed', 'true');

    // Edit the raw source, switch back: it is rendered, and the typed addition
    // is part of what is stored.
    await raw.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n\nAdded in **raw** mode', { delay: 10 });
    await frame.getByTestId('editor-markdown-toggle').click();
    await expect(surface.locator('strong').last()).toHaveText('raw');
    await expect(surface.locator('table')).toBeVisible();
    await expect(surface).toBeFocused();

    // …and once more, nothing was lost on the way back and forth.
    await frame.getByTestId('editor-markdown-toggle').click();
    await expect(raw).toHaveValue(`${source}\n\nAdded in **raw** mode`);

    // Leaving while in Markdown mode saves the raw string verbatim.
    const patched = page.waitForResponse(
      (r) => r.url().includes(`/api/issues/${issue.id}`) && r.request().method() === 'PATCH',
    );
    await page.getByTestId('issue-title-input').click();
    await patched;
    expect((await getIssue(request, ctx.token, issue.id)).description).toBe(
      `${source}\n\nAdded in **raw** mode`,
    );
  });

  test('toggle is keyboard reachable and announced', async ({ page, request }) => {
    const ctx = await setupIsolatedProject(page, request, { label: 'rich-a11y', openBoard: false });
    const issue = await createIssue(request, ctx.token, ctx.project.id, { title: 'A11y' });
    await openDrawer(page, ctx.project.id, issue.id);

    // The composer is a labelled multiline textbox.
    const box = page.getByRole('textbox', { name: 'Add a comment' });
    await expect(box).toHaveAttribute('aria-multiline', 'true');

    // Toolbar: role=toolbar, one tab stop, arrow keys move between tools.
    const toolbar = editorFrame(page, 'comment-composer').getByRole('toolbar', { name: 'Formatting' });
    await expect(toolbar).toBeVisible();
    await box.click();
    await page.keyboard.press('Shift+Tab'); // surface → Markdown switch
    await expect(editorFrame(page, 'comment-composer').getByTestId('editor-markdown-toggle')).toBeFocused();
    await page.keyboard.press('Shift+Tab'); // → the toolbar's single tab stop
    const bold = toolbar.getByRole('button', { name: 'Bold' });
    await expect(bold).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(toolbar.getByRole('button', { name: 'Italic' })).toBeFocused();
    await page.keyboard.press('Escape'); // back to writing
    await expect(box).toBeFocused();

    // Keyboard shortcuts format; the toolbar button reflects it.
    await page.keyboard.type('word', { delay: 15 });
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Control+B');
    await expect(bold).toHaveAttribute('aria-pressed', 'true');
    expect(await editorMarkdown(page, 'comment-composer')).toBe('**word**');
  });
});

test.describe('Rich editor — global shortcuts stay out of the way', () => {
  test('single-key app shortcuts do not fire while typing in the editor', async ({ page, request }) => {
    const ctx = await setupIsolatedProject(page, request, { label: 'rich-keys', openBoard: false });
    const issue = await createIssue(request, ctx.token, ctx.project.id, { title: 'Keys' });
    await openDrawer(page, ctx.project.id, issue.id);

    await typeInEditor(page, 'comment-composer', 'c j k g b ? / n e', { delay: 20 });
    await expect(editorSurface(page, 'comment-composer')).toHaveText('c j k g b ? / n e');
    // No "create issue" dialog / shortcuts help opened on top of the drawer.
    await expect(page.getByRole('dialog')).toHaveCount(1); // only the drawer itself
    await expect(editorSurface(page, 'comment-composer')).toBeFocused();
  });
});

test.describe('Rich editor — layout on small screens', () => {
  test('toolbar is usable at phone width: big targets, no page overflow, toggle in view', async ({
    page,
    request,
    isMobile,
  }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    const ctx = await setupIsolatedProject(page, request, { label: 'rich-mobile', openBoard: false });
    const issue = await createIssue(request, ctx.token, ctx.project.id, { title: 'Phone' });
    await openDrawer(page, ctx.project.id, issue.id);

    for (const id of ['comment-composer']) {
      const frame = editorFrame(page, id);
      await frame.scrollIntoViewIfNeeded();
      const frameBox = (await frame.boundingBox())!;
      expect(frameBox.x, 'editor must start inside the viewport').toBeGreaterThanOrEqual(0);
      expect(frameBox.x + frameBox.width, 'editor must not run off the right edge').toBeLessThanOrEqual(393 + 1);

      const buttons = frame.getByRole('toolbar', { name: 'Formatting' }).getByRole('button');
      const n = await buttons.count();
      expect(n).toBeGreaterThanOrEqual(6);
      for (let i = 0; i < n; i++) {
        const box = (await buttons.nth(i).boundingBox())!;
        expect(box.width, `tool ${i} width`).toBeGreaterThanOrEqual(40);
        expect(box.height, `tool ${i} height`).toBeGreaterThanOrEqual(40);
      }
      // The Markdown switch is always visible (it lives outside the scrolling strip).
      const toggle = frame.getByTestId('editor-markdown-toggle');
      const tb = (await toggle.boundingBox())!;
      expect(tb.x + tb.width).toBeLessThanOrEqual(393 + 1);
      expect(tb.height).toBeGreaterThanOrEqual(40);
    }

    // Nothing makes the page itself scroll sideways.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    // Tapping a tool does not dismiss the keyboard: focus stays in the editor.
    const surface = editorSurface(page, 'comment-composer');
    await surface.click();
    await surface.pressSequentially('tap', { delay: 20 });
    if (isMobile) await page.getByTestId('editor-tool-bold').first().tap();
    else await page.getByTestId('editor-tool-bold').first().click();
    await expect(surface).toBeFocused();
    await surface.pressSequentially('ped', { delay: 20 });
    expect(await editorMarkdown(page, 'comment-composer')).toBe('tap**ped**');
  });

  test('description editor and page canvas also fit at phone width', async ({ page, request }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    const ctx = await setupIsolatedProject(page, request, { label: 'rich-mobile2', openBoard: false });
    const issue = await createIssue(request, ctx.token, ctx.project.id, { title: 'Phone 2' });
    const pageRes = await request.post(`${API_URL}/api/projects/${ctx.project.id}/pages`, {
      headers: auth(ctx.token),
      data: { title: 'Phone page', content: '| a | b | c | d |\n| - | - | - | - |\n| 1 | 2 | 3 | 4 |' },
    });
    const { id: pageId } = (await pageRes.json()) as { id: string };

    await openDrawer(page, ctx.project.id, issue.id);
    await page.getByRole('button', { name: 'Edit description' }).click();
    await expect(editorSurface(page, 'description-editor')).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    const dbox = (await editorFrame(page, 'description-editor').boundingBox())!;
    expect(dbox.x + dbox.width).toBeLessThanOrEqual(394);

    await page.goto(`/projects/${ctx.project.id}/pages/${pageId}`);
    await page.getByTestId('page-edit').click();
    await expect(editorSurface(page, 'page-content-editor')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    const pbox = (await editorFrame(page, 'page-content-editor').boundingBox())!;
    expect(pbox.x + pbox.width).toBeLessThanOrEqual(394);
  });
});

test.describe('Rich editor — create issue and raw source', () => {
  test('Create issue: description typed with rules is stored as markdown', async ({ page, request }) => {
    const ctx = await setupIsolatedProject(page, request, { label: 'rich-create' });
    await page.getByRole('button', { name: /\+ Create issue/i }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Title').pressSequentially('Created with rich text', { delay: 10 });
    await typeInEditor(dialog, 'create-issue-description', '1. step one\nstep two\n\n> a quote with `code`', {
      delay: 12,
    });
    await expect(editorSurface(dialog, 'create-issue-description').locator('ol > li')).toHaveCount(2);
    await dialog.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    const list = (await (
      await request.get(`${API_URL}/api/issues?projectId=${ctx.project.id}`, { headers: auth(ctx.token) })
    ).json()) as { items?: Array<{ title: string; description: string | null }> } | Array<{ title: string; description: string | null }>;
    const items = Array.isArray(list) ? list : (list.items ?? []);
    const created = items.find((i) => i.title === 'Created with rich text');
    expect(created?.description).toBe('1. step one\n2. step two\n\n> a quote with `code`');
  });

  test('fillEditorMarkdown helper round-trips raw source through the visual editor', async ({ page, request }) => {
    const ctx = await setupIsolatedProject(page, request, { label: 'rich-helper', openBoard: false });
    const issue = await createIssue(request, ctx.token, ctx.project.id, { title: 'Helper' });
    await openDrawer(page, ctx.project.id, issue.id);
    await fillEditorMarkdown(page, 'comment-composer', '**x** and [[Y]]');
    await expect(editorSurface(page, 'comment-composer').locator('strong')).toHaveText('x');
    await expect(editorSurface(page, 'comment-composer')).toContainText('[[Y]]');
    expect(await editorMarkdown(page, 'comment-composer')).toBe('**x** and [[Y]]');
  });
});

test.describe('Rich editor — links, pasted markdown, image picker', () => {
  test('Ctrl+K adds a link, the toolbar edits it, and it is stored as a markdown link', async ({ page, request }) => {
    const ctx = await setupIsolatedProject(page, request, { label: 'rich-link', openBoard: false });
    const issue = await createIssue(request, ctx.token, ctx.project.id, { title: 'Links' });
    await openDrawer(page, ctx.project.id, issue.id);

    await typeInEditor(page, 'comment-composer', 'read the docs');
    await page.keyboard.press('Shift+Home');
    await page.keyboard.press('Control+K');
    const input = page.getByTestId('editor-link-input');
    await expect(input).toBeFocused();
    await input.pressSequentially('example.com/guide', { delay: 10 });
    await page.keyboard.press('Enter');
    await expect(editorSurface(page, 'comment-composer')).toBeFocused();
    const a = editorSurface(page, 'comment-composer').locator('a');
    await expect(a).toHaveAttribute('href', 'https://example.com/guide');
    expect(await editorMarkdown(page, 'comment-composer')).toBe('[read the docs](https://example.com/guide)');

    // Remove it again from the same bar.
    await a.click();
    await page.keyboard.press('Control+K');
    await page.getByTestId('editor-link-remove').click();
    await expect(a).toHaveCount(0);
    expect(await editorMarkdown(page, 'comment-composer')).toBe('read the docs');
  });

  test('pasted plain-text markdown becomes formatting; pasted code stays literal', async ({ page, request }) => {
    const ctx = await setupIsolatedProject(page, request, { label: 'rich-paste', openBoard: false });
    const issue = await createIssue(request, ctx.token, ctx.project.id, { title: 'Paste' });
    await openDrawer(page, ctx.project.id, issue.id);
    const surface = editorSurface(page, 'comment-composer');
    await surface.click();

    const paste = (text: string) =>
      surface.evaluate((el, t) => {
        const dt = new DataTransfer();
        dt.setData('text/plain', t);
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      }, text);

    await paste('## From a README\n\n- one\n- two\n\nsome **bold** text');
    await expect(surface.locator('h2')).toHaveText('From a README');
    await expect(surface.locator('ul > li')).toHaveCount(2);
    await expect(surface.locator('strong')).toHaveText('bold');
    expect(await editorMarkdown(page, 'comment-composer')).toBe(
      '## From a README\n\n- one\n- two\n\nsome **bold** text',
    );

    // Plain sentences are left exactly as the browser pastes them.
    await page.keyboard.press('Control+End');
    await paste(' plain_text with snake_case');
    await expect(surface).toContainText('plain_text with snake_case');
  });

  test('the image button opens the picker and uploads into the page', async ({ page, request }) => {
    const { project, token } = await setupIsolatedProject(page, request, { label: 'rich-img', openBoard: false });
    const created = await request.post(`${API_URL}/api/projects/${project.id}/pages`, {
      headers: auth(token),
      data: { title: 'With picker', content: 'Intro.' },
    });
    const { id } = (await created.json()) as { id: string };
    await page.goto(`/projects/${project.id}/pages/${id}`);
    await page.getByTestId('page-edit').click();
    await expect(editorSurface(page, 'page-content-editor')).toBeFocused();

    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    await page.getByTestId('editor-file-input').setInputFiles({ name: 'shot.png', mimeType: 'image/png', buffer: png });
    await expect
      .poll(() => editorMarkdown(page, 'page-content-editor'), { timeout: 15_000 })
      .toMatch(/^Intro\.\n\n!\[shot\.png\]\(nl-image:[A-Za-z0-9_-]+\)$/);
    await expect(editorSurface(page, 'page-content-editor').locator('img[data-nl-image]')).toHaveCount(1);
  });
});
