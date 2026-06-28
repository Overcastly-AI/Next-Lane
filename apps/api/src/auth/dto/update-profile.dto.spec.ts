/**
 * Unit tests for UpdateProfileDto — validates that class-validator decorators
 * are correctly wired so invalid payloads produce validation errors (matching
 * what the global ValidationPipe rejects at the HTTP boundary).
 *
 * Driven via class-validator + class-transformer directly — no HTTP layer needed.
 */

import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateProfileDto } from './update-profile.dto';

async function validateDto(plain: Record<string, unknown>): Promise<string[]> {
  const instance = plainToInstance(UpdateProfileDto, plain);
  const errors = await validate(instance);
  return errors.map((e) => Object.values(e.constraints ?? {}).join(', '));
}

describe('UpdateProfileDto', () => {
  it('accepts an empty body (all fields optional)', async () => {
    const errors = await validateDto({});
    expect(errors).toHaveLength(0);
  });

  it('accepts a valid name string', async () => {
    const errors = await validateDto({ name: 'Alice Smith' });
    expect(errors).toHaveLength(0);
  });

  it('accepts emailNotifications: true', async () => {
    const errors = await validateDto({ emailNotifications: true });
    expect(errors).toHaveLength(0);
  });

  it('accepts emailNotifications: false', async () => {
    const errors = await validateDto({ emailNotifications: false });
    expect(errors).toHaveLength(0);
  });

  it('accepts both name and emailNotifications together', async () => {
    const errors = await validateDto({ name: 'Bob', emailNotifications: false });
    expect(errors).toHaveLength(0);
  });

  it('rejects a non-boolean emailNotifications value', async () => {
    const errors = await validateDto({ emailNotifications: 'yes' });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a name exceeding 80 characters', async () => {
    const errors = await validateDto({ name: 'a'.repeat(81) });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a non-string name value', async () => {
    const errors = await validateDto({ name: 123 });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('accepts a name of exactly 80 characters (boundary)', async () => {
    const errors = await validateDto({ name: 'a'.repeat(80) });
    expect(errors).toHaveLength(0);
  });
});
