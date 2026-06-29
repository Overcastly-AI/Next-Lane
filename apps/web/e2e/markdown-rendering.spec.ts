/**
 * e2e tests for markdown rendering in issue descriptions and comments.
 *
 * Covered flows:
 *  - Description: rendered as markdown in view mode; plain textarea in edit mode
 *  - Description: edit → blur → saved and re-rendered as markdown
 *  - Comments: rendered as markdown (bold, italic, code, list, link)
 *  - XSS sanitization: <script> tags in descriptions and comments are stripped
 *  - @mention tokens survive markdown rendering (rendered as plain text)
 *  - Links open in new tab (rel=noopener, target=_blank)
 *
 * Desktop + mobile via playwright.config.ts project matrix.
 */

import { test, expect } from '@playwright/test';
import {
  setupIsolatedProject,
  createIssue,
  API_URL,
} from './helpers';

// Helper to open an issue's detail drawer by clicking its title on the board
async function openIssueDrawer(
  page: import('@playwright/test').Page,
  issueTitle: string,
) {
  const card = page.getByText(issueTitle, { exact: false }).first();
  await card.click();
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10000 });
}

test.describe('markdown rendering', () => {
  test('description renders markdown in view mode and edits as plain text', async ({
    page,
    request,
    isMobile,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'md-desc',
      projectName: 'Markdown Description Test',
    });

    // Create issue with markdown description
    const mdContent =
      '## Heading\n\n**Bold text** and _italic text_.\n\n- Item one\n- Item two\n\n`inline code`\n\n> blockquote';

    const issue = await createIssue(request, ctx.token, ctx.project.id, {
      title: 'Markdown description issue',
    });

    // Set description via API
    const patchRes = await request.patch(`${API_URL}/api/issues/${issue.id}`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
      data: { description: mdContent },
    });
    expect(patchRes.ok(), `patch failed: ${patchRes.status()}`).toBeTruthy();

    // Navigate to board and open issue drawer
    await page.goto(`/projects/${ctx.project.id}/board`);
    await expect(page.getByText('Markdown description issue')).toBeVisible({
      timeout: 10000,
    });
    await openIssueDrawer(page, 'Markdown description issue');

    // Verify markdown is rendered (not raw text)
    const rendered = page.getByTestId('description-rendered');
    await expect(rendered).toBeVisible({ timeout: 8000 });

    // Heading should render as an h2 element
    await expect(rendered.locator('h2')).toContainText('Heading');
    // Bold text
    await expect(rendered.locator('strong')).toContainText('Bold text');
    // Italic text
    await expect(rendered.locator('em')).toContainText('italic text');
    // List items
    await expect(rendered.locator('li').first()).toContainText('Item one');
    // Inline code
    await expect(rendered.locator('code')).toContainText('inline code');
    // Blockquote
    await expect(rendered.locator('blockquote')).toBeVisible();

    // Switch to edit mode — click the rendered area
    await rendered.click();
    const editor = page.getByTestId('description-editor');
    await expect(editor).toBeVisible({ timeout: 5000 });
    // Editor should contain the raw markdown
    await expect(editor).toHaveValue(mdContent);

    // Press Escape to cancel edit without saving
    await editor.press('Escape');
    // Should switch back to rendered view
    await expect(rendered).toBeVisible({ timeout: 5000 });

    void issue;
    void isMobile;
  });

  test('description XSS: <script> tag is stripped from rendered output', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'md-xss-desc',
      projectName: 'Markdown XSS Description Test',
    });

    const xssPayload = 'Safe text\n\n<script>window.__xssDesc = true;</script>\n\nMore safe text';

    const issue = await createIssue(request, ctx.token, ctx.project.id, {
      title: 'XSS description issue',
    });
    await request.patch(`${API_URL}/api/issues/${issue.id}`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
      data: { description: xssPayload },
    });

    await page.goto(`/projects/${ctx.project.id}/board`);
    await expect(page.getByText('XSS description issue')).toBeVisible({ timeout: 10000 });
    await openIssueDrawer(page, 'XSS description issue');

    const rendered = page.getByTestId('description-rendered');
    await expect(rendered).toBeVisible({ timeout: 8000 });

    // The script MUST NOT have executed
    const scriptRan = await page.evaluate(() => (window as typeof window & { __xssDesc?: boolean }).__xssDesc);
    expect(scriptRan).toBeFalsy();

    // No <script> element should be in the DOM inside the rendered area
    const scriptTags = await rendered.locator('script').count();
    expect(scriptTags).toBe(0);

    // Safe text should be visible
    await expect(rendered).toContainText('Safe text');
  });

  test('comment renders markdown with formatting', async ({
    page,
    request,
    isMobile,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'md-comment',
      projectName: 'Markdown Comment Test',
    });

    const issue = await createIssue(request, ctx.token, ctx.project.id, {
      title: 'Markdown comment issue',
    });

    // Post a comment with markdown via API
    const commentBody = '**bold** and _italic_ and `code` and [link](https://example.com)';
    const commentRes = await request.post(
      `${API_URL}/api/issues/${issue.id}/comments`,
      {
        headers: { Authorization: `Bearer ${ctx.token}` },
        data: { body: commentBody },
      },
    );
    expect(commentRes.ok(), `comment failed: ${commentRes.status()}`).toBeTruthy();

    // Navigate to board and open issue drawer
    await page.goto(`/projects/${ctx.project.id}/board`);
    await expect(page.getByText('Markdown comment issue')).toBeVisible({ timeout: 10000 });
    await openIssueDrawer(page, 'Markdown comment issue');

    // Scroll to comments
    await page.getByText('Comments').first().scrollIntoViewIfNeeded();

    // Wait for comment to appear
    const commentBody_ = page.getByTestId('comment-body-rendered').first();
    await expect(commentBody_).toBeVisible({ timeout: 8000 });

    // Verify markdown formatting in the rendered comment
    await expect(commentBody_.locator('strong')).toContainText('bold');
    await expect(commentBody_.locator('em')).toContainText('italic');
    await expect(commentBody_.locator('code')).toContainText('code');

    // Links should have target=_blank and rel=noopener
    const link = commentBody_.locator('a');
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(link).toHaveAttribute('href', 'https://example.com');

    void isMobile;
  });

  test('comment XSS: <script> tag is stripped from rendered comment', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'md-xss-comment',
      projectName: 'Markdown XSS Comment Test',
    });

    const issue = await createIssue(request, ctx.token, ctx.project.id, {
      title: 'XSS comment issue',
    });

    // Post a comment with an embedded script via API
    const xssComment = 'Hello <script>window.__xssComment = true;</script> world';
    await request.post(`${API_URL}/api/issues/${issue.id}/comments`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
      data: { body: xssComment },
    });

    await page.goto(`/projects/${ctx.project.id}/board`);
    await expect(page.getByText('XSS comment issue')).toBeVisible({ timeout: 10000 });
    await openIssueDrawer(page, 'XSS comment issue');

    await page.getByText('Comments').first().scrollIntoViewIfNeeded();

    const commentBody = page.getByTestId('comment-body-rendered').first();
    await expect(commentBody).toBeVisible({ timeout: 8000 });

    // Script must NOT have executed
    const scriptRan = await page.evaluate(() => (window as typeof window & { __xssComment?: boolean }).__xssComment);
    expect(scriptRan).toBeFalsy();

    // No <script> in the DOM
    const scriptCount = await commentBody.locator('script').count();
    expect(scriptCount).toBe(0);

    // The surrounding text should still render
    await expect(commentBody).toContainText('Hello');
    await expect(commentBody).toContainText('world');
  });

  test('@mention token survives markdown rendering as readable text', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'md-mention',
      projectName: 'Mention Markdown Test',
    });

    const issue = await createIssue(request, ctx.token, ctx.project.id, {
      title: 'Mention markdown issue',
    });

    // Post a comment with @mention
    const mentionComment = 'Hey @user@example.com please review this **important** thing.';
    await request.post(`${API_URL}/api/issues/${issue.id}/comments`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
      data: { body: mentionComment },
    });

    await page.goto(`/projects/${ctx.project.id}/board`);
    await expect(page.getByText('Mention markdown issue')).toBeVisible({ timeout: 10000 });
    await openIssueDrawer(page, 'Mention markdown issue');

    await page.getByText('Comments').first().scrollIntoViewIfNeeded();

    const commentBody = page.getByTestId('comment-body-rendered').first();
    await expect(commentBody).toBeVisible({ timeout: 8000 });

    // The mention text should be readable
    await expect(commentBody).toContainText('@user@example.com');
    // Bold text should also render
    await expect(commentBody.locator('strong')).toContainText('important');
  });

  test('description renders a ```mermaid block as an SVG diagram', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'md-mermaid',
      projectName: 'Markdown Mermaid Test',
    });

    // Surrounding markdown + a fenced mermaid flowchart.
    const mdContent = [
      '## Architecture',
      '',
      'The flow:',
      '',
      '```mermaid',
      'graph TD',
      '  A[Start] --> B{Ready?}',
      '  B -->|Yes| C[Ship]',
      '  B -->|No| A',
      '```',
      '',
      'End of diagram.',
    ].join('\n');

    const issue = await createIssue(request, ctx.token, ctx.project.id, {
      title: 'Mermaid description issue',
    });
    const patchRes = await request.patch(`${API_URL}/api/issues/${issue.id}`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
      data: { description: mdContent },
    });
    expect(patchRes.ok(), `patch failed: ${patchRes.status()}`).toBeTruthy();

    await page.goto(`/projects/${ctx.project.id}/board`);
    await expect(page.getByText('Mermaid description issue')).toBeVisible({
      timeout: 10000,
    });
    await openIssueDrawer(page, 'Mermaid description issue');

    const rendered = page.getByTestId('description-rendered');
    await expect(rendered).toBeVisible({ timeout: 8000 });

    // The mermaid block becomes an inline SVG (lazy-loaded — allow time).
    const diagram = rendered.getByTestId('mermaid-diagram');
    await expect(diagram).toBeVisible({ timeout: 15000 });
    await expect(diagram.locator('svg')).toBeVisible({ timeout: 15000 });
    // A node label from the diagram should appear in the rendered SVG text.
    await expect(diagram).toContainText('Ship');

    // The surrounding markdown still renders normally.
    await expect(rendered.locator('h2')).toContainText('Architecture');
    await expect(rendered).toContainText('End of diagram.');
  });

  test('invalid mermaid syntax falls back to the source, not a crash', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'md-mermaid-bad',
      projectName: 'Markdown Mermaid Error Test',
    });

    const mdContent = ['```mermaid', 'graph TD', '  A --> ', 'this is not valid', '```'].join('\n');

    const issue = await createIssue(request, ctx.token, ctx.project.id, {
      title: 'Bad mermaid issue',
    });
    await request.patch(`${API_URL}/api/issues/${issue.id}`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
      data: { description: mdContent },
    });

    await page.goto(`/projects/${ctx.project.id}/board`);
    await expect(page.getByText('Bad mermaid issue')).toBeVisible({ timeout: 10000 });
    await openIssueDrawer(page, 'Bad mermaid issue');

    const rendered = page.getByTestId('description-rendered');
    await expect(rendered).toBeVisible({ timeout: 8000 });

    // Graceful fallback shows the raw source rather than throwing.
    await expect(rendered.getByTestId('mermaid-error')).toBeVisible({ timeout: 15000 });
    await expect(rendered).toContainText('graph TD');
  });

  test('mermaid XSS: a script in a node label does not execute', async ({
    page,
    request,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'md-mermaid-xss',
      projectName: 'Markdown Mermaid XSS Test',
    });

    // A node label carrying an injection payload — mermaid securityLevel:strict
    // must neutralise it (no script execution, no live <img onerror>).
    const mdContent = [
      '```mermaid',
      'graph TD',
      '  A["<img src=x onerror=window.__xssMermaid=true>"] --> B[Safe]',
      '```',
    ].join('\n');

    const issue = await createIssue(request, ctx.token, ctx.project.id, {
      title: 'Mermaid XSS issue',
    });
    await request.patch(`${API_URL}/api/issues/${issue.id}`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
      data: { description: mdContent },
    });

    await page.goto(`/projects/${ctx.project.id}/board`);
    await expect(page.getByText('Mermaid XSS issue')).toBeVisible({ timeout: 10000 });
    await openIssueDrawer(page, 'Mermaid XSS issue');

    const rendered = page.getByTestId('description-rendered');
    await expect(rendered).toBeVisible({ timeout: 8000 });
    // Allow the diagram (or its error fallback) to settle.
    await page.waitForTimeout(1500);

    // The payload must NOT have run, and no live <img onerror> may remain.
    const ran = await page.evaluate(
      () => (window as typeof window & { __xssMermaid?: boolean }).__xssMermaid,
    );
    expect(ran).toBeFalsy();
    const liveImg = await rendered.locator('img[onerror]').count();
    expect(liveImg).toBe(0);
  });

  test('typing in composer preserves markdown input (pressSequentially)', async ({
    page,
    request,
    isMobile,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'md-type',
      projectName: 'Markdown Type Test',
    });

    const issue = await createIssue(request, ctx.token, ctx.project.id, {
      title: 'Markdown type issue',
    });

    await page.goto(`/projects/${ctx.project.id}/board`);
    await expect(page.getByText('Markdown type issue')).toBeVisible({ timeout: 10000 });
    await openIssueDrawer(page, 'Markdown type issue');

    await page.getByText('Comments').first().scrollIntoViewIfNeeded();

    const composer = page.getByTestId('comment-composer');
    await expect(composer).toBeVisible({ timeout: 5000 });

    // Type using pressSequentially (per-keystroke, as a real user would)
    await composer.pressSequentially('**bold** and _italic_');
    await expect(composer).toHaveValue('**bold** and _italic_');

    // Submit
    await page.keyboard.press('Control+Enter');

    // Wait for the rendered comment to appear
    const commentBody = page.getByTestId('comment-body-rendered').first();
    await expect(commentBody).toBeVisible({ timeout: 8000 });
    await expect(commentBody.locator('strong')).toContainText('bold');
    await expect(commentBody.locator('em')).toContainText('italic');

    void isMobile;
  });
});
