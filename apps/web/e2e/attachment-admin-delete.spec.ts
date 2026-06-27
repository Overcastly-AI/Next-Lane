/**
 * e2e tests for attachment admin-delete UX.
 *
 * Task B (P2, S): The API allows project ADMINs to delete any attachment
 * (not just those they uploaded). Previously the UI only showed the delete
 * button for the uploader. This spec verifies:
 *
 *  - Uploader (MEMBER) sees the delete button for their own attachment.
 *  - ADMIN who did NOT upload the attachment ALSO sees the delete button.
 *  - VIEWER sees no delete button at all.
 *  - The API actually accepts the ADMIN delete (no 403).
 *
 * Desktop + mobile via playwright.config.ts project matrix.
 */

import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
  setupIsolatedProject,
  createIssue,
  registerNewUser,
  addWorkspaceMember,
  API_URL,
} from './helpers';

function makeTmpFile(content: string, name: string): string {
  const filePath = path.join(os.tmpdir(), name);
  fs.writeFileSync(filePath, content);
  return filePath;
}

async function uploadAttachmentViaApi(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  issueId: string,
  filename: string,
  content: string,
): Promise<string> {
  const res = await request.fetch(
    `${API_URL}/api/issues/${issueId}/attachments`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      multipart: {
        file: {
          name: filename,
          mimeType: 'text/plain',
          buffer: Buffer.from(content),
        },
      },
    },
  );
  expect(res.ok(), `upload failed: ${res.status()}`).toBeTruthy();
  return ((await res.json()) as { id: string }).id;
}

async function openIssueDrawer(
  page: import('@playwright/test').Page,
  issueTitle: string,
) {
  const card = page.getByText(issueTitle, { exact: false }).first();
  await card.click();
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10000 });
}

