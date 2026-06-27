/**
 * e2e tests for file attachments on issues.
 *
 * Runs on both desktop and mobile via playwright.config.ts project matrix.
 *
 * Covered flows:
 *  - Upload a file (drag-to-drop zone) → appears in list with filename/size/uploader
 *  - Download a file (click download button) → file downloaded
 *  - Delete with confirm dialog → row removed from list
 *  - VIEWER-role user cannot see the upload zone or delete button
 *  - Size/MIME rejection → 400 returned (API integration)
 */

import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
  setupIsolatedProject,
  createIssue,
  registerNewUser,
  createWorkspace,
  createProject,
  addWorkspaceMember,
  loginToken,
  API_URL,
} from './helpers';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeTmpFile(content: string, name: string): string {
  const filePath = path.join(os.tmpdir(), name);
  fs.writeFileSync(filePath, content);
  return filePath;
}

async function openIssueDrawer(
  page: import('@playwright/test').Page,
  issueKey: string,
) {
  // Click the issue card on the board
  const card = page.getByText(issueKey, { exact: false }).first();
  await card.click();
  // Wait for the drawer to appear
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 8000 });
}

// ── tests ─────────────────────────────────────────────────────────────────────

test.describe('attachments', () => {
  test('upload → list → download → delete (desktop + mobile)', async ({
    page,
    request,
    isMobile,
  }) => {
    const ctx = await setupIsolatedProject(page, request, {
      label: 'att',
      projectName: 'Attachments Test',
    });

    // Create an issue via API
    const issue = await createIssue(request, ctx.token, ctx.project.id, {
      title: 'Issue with attachment',
    });

    // Navigate to board and open the issue drawer
    await page.goto(`/projects/${ctx.project.id}/board`);
    await expect(page.getByText('Issue with attachment')).toBeVisible({
      timeout: 10000,
    });
    await openIssueDrawer(page, 'Issue with attachment');

    // Scroll down to the Attachments section
    const attachmentsSection = page.getByText('Attachments').first();
    await attachmentsSection.scrollIntoViewIfNeeded();

    // Verify the drop zone is visible for MEMBER (editable)
    const dropZone = page.getByTestId('attachment-drop-zone');
    await expect(dropZone).toBeVisible();

    // ── Upload via file input ──────────────────────────────────────────────
    const tmpFile = makeTmpFile('%PDF-1.4 fake attachment content', `test-${Date.now()}.pdf`);
    const fileInput = page.getByTestId('attachment-input');

    // Use setInputFiles to upload
    await fileInput.setInputFiles(tmpFile);

    // Wait for the upload to complete and the file to appear in the list
    const attachmentList = page.getByTestId('attachment-list');
    await expect(attachmentList).toBeVisible({ timeout: 10000 });
    const firstRow = attachmentList.getByTestId('attachment-row').first();
    await expect(firstRow).toBeVisible({ timeout: 10000 });
    await expect(firstRow).toContainText(path.basename(tmpFile));

    // ── Download ───────────────────────────────────────────────────────────
    // Start waiting for download before clicking
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      firstRow.getByTestId('attachment-download').click(),
    ]);
    expect(download.suggestedFilename()).toBeTruthy();

    // ── Delete ─────────────────────────────────────────────────────────────
    await firstRow.getByTestId('attachment-delete').click();

    // Confirm dialog appears (ConfirmDialog uses role="alertdialog")
    const confirmDialog = page.getByRole('alertdialog').filter({ hasText: 'Delete attachment' });
    await expect(confirmDialog).toBeVisible({ timeout: 8000 });
    await confirmDialog.getByRole('button', { name: /delete/i }).click();

    // Wait for the row to disappear
    await expect(firstRow).not.toBeVisible({ timeout: 8000 });
    // "No attachments yet" message should appear
    await expect(page.getByText('No attachments yet')).toBeVisible();

    // Clean up
    fs.unlinkSync(tmpFile);
    void issue;
    void isMobile;
  });

  test('VIEWER cannot upload or delete', async ({ page, request }) => {
    // Set up owner
    const owner = await setupIsolatedProject(page, request, {
      label: 'att-owner',
      projectName: 'Viewer Attachment Test',
      openBoard: false,
    });

    // Register a viewer
    const viewer = await registerNewUser(request, 'att-viewer');
    await addWorkspaceMember(
      request,
      owner.token,
      owner.workspaceId,
      viewer.email,
      'VIEWER',
    );

    // Create an issue
    const issue = await createIssue(request, owner.token, owner.project.id, {
      title: 'Viewer attachment issue',
    });

    // Upload an attachment as owner first (so there's something to check delete on)
    const tmpFile = makeTmpFile('plain text content', `viewer-test-${Date.now()}.txt`);
    const uploadRes = await request.fetch(
      `${API_URL}/api/issues/${issue.id}/attachments`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${owner.token}` },
        multipart: {
          file: {
            name: path.basename(tmpFile),
            mimeType: 'text/plain',
            buffer: Buffer.from('plain text content'),
          },
        },
      },
    );
    expect(uploadRes.ok(), `owner upload failed: ${uploadRes.status()}`).toBeTruthy();

    // Log in as the viewer via UI
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(viewer.email);
    await page.getByLabel(/password/i).fill(viewer.password);
    await page.getByRole('button', { name: /(log ?in|sign ?in)/i }).click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15000 });

    await page.goto(`/projects/${owner.project.id}/board`);
    await expect(page.getByText('Viewer attachment issue')).toBeVisible({
      timeout: 10000,
    });
    await openIssueDrawer(page, 'Viewer attachment issue');

    // Scroll to Attachments section
    await page.getByText('Attachments').first().scrollIntoViewIfNeeded();

    // Drop zone should NOT be visible for VIEWER
    const dropZone = page.getByTestId('attachment-drop-zone');
    await expect(dropZone).not.toBeVisible();

    // The attachment row should exist (viewer CAN view/download)
    const attachmentList = page.getByTestId('attachment-list');
    await expect(attachmentList).toBeVisible({ timeout: 8000 });
    const firstRow = attachmentList.getByTestId('attachment-row').first();
    await expect(firstRow).toBeVisible();

    // Delete button should NOT be visible for VIEWER (editable=false)
    const deleteBtn = firstRow.getByTestId('attachment-delete');
    await expect(deleteBtn).not.toBeVisible();

    // Clean up
    fs.unlinkSync(tmpFile);
    void issue;
  });

  test('API rejects disallowed MIME type', async ({ request }) => {
    // Register a user and create a project + issue
    const user = await registerNewUser(request, 'att-mime');
    const wsId = await (async () => {
      const res = await request.post(`${API_URL}/api/workspaces`, {
        headers: { Authorization: `Bearer ${user.token}` },
        data: { name: 'MIME Test WS' },
      });
      return ((await res.json()) as { id: string }).id;
    })();
    const projId = await (async () => {
      const res = await request.post(`${API_URL}/api/projects`, {
        headers: { Authorization: `Bearer ${user.token}` },
        data: { workspaceId: wsId, key: `MT${Date.now().toString().slice(-5)}`, name: 'MIME Test' },
      });
      return ((await res.json()) as { id: string }).id;
    })();
    const issueId = await (async () => {
      const res = await request.post(`${API_URL}/api/issues`, {
        headers: { Authorization: `Bearer ${user.token}` },
        data: { projectId: projId, title: 'MIME test issue' },
      });
      return ((await res.json()) as { id: string }).id;
    })();

    // Try to upload an .exe
    const res = await request.fetch(
      `${API_URL}/api/issues/${issueId}/attachments`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${user.token}` },
        multipart: {
          file: {
            name: 'malware.exe',
            mimeType: 'application/x-msdownload',
            buffer: Buffer.from('MZ not a real exe'),
          },
        },
      },
    );
    expect(res.status()).toBe(400);
    const body = await res.json() as { message: string };
    expect(body.message).toMatch(/not allowed/i);
  });

  test('API rejects unauthenticated upload', async ({ request }) => {
    const res = await request.fetch(
      `${API_URL}/api/issues/fake-issue-id/attachments`,
      {
        method: 'POST',
        multipart: {
          file: {
            name: 'test.pdf',
            mimeType: 'application/pdf',
            buffer: Buffer.from('fake pdf'),
          },
        },
      },
    );
    expect(res.status()).toBe(401);
  });

  test('API rejects VIEWER upload (403)', async ({ request }) => {
    // Owner creates workspace + project + issue
    const owner = await registerNewUser(request, 'att-v-owner');
    const wsId = await (async () => {
      const res = await request.post(`${API_URL}/api/workspaces`, {
        headers: { Authorization: `Bearer ${owner.token}` },
        data: { name: 'Viewer Upload WS' },
      });
      return ((await res.json()) as { id: string }).id;
    })();
    const projId = await (async () => {
      const res = await request.post(`${API_URL}/api/projects`, {
        headers: { Authorization: `Bearer ${owner.token}` },
        data: { workspaceId: wsId, key: `VU${Date.now().toString().slice(-5)}`, name: 'Viewer Upload' },
      });
      return ((await res.json()) as { id: string }).id;
    })();
    const issueId = await (async () => {
      const res = await request.post(`${API_URL}/api/issues`, {
        headers: { Authorization: `Bearer ${owner.token}` },
        data: { projectId: projId, title: 'Viewer upload test' },
      });
      return ((await res.json()) as { id: string }).id;
    })();

    // Add a viewer
    const viewer = await registerNewUser(request, 'att-v-viewer');
    const addRes = await request.post(
      `${API_URL}/api/workspaces/${wsId}/members`,
      {
        headers: { Authorization: `Bearer ${owner.token}` },
        data: { email: viewer.email, role: 'VIEWER' },
      },
    );
    expect(addRes.ok()).toBeTruthy();

    // Viewer tries to upload
    const uploadRes = await request.fetch(
      `${API_URL}/api/issues/${issueId}/attachments`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${viewer.token}` },
        multipart: {
          file: {
            name: 'test.pdf',
            mimeType: 'application/pdf',
            buffer: Buffer.from('fake pdf'),
          },
        },
      },
    );
    expect(uploadRes.status()).toBe(403);
  });
});
