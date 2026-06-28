/**
 * Unit tests for CreateChecklistItemDto and UpdateChecklistItemDto — validates
 * that class-validator rules are correctly expressed so invalid inputs produce
 * 400s in the real app.
 *
 * Driven through class-validator + class-transformer directly (the same stack
 * the global ValidationPipe uses); no HTTP layer needed.
 */

import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  CreateChecklistItemDto,
  UpdateChecklistItemDto,
} from './checklist.dto';

async function validateCreate(plain: Record<string, unknown>): Promise<string[]> {
  const instance = plainToInstance(CreateChecklistItemDto, plain);
  const errors = await validate(instance);
  return errors.map((e) => Object.values(e.constraints ?? {}).join(', '));
}

async function validateUpdate(plain: Record<string, unknown>): Promise<string[]> {
  const instance = plainToInstance(UpdateChecklistItemDto, plain);
  const errors = await validate(instance);
  return errors.map((e) => Object.values(e.constraints ?? {}).join(', '));
}

// ---------------------------------------------------------------------------
// CreateChecklistItemDto
// ---------------------------------------------------------------------------
describe('CreateChecklistItemDto', () => {
  it('accepts a valid text', async () => {
    const errors = await validateCreate({ text: 'Write unit tests' });
    expect(errors).toHaveLength(0);
  });

  it('rejects empty text', async () => {
    const errors = await validateCreate({ text: '' });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects missing text', async () => {
    const errors = await validateCreate({});
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects text over 2000 characters', async () => {
    const errors = await validateCreate({ text: 'a'.repeat(2001) });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('accepts text at exactly 2000 characters', async () => {
    const errors = await validateCreate({ text: 'a'.repeat(2000) });
    expect(errors).toHaveLength(0);
  });

  it('rejects non-string text (number)', async () => {
    const errors = await validateCreate({ text: 42 });
    expect(errors.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// UpdateChecklistItemDto
// ---------------------------------------------------------------------------
describe('UpdateChecklistItemDto', () => {
  it('accepts an empty body (all fields optional)', async () => {
    const errors = await validateUpdate({});
    expect(errors).toHaveLength(0);
  });

  it('accepts text only', async () => {
    const errors = await validateUpdate({ text: 'Updated text' });
    expect(errors).toHaveLength(0);
  });

  it('accepts done=true only', async () => {
    const errors = await validateUpdate({ done: true });
    expect(errors).toHaveLength(0);
  });

  it('accepts done=false only', async () => {
    const errors = await validateUpdate({ done: false });
    expect(errors).toHaveLength(0);
  });

  it('accepts order=0', async () => {
    const errors = await validateUpdate({ order: 0 });
    expect(errors).toHaveLength(0);
  });

  it('accepts all fields together', async () => {
    const errors = await validateUpdate({ text: 'Task', done: true, order: 3 });
    expect(errors).toHaveLength(0);
  });

  it('rejects empty text', async () => {
    const errors = await validateUpdate({ text: '' });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects text over 2000 characters', async () => {
    const errors = await validateUpdate({ text: 'a'.repeat(2001) });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects non-boolean done', async () => {
    const errors = await validateUpdate({ done: 'yes' });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects negative order', async () => {
    const errors = await validateUpdate({ order: -1 });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects non-integer order', async () => {
    const errors = await validateUpdate({ order: 1.5 });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects non-string text (number)', async () => {
    const errors = await validateUpdate({ text: 99 });
    expect(errors.length).toBeGreaterThan(0);
  });
});
