import { describe, it, expect } from 'vitest';
import { isSettledDateDraft, toDateInputValue } from './DateInput';

/**
 * The commit rule that makes date fields typeable. A native date input reports
 * a complete value on every year keystroke, so these are the exact drafts the
 * browser hands us while someone types 12/25/2031 — only the last one is a date
 * the user meant.
 */
describe('isSettledDateDraft', () => {
  it('rejects the drafts emitted while the year is still being typed', () => {
    expect(isSettledDateDraft('0002-12-25')).toBe(false);
    expect(isSettledDateDraft('0020-12-25')).toBe(false);
    expect(isSettledDateDraft('0203-12-25')).toBe(false);
  });

  it('accepts the draft once all four year digits are in', () => {
    expect(isSettledDateDraft('2031-12-25')).toBe(true);
    expect(isSettledDateDraft('1995-01-01')).toBe(true);
    expect(isSettledDateDraft('1000-01-01')).toBe(true);
  });

  it('treats an empty field as mid-edit — clearing is committed on blur', () => {
    expect(isSettledDateDraft('')).toBe(false);
  });
});

describe('toDateInputValue', () => {
  it('narrows an ISO timestamp to the date the input renders', () => {
    expect(toDateInputValue('2031-12-25T00:00:00.000Z')).toBe('2031-12-25');
  });

  it('passes a plain date through', () => {
    expect(toDateInputValue('2031-12-25')).toBe('2031-12-25');
  });

  it('maps every empty form to an empty input', () => {
    expect(toDateInputValue(null)).toBe('');
    expect(toDateInputValue(undefined)).toBe('');
    expect(toDateInputValue('')).toBe('');
  });
});
