/**
 * Unit tests for AnalyticsQueryDto — validates that the global ValidationPipe's
 * rules are correctly expressed in the DTO class so invalid `days` values
 * produce 400s in the real app.
 *
 * We drive this through class-validator + class-transformer directly (the same
 * stack the global ValidationPipe uses) so no HTTP layer is needed.
 */

import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { AnalyticsQueryDto } from './analytics-query.dto';

async function validateDto(plain: Record<string, unknown>): Promise<string[]> {
  const instance = plainToInstance(AnalyticsQueryDto, plain);
  const errors = await validate(instance);
  return errors.map((e) => Object.values(e.constraints ?? {}).join(', '));
}

describe('AnalyticsQueryDto', () => {
  it('accepts a valid integer (days=30)', async () => {
    const errors = await validateDto({ days: '30' });
    expect(errors).toHaveLength(0);
  });

  it('accepts days=1 (minimum allowed)', async () => {
    const errors = await validateDto({ days: '1' });
    expect(errors).toHaveLength(0);
  });

  it('accepts days=366 (maximum allowed)', async () => {
    const errors = await validateDto({ days: '366' });
    expect(errors).toHaveLength(0);
  });

  it('accepts no days (optional field)', async () => {
    const errors = await validateDto({});
    expect(errors).toHaveLength(0);
  });

  it('rejects days=0 (below minimum)', async () => {
    const errors = await validateDto({ days: '0' });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects days=367 (above maximum)', async () => {
    const errors = await validateDto({ days: '367' });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects days=-1 (negative)', async () => {
    const errors = await validateDto({ days: '-1' });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a non-numeric string (abc)', async () => {
    const errors = await validateDto({ days: 'abc' });
    // 'abc' → Type(()=>Number) → NaN → @IsInt() fails
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a float (days=30.5)', async () => {
    const errors = await validateDto({ days: '30.5' });
    // 30.5 is not an integer → @IsInt() fails
    expect(errors.length).toBeGreaterThan(0);
  });
});
