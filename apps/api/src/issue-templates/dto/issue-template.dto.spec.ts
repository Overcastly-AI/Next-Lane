/**
 * Unit tests for IssueTemplate DTOs — validates that class-validator rules are
 * correctly expressed so invalid inputs produce 400s in the real app.
 *
 * We drive this through class-validator + class-transformer directly (the same
 * stack the global ValidationPipe uses) so no HTTP layer is needed.
 */

import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { IssueType, Priority } from '@next-lane/shared';
import {
  CreateIssueTemplateDto,
  UpdateIssueTemplateDto,
  CreateIssueFromTemplateDto,
} from './issue-template.dto';

async function validateCreate(
  plain: Record<string, unknown>,
): Promise<string[]> {
  const instance = plainToInstance(CreateIssueTemplateDto, plain);
  const errors = await validate(instance);
  return errors.map((e) => Object.values(e.constraints ?? {}).join(', '));
}

async function validateUpdate(
  plain: Record<string, unknown>,
): Promise<string[]> {
  const instance = plainToInstance(UpdateIssueTemplateDto, plain);
  const errors = await validate(instance);
  return errors.map((e) => Object.values(e.constraints ?? {}).join(', '));
}

async function validateFromTemplate(
  plain: Record<string, unknown>,
): Promise<string[]> {
  const instance = plainToInstance(CreateIssueFromTemplateDto, plain);
  const errors = await validate(instance);
  return errors.map((e) => Object.values(e.constraints ?? {}).join(', '));
}

// ---------------------------------------------------------------------------
// CreateIssueTemplateDto
// ---------------------------------------------------------------------------
describe('CreateIssueTemplateDto', () => {
  it('accepts a valid minimal payload (name only)', async () => {
    const errors = await validateCreate({ name: 'Bug report' });
    expect(errors).toHaveLength(0);
  });

  it('accepts a full valid payload', async () => {
    const errors = await validateCreate({
      name: 'Full template',
      issueType: IssueType.BUG,
      titleTemplate: '[BUG] ',
      descriptionTemplate: '## Steps\n',
      priority: Priority.HIGH,
      defaultAssigneeId: 'user-abc',
      componentId: 'comp-xyz',
      labelIds: ['label-1', 'label-2'],
    });
    expect(errors).toHaveLength(0);
  });

  it('accepts null defaultAssigneeId', async () => {
    const errors = await validateCreate({
      name: 'X',
      defaultAssigneeId: null,
    });
    expect(errors).toHaveLength(0);
  });

  it('accepts null componentId', async () => {
    const errors = await validateCreate({ name: 'X', componentId: null });
    expect(errors).toHaveLength(0);
  });

  it('accepts empty labelIds array', async () => {
    const errors = await validateCreate({ name: 'X', labelIds: [] });
    expect(errors).toHaveLength(0);
  });

  it('rejects empty name', async () => {
    const errors = await validateCreate({ name: '' });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects missing name', async () => {
    const errors = await validateCreate({});
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects name over 100 characters', async () => {
    const errors = await validateCreate({ name: 'a'.repeat(101) });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('accepts name at exactly 100 characters', async () => {
    const errors = await validateCreate({ name: 'a'.repeat(100) });
    expect(errors).toHaveLength(0);
  });

  it('rejects non-string name (number)', async () => {
    const errors = await validateCreate({ name: 42 });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects invalid issueType', async () => {
    const errors = await validateCreate({ name: 'X', issueType: 'INVALID' });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects invalid priority', async () => {
    const errors = await validateCreate({ name: 'X', priority: 'BAD_PRIORITY' });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects non-string defaultAssigneeId', async () => {
    const errors = await validateCreate({ name: 'X', defaultAssigneeId: 123 });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects non-array labelIds', async () => {
    const errors = await validateCreate({ name: 'X', labelIds: 'not-an-array' });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects labelIds with non-string elements', async () => {
    const errors = await validateCreate({ name: 'X', labelIds: [1, 2] });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects titleTemplate over 300 characters', async () => {
    const errors = await validateCreate({
      name: 'X',
      titleTemplate: 'a'.repeat(301),
    });
    expect(errors.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// UpdateIssueTemplateDto
// ---------------------------------------------------------------------------
describe('UpdateIssueTemplateDto', () => {
  it('accepts an empty body (all fields optional)', async () => {
    const errors = await validateUpdate({});
    expect(errors).toHaveLength(0);
  });

  it('accepts a partial rename', async () => {
    const errors = await validateUpdate({ name: 'Renamed' });
    expect(errors).toHaveLength(0);
  });

  it('accepts null priority (clears it)', async () => {
    const errors = await validateUpdate({ priority: null });
    expect(errors).toHaveLength(0);
  });

  it('accepts null titleTemplate (clears it)', async () => {
    const errors = await validateUpdate({ titleTemplate: null });
    expect(errors).toHaveLength(0);
  });

  it('accepts null descriptionTemplate (clears it)', async () => {
    const errors = await validateUpdate({ descriptionTemplate: null });
    expect(errors).toHaveLength(0);
  });

  it('accepts null defaultAssigneeId (clears it)', async () => {
    const errors = await validateUpdate({ defaultAssigneeId: null });
    expect(errors).toHaveLength(0);
  });

  it('accepts null componentId (clears it)', async () => {
    const errors = await validateUpdate({ componentId: null });
    expect(errors).toHaveLength(0);
  });

  it('rejects empty name', async () => {
    const errors = await validateUpdate({ name: '' });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects name over 100 characters', async () => {
    const errors = await validateUpdate({ name: 'a'.repeat(101) });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects invalid issueType', async () => {
    const errors = await validateUpdate({ issueType: 'NOPE' });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects non-string name (number)', async () => {
    const errors = await validateUpdate({ name: 99 });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects non-array labelIds', async () => {
    const errors = await validateUpdate({ labelIds: 'bad' });
    expect(errors.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// CreateIssueFromTemplateDto
// ---------------------------------------------------------------------------
describe('CreateIssueFromTemplateDto', () => {
  it('accepts an empty body (all fields optional)', async () => {
    const errors = await validateFromTemplate({});
    expect(errors).toHaveLength(0);
  });

  it('accepts a full valid override payload', async () => {
    const errors = await validateFromTemplate({
      title: 'Override title',
      description: 'My description',
      assigneeId: 'user-abc',
      componentId: 'comp-xyz',
      priority: Priority.HIGHEST,
      statusId: 'status-1',
      sprintId: 'sprint-1',
      labelIds: ['label-1'],
    });
    expect(errors).toHaveLength(0);
  });

  it('accepts null assigneeId (explicit unassign)', async () => {
    const errors = await validateFromTemplate({ assigneeId: null });
    expect(errors).toHaveLength(0);
  });

  it('accepts null componentId (explicit clear)', async () => {
    const errors = await validateFromTemplate({ componentId: null });
    expect(errors).toHaveLength(0);
  });

  it('rejects empty title (min length 1)', async () => {
    const errors = await validateFromTemplate({ title: '' });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects title over 300 characters', async () => {
    const errors = await validateFromTemplate({ title: 'a'.repeat(301) });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects invalid priority', async () => {
    const errors = await validateFromTemplate({ priority: 'BAD' });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects non-string assigneeId', async () => {
    const errors = await validateFromTemplate({ assigneeId: 123 });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects non-array labelIds', async () => {
    const errors = await validateFromTemplate({ labelIds: 'not-an-array' });
    expect(errors.length).toBeGreaterThan(0);
  });
});
