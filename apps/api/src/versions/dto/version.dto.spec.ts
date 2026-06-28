/**
 * Unit tests for CreateVersionDto and UpdateVersionDto — validates that
 * class-validator rules are correctly expressed so invalid inputs produce 400s
 * in the real app.
 *
 * We drive this through class-validator + class-transformer directly (the same
 * stack the global ValidationPipe uses) so no HTTP layer is needed.
 */

import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { VersionState } from '@next-lane/shared';
import {
  CreateVersionDto,
  UpdateVersionDto,
  SetIssueVersionsDto,
} from './version.dto';

async function validateCreate(
  plain: Record<string, unknown>,
): Promise<string[]> {
  const instance = plainToInstance(CreateVersionDto, plain);
  const errors = await validate(instance);
  return errors.map((e) => Object.values(e.constraints ?? {}).join(', '));
}

async function validateUpdate(
  plain: Record<string, unknown>,
): Promise<string[]> {
  const instance = plainToInstance(UpdateVersionDto, plain);
  const errors = await validate(instance);
  return errors.map((e) => Object.values(e.constraints ?? {}).join(', '));
}

async function validateSetVersions(
  plain: Record<string, unknown>,
): Promise<string[]> {
  const instance = plainToInstance(SetIssueVersionsDto, plain);
  const errors = await validate(instance);
  return errors.map((e) => Object.values(e.constraints ?? {}).join(', '));
}

// ---------------------------------------------------------------------------
// CreateVersionDto
// ---------------------------------------------------------------------------
describe('CreateVersionDto', () => {
  it('accepts a valid minimal payload (name only)', async () => {
    const errors = await validateCreate({ name: 'v1.0.0' });
    expect(errors).toHaveLength(0);
  });

  it('accepts a full payload with description and releaseDate', async () => {
    const errors = await validateCreate({
      name: 'v1.2.0',
      description: 'First release candidate',
      releaseDate: '2026-07-01T00:00:00.000Z',
    });
    expect(errors).toHaveLength(0);
  });

  it('accepts null description', async () => {
    const errors = await validateCreate({ name: 'v1.0.0', description: null });
    expect(errors).toHaveLength(0);
  });

  it('accepts null releaseDate', async () => {
    const errors = await validateCreate({ name: 'v1.0.0', releaseDate: null });
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
    const errors = await validateCreate({ name: 'v'.repeat(101) });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('accepts name at exactly 100 characters', async () => {
    const errors = await validateCreate({ name: 'v'.repeat(100) });
    expect(errors).toHaveLength(0);
  });

  it('rejects non-string name', async () => {
    const errors = await validateCreate({ name: 42 });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects an invalid ISO 8601 releaseDate', async () => {
    const errors = await validateCreate({
      name: 'v1.0.0',
      releaseDate: 'not-a-date',
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects description over 1000 characters', async () => {
    const errors = await validateCreate({
      name: 'v1.0.0',
      description: 'a'.repeat(1001),
    });
    expect(errors.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// UpdateVersionDto
// ---------------------------------------------------------------------------
describe('UpdateVersionDto', () => {
  it('accepts an empty body (all fields optional)', async () => {
    const errors = await validateUpdate({});
    expect(errors).toHaveLength(0);
  });

  it('accepts a partial rename', async () => {
    const errors = await validateUpdate({ name: 'v2.0.0' });
    expect(errors).toHaveLength(0);
  });

  it('accepts a state change to RELEASED', async () => {
    const errors = await validateUpdate({ state: VersionState.RELEASED });
    expect(errors).toHaveLength(0);
  });

  it('accepts a state change to ARCHIVED', async () => {
    const errors = await validateUpdate({ state: VersionState.ARCHIVED });
    expect(errors).toHaveLength(0);
  });

  it('rejects an invalid state value', async () => {
    const errors = await validateUpdate({ state: 'INVALID' });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('accepts null description (clears it)', async () => {
    const errors = await validateUpdate({ description: null });
    expect(errors).toHaveLength(0);
  });

  it('accepts null releaseDate (clears it)', async () => {
    const errors = await validateUpdate({ releaseDate: null });
    expect(errors).toHaveLength(0);
  });

  it('rejects empty name', async () => {
    const errors = await validateUpdate({ name: '' });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects name over 100 characters', async () => {
    const errors = await validateUpdate({ name: 'v'.repeat(101) });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects non-string name (number)', async () => {
    const errors = await validateUpdate({ name: 99 });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects an invalid ISO 8601 releaseDate', async () => {
    const errors = await validateUpdate({ releaseDate: 'bad-date' });
    expect(errors.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// SetIssueVersionsDto
// ---------------------------------------------------------------------------
describe('SetIssueVersionsDto', () => {
  it('accepts an empty versionIds array (removes all versions)', async () => {
    const errors = await validateSetVersions({ versionIds: [] });
    expect(errors).toHaveLength(0);
  });

  it('accepts an array of string version IDs', async () => {
    const errors = await validateSetVersions({
      versionIds: ['ver-1', 'ver-2'],
    });
    expect(errors).toHaveLength(0);
  });

  it('rejects missing versionIds', async () => {
    const errors = await validateSetVersions({});
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects versionIds containing a non-string element', async () => {
    const errors = await validateSetVersions({ versionIds: [123, 'ver-2'] });
    expect(errors.length).toBeGreaterThan(0);
  });
});
