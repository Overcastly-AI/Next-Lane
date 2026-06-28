/**
 * Unit tests for CreateComponentDto and UpdateComponentDto — validates that
 * class-validator rules are correctly expressed so invalid inputs produce 400s
 * in the real app.
 *
 * We drive this through class-validator + class-transformer directly (the same
 * stack the global ValidationPipe uses) so no HTTP layer is needed.
 */

import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateComponentDto, UpdateComponentDto } from './component.dto';

async function validateCreate(plain: Record<string, unknown>): Promise<string[]> {
  const instance = plainToInstance(CreateComponentDto, plain);
  const errors = await validate(instance);
  return errors.map((e) => Object.values(e.constraints ?? {}).join(', '));
}

async function validateUpdate(plain: Record<string, unknown>): Promise<string[]> {
  const instance = plainToInstance(UpdateComponentDto, plain);
  const errors = await validate(instance);
  return errors.map((e) => Object.values(e.constraints ?? {}).join(', '));
}

// ---------------------------------------------------------------------------
// CreateComponentDto
// ---------------------------------------------------------------------------
describe('CreateComponentDto', () => {
  it('accepts a valid minimal payload (name only)', async () => {
    const errors = await validateCreate({ name: 'Frontend' });
    expect(errors).toHaveLength(0);
  });

  it('accepts a payload with description and defaultAssigneeId', async () => {
    const errors = await validateCreate({
      name: 'Backend',
      description: 'API and database layer',
      defaultAssigneeId: 'user-abc',
    });
    expect(errors).toHaveLength(0);
  });

  it('accepts null defaultAssigneeId (clears default)', async () => {
    const errors = await validateCreate({ name: 'API', defaultAssigneeId: null });
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

  it('rejects non-string defaultAssigneeId', async () => {
    const errors = await validateCreate({ name: 'X', defaultAssigneeId: 123 });
    expect(errors.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// UpdateComponentDto
// ---------------------------------------------------------------------------
describe('UpdateComponentDto', () => {
  it('accepts an empty body (all fields optional)', async () => {
    const errors = await validateUpdate({});
    expect(errors).toHaveLength(0);
  });

  it('accepts a partial rename', async () => {
    const errors = await validateUpdate({ name: 'Renamed' });
    expect(errors).toHaveLength(0);
  });

  it('accepts null description (clears it)', async () => {
    const errors = await validateUpdate({ description: null });
    expect(errors).toHaveLength(0);
  });

  it('accepts null defaultAssigneeId (clears it)', async () => {
    const errors = await validateUpdate({ defaultAssigneeId: null });
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

  it('rejects non-string name (number)', async () => {
    const errors = await validateUpdate({ name: 99 });
    expect(errors.length).toBeGreaterThan(0);
  });
});
