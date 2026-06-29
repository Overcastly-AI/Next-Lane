/**
 * Unit tests for CreateWorkLogDto and UpdateWorkLogDto — validates that
 * class-validator rules are correctly expressed so invalid inputs produce
 * 400s in the real app.
 *
 * Driven through class-validator + class-transformer directly (the same stack
 * the global ValidationPipe uses); no HTTP layer needed.
 */

import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateWorkLogDto, UpdateWorkLogDto } from './work-log.dto';

async function validateCreate(plain: Record<string, unknown>): Promise<string[]> {
  const instance = plainToInstance(CreateWorkLogDto, plain);
  const errors = await validate(instance);
  return errors.map((e) => Object.values(e.constraints ?? {}).join(', '));
}

async function validateUpdate(plain: Record<string, unknown>): Promise<string[]> {
  const instance = plainToInstance(UpdateWorkLogDto, plain);
  const errors = await validate(instance);
  return errors.map((e) => Object.values(e.constraints ?? {}).join(', '));
}

// ---------------------------------------------------------------------------
// CreateWorkLogDto
// ---------------------------------------------------------------------------
describe('CreateWorkLogDto', () => {
  it('accepts valid minutes=1 (minimum)', async () => {
    const errors = await validateCreate({ minutes: 1 });
    expect(errors).toHaveLength(0);
  });

  it('accepts valid minutes=90', async () => {
    const errors = await validateCreate({ minutes: 90 });
    expect(errors).toHaveLength(0);
  });

  it('accepts minutes with optional note and workedAt', async () => {
    const errors = await validateCreate({
      minutes: 30,
      note: 'Worked on auth module',
      workedAt: '2026-06-01T09:00:00.000Z',
    });
    expect(errors).toHaveLength(0);
  });

  it('rejects missing minutes', async () => {
    const errors = await validateCreate({});
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects minutes=0', async () => {
    const errors = await validateCreate({ minutes: 0 });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects negative minutes', async () => {
    const errors = await validateCreate({ minutes: -10 });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects non-integer minutes (float)', async () => {
    const errors = await validateCreate({ minutes: 1.5 });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects minutes as string', async () => {
    const errors = await validateCreate({ minutes: '30' });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects note over 2000 characters', async () => {
    const errors = await validateCreate({ minutes: 30, note: 'a'.repeat(2001) });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('accepts note at exactly 2000 characters', async () => {
    const errors = await validateCreate({ minutes: 30, note: 'a'.repeat(2000) });
    expect(errors).toHaveLength(0);
  });

  it('rejects invalid ISO datetime for workedAt', async () => {
    const errors = await validateCreate({ minutes: 30, workedAt: 'not-a-date' });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('accepts a valid ISO datetime for workedAt', async () => {
    const errors = await validateCreate({ minutes: 30, workedAt: '2026-06-01T08:00:00Z' });
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// UpdateWorkLogDto
// ---------------------------------------------------------------------------
describe('UpdateWorkLogDto', () => {
  it('accepts an empty body (all fields optional)', async () => {
    const errors = await validateUpdate({});
    expect(errors).toHaveLength(0);
  });

  it('accepts minutes=1 only', async () => {
    const errors = await validateUpdate({ minutes: 1 });
    expect(errors).toHaveLength(0);
  });

  it('accepts note only', async () => {
    const errors = await validateUpdate({ note: 'Reviewed PR' });
    expect(errors).toHaveLength(0);
  });

  it('accepts workedAt only', async () => {
    const errors = await validateUpdate({ workedAt: '2026-06-15T10:00:00.000Z' });
    expect(errors).toHaveLength(0);
  });

  it('accepts all fields together', async () => {
    const errors = await validateUpdate({
      minutes: 60,
      note: 'Wrote tests',
      workedAt: '2026-06-20T14:00:00.000Z',
    });
    expect(errors).toHaveLength(0);
  });

  it('rejects minutes=0', async () => {
    const errors = await validateUpdate({ minutes: 0 });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects negative minutes', async () => {
    const errors = await validateUpdate({ minutes: -5 });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects non-integer minutes', async () => {
    const errors = await validateUpdate({ minutes: 0.5 });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects note over 2000 characters', async () => {
    const errors = await validateUpdate({ note: 'z'.repeat(2001) });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects invalid workedAt format', async () => {
    const errors = await validateUpdate({ workedAt: 'yesterday' });
    expect(errors.length).toBeGreaterThan(0);
  });
});
