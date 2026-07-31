import { test, expect } from '@playwright/test';
import {
  API_URL,
  registerNewUser,
  setupIsolatedProject,
} from './helpers';

/**
 * page-images.spec.ts
 *
 * Images embedded in a page body. Runs on desktop AND mobile-chrome.
 *
 * The claim this file has to defend is not "upload works" — it's **an image is
 * exactly as private as the page holding it**. That claim has two halves, and
 * both are tested against the real running stack:
 *
 *  - a member of the page's workspace sees the image RENDER (the `nl-image:`
 *    reference is resolved to a `blob:` URL with their own token), and
 *  - a logged-in user from a DIFFERENT tenant is refused the bytes outright.
 *
 * The second half is the one that would silently regress: nothing in the UI
 * changes if the download endpoint loses its authorization check, so it is
 * asserted directly against the API.
 */

/** Smallest valid PNG: a 1x1 transparent pixel. */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

test.describe('Page images', () => {
  test('paste an image into a page → it uploads, renders as a blob, and stays private to the page', async ({
    page,
    request,
  }) => {
    const { project, token } = await setupIsolatedProject(page, request, {
      label: 'page-img',
      projectName: 'Page Images QA',
      openBoard: false,
    });

    // Create the page through the API — the editor flow itself is covered by
    // pages.spec.ts, and this spec is about what happens to the image.
    const createRes = await request.post(`${API_URL}/api/projects/${project.id}/pages`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { title: 'Runbook with a screenshot', content: 'Before the image.' },
    });
    expect(createRes.ok(), `create page failed: ${createRes.status()}`).toBeTruthy();
    const created = (await createRes.json()) as { id: string };

    await page.goto(`/projects/${project.id}/pages/${created.id}`);
    await expect(page.getByTestId('page-content')).toContainText('Before the image.');

    // ── Paste an image into the editor ──────────────────────────────────
    await page.getByTestId('page-edit').click();
    const editor = page.getByTestId('page-content-editor');
    await editor.click();

    // A real clipboard paste: build a DataTransfer carrying a File and
    // dispatch the paste event, exactly as a screenshot paste produces.
    // `.setInputFiles` would not exercise the paste handler at all.
    await editor.evaluate((el, bytes) => {
      const file = new File([new Uint8Array(bytes)], 'screenshot.png', {
        type: 'image/png',
      });
      const dt = new DataTransfer();
      dt.items.add(file);
      el.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
      );
    }, Array.from(PNG_1PX));

    // The placeholder is rewritten to a real reference once the bytes land.
    await expect(editor).toHaveValue(/!\[screenshot\.png\]\(nl-image:[A-Za-z0-9_-]+\)/, {
      timeout: 15_000,
    });
    await expect(page.getByTestId('page-image-uploading')).toHaveCount(0);

    await page.getByTestId('page-save').click();
    await expect(page.getByTestId('page-edit')).toBeVisible();

    // ── Read mode: the reference is resolved to a blob and actually paints ──
    const img = page.getByTestId('page-content').locator('img[data-nl-image]');
    await expect(img).toHaveCount(1);
    await expect(img).toHaveAttribute('src', /^blob:/, { timeout: 15_000 });

    // `src` being a blob URL is not the same as the image having DECODED —
    // a corrupted upload (the exact failure the S3 checksum bug caused)
    // yields a blob that never becomes a picture.
    await expect
      .poll(
        () => img.evaluate((el: HTMLImageElement) => el.naturalWidth),
        { timeout: 15_000, message: 'image never decoded' },
      )
      .toBeGreaterThan(0);

    const imageId = await img.getAttribute('data-nl-image');
    expect(imageId).toBeTruthy();

    // ── It survives a full reload (the reference is in the saved body) ───
    await page.reload();
    const afterReload = page.getByTestId('page-content').locator('img[data-nl-image]');
    await expect(afterReload).toHaveAttribute('src', /^blob:/, { timeout: 15_000 });

    // ── Privacy: another tenant's user cannot fetch the bytes ───────────
    const outsider = await registerNewUser(request, 'page-img-outsider');
    const denied = await request.get(`${API_URL}/api/page-images/${imageId}`, {
      headers: { Authorization: `Bearer ${outsider.token}` },
    });
    expect(
      denied.status(),
      'an outsider must not be able to read an image from a page they cannot read',
    ).toBeGreaterThanOrEqual(400);

    // And with no credentials at all.
    const anon = await request.get(`${API_URL}/api/page-images/${imageId}`);
    expect(anon.status()).toBe(401);

    // The owner still can — proving the two assertions above are about
    // authorization, not a broken endpoint.
    const allowed = await request.get(`${API_URL}/api/page-images/${imageId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(allowed.status()).toBe(200);
    expect(allowed.headers()['content-type']).toContain('image/png');
    // Byte-for-byte: catches storage-layer corruption that a 200 would hide.
    expect(Buffer.from(await allowed.body()).equals(PNG_1PX)).toBe(true);
  });

  test('rejects a non-image file with a message instead of uploading it', async ({
    page,
    request,
  }) => {
    const { project, token } = await setupIsolatedProject(page, request, {
      label: 'page-img-reject',
      projectName: 'Page Images Reject QA',
      openBoard: false,
    });

    const createRes = await request.post(`${API_URL}/api/projects/${project.id}/pages`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { title: 'Reject test', content: 'Body.' },
    });
    const created = (await createRes.json()) as { id: string };

    await page.goto(`/projects/${project.id}/pages/${created.id}`);
    await page.getByTestId('page-edit').click();
    const editor = page.getByTestId('page-content-editor');
    await editor.click();

    await editor.evaluate((el) => {
      const file = new File(['#!/bin/sh\necho pwned'], 'evil.sh', {
        type: 'application/x-sh',
      });
      const dt = new DataTransfer();
      dt.items.add(file);
      el.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
      );
    });

    await expect(page.getByText(/Only PNG, JPEG, GIF and WebP/i)).toBeVisible();
    // Nothing was inserted into the body.
    await expect(editor).toHaveValue('Body.');
  });
});