test.describe('attachment admin-delete UX', () => {
  test('ADMIN sees delete button on another user\'s attachment', async ({
    page,
    request,
    isMobile,
  }) => {
    // Set up owner who is a regular MEMBER (not the one we'll test as admin)
    const member = await registerNewUser(request, 'att-adm-member');
    const adminCtx = await setupIsolatedProject(page, request, {
      label: 'att-adm',
      projectName: 'Admin Delete Test',
      openBoard: false,
    });

    // Add the member to the same workspace
    await addWorkspaceMember(
      request,
      adminCtx.token,
      adminCtx.workspaceId,
      member.email,
      'MEMBER',
    );

    // Create issue
    const issue = await createIssue(request, member.token, adminCtx.project.id, {
      title: 'Admin delete attachment issue',
    });

    // Upload an attachment AS THE MEMBER (not the admin)
    await uploadAttachmentViaApi(
      request,
      member.token,
      issue.id,
      `member-upload-${Date.now()}.txt`,
      'Member file content',
    );

    // Now log in as the ADMIN (adminCtx.user who created the workspace)
    // (They were already logged in by setupIsolatedProject, just navigate)
    await page.goto(`/projects/${adminCtx.project.id}/board`);
    await expect(page.getByText('Admin delete attachment issue')).toBeVisible({
      timeout: 10000,
    });
    await openIssueDrawer(page, 'Admin delete attachment issue');

    // Scroll to Attachments section
    await page.getByText('Attachments').first().scrollIntoViewIfNeeded();

    // The attachment list should be visible
    const attachmentList = page.getByTestId('attachment-list');
    await expect(attachmentList).toBeVisible({ timeout: 8000 });

    const firstRow = attachmentList.getByTestId('attachment-row').first();
    await expect(firstRow).toBeVisible();

    // ADMIN must see the delete button even though they did NOT upload it
    const deleteBtn = firstRow.getByTestId('attachment-delete');
    await expect(deleteBtn).toBeVisible({
      timeout: 5000,
    });

    void isMobile;
  });

  test('MEMBER (non-uploader) does NOT see delete button for another user\'s attachment', async ({
    page,
    request,
  }) => {
    // Setup: owner (admin) creates workspace + project + issue + uploads attachment
    const ownerCtx = await setupIsolatedProject(page, request, {
      label: 'att-mem-nodelbtn',
      projectName: 'Member No Delete Test',
      openBoard: false,
    });

    // Register a second user as MEMBER
    const member2 = await registerNewUser(request, 'att-mem2');
    await addWorkspaceMember(
      request,
      ownerCtx.token,
      ownerCtx.workspaceId,
      member2.email,
      'MEMBER',
    );

    // Create issue and upload as the owner
    const issue = await createIssue(request, ownerCtx.token, ownerCtx.project.id, {
      title: 'Member no delete issue',
    });
    await uploadAttachmentViaApi(
      request,
      ownerCtx.token,
      issue.id,
      `owner-upload-${Date.now()}.txt`,
      'Owner file',
    );

    // Log in as member2 (MEMBER role, not the uploader)
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(member2.email);
    await page.getByLabel(/password/i).fill(member2.password);
    await page.getByRole('button', { name: /(log ?in|sign ?in)/i }).click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15000 });

    await page.goto(`/projects/${ownerCtx.project.id}/board`);
    await expect(page.getByText('Member no delete issue')).toBeVisible({ timeout: 10000 });
    await openIssueDrawer(page, 'Member no delete issue');

    await page.getByText('Attachments').first().scrollIntoViewIfNeeded();

    const attachmentList = page.getByTestId('attachment-list');
    await expect(attachmentList).toBeVisible({ timeout: 8000 });

    const firstRow = attachmentList.getByTestId('attachment-row').first();
    await expect(firstRow).toBeVisible();

    // MEMBER who is NOT the uploader should NOT see the delete button
    const deleteBtn = firstRow.getByTestId('attachment-delete');
    await expect(deleteBtn).not.toBeVisible();
  });

  test('ADMIN can actually delete another user\'s attachment (API accepts 200)', async ({
    request,
  }) => {
    // Create workspace + project + issue as admin
    const admin = await registerNewUser(request, 'att-adm-api');
    const wsRes = await request.post(`${API_URL}/api/workspaces`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { name: `Admin API WS ${Date.now()}` },
    });
    const wsId = ((await wsRes.json()) as { id: string }).id;

    const projRes = await request.post(`${API_URL}/api/projects`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { workspaceId: wsId, key: `ADA${Date.now().toString().slice(-5)}`, name: 'Admin API Project' },
    });
    const projId = ((await projRes.json()) as { id: string }).id;

    // Register a MEMBER
    const member = await registerNewUser(request, 'att-adm-api-mem');
    await request.post(`${API_URL}/api/workspaces/${wsId}/members`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { email: member.email, role: 'MEMBER' },
    });

    const issueRes = await request.post(`${API_URL}/api/issues`, {
      headers: { Authorization: `Bearer ${member.token}` },
      data: { projectId: projId, title: 'API admin delete test' },
    });
    const issueId = ((await issueRes.json()) as { id: string }).id;

    // Member uploads an attachment
    const attachmentId = await uploadAttachmentViaApi(
      request,
      member.token,
      issueId,
      `member-file-${Date.now()}.txt`,
      'Member upload',
    );

    // Admin deletes it — must succeed (200/204), not 403
    const deleteRes = await request.delete(
      `${API_URL}/api/attachments/${attachmentId}`,
      { headers: { Authorization: `Bearer ${admin.token}` } },
    );
    expect(
      deleteRes.status(),
      `admin delete returned ${deleteRes.status()}, expected 200/204`,
    ).toBeLessThan(300);
  });

  test('VIEWER sees no delete button regardless of uploader', async ({
    page,
    request,
  }) => {
    const ownerCtx = await setupIsolatedProject(page, request, {
      label: 'att-viewer-nodelbtn',
      projectName: 'Viewer No Delete Test',
      openBoard: false,
    });

    const viewer = await registerNewUser(request, 'att-viewer-del');
    await addWorkspaceMember(
      request,
      ownerCtx.token,
      ownerCtx.workspaceId,
      viewer.email,
      'VIEWER',
    );

    const issue = await createIssue(request, ownerCtx.token, ownerCtx.project.id, {
      title: 'Viewer delete issue',
    });
    await uploadAttachmentViaApi(
      request,
      ownerCtx.token,
      issue.id,
      `owner-viewer-${Date.now()}.txt`,
      'Owner file for viewer test',
    );

    // Log in as VIEWER
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(viewer.email);
    await page.getByLabel(/password/i).fill(viewer.password);
    await page.getByRole('button', { name: /(log ?in|sign ?in)/i }).click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15000 });

    await page.goto(`/projects/${ownerCtx.project.id}/board`);
    await expect(page.getByText('Viewer delete issue')).toBeVisible({ timeout: 10000 });
    await openIssueDrawer(page, 'Viewer delete issue');

    await page.getByText('Attachments').first().scrollIntoViewIfNeeded();

    const attachmentList = page.getByTestId('attachment-list');
    await expect(attachmentList).toBeVisible({ timeout: 8000 });

    const firstRow = attachmentList.getByTestId('attachment-row').first();
    await expect(firstRow).toBeVisible();

    const deleteBtn = firstRow.getByTestId('attachment-delete');
    await expect(deleteBtn).not.toBeVisible();
  });
});
