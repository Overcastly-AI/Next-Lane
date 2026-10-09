// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  isDialogOpen,
  isTypingTarget,
  nextNavIndex,
  ownsKeyboard,
  projectIdFromPath,
} from './useGlobalShortcuts';

describe('useGlobalShortcuts helpers', () => {
  it('extracts the project id from project routes only', () => {
    expect(projectIdFromPath('/projects/abc/board')).toBe('abc');
    expect(projectIdFromPath('/projects/abc')).toBe('abc');
    expect(projectIdFromPath('/my-work')).toBeNull();
  });

  it('lets Triage own its keyboard', () => {
    expect(ownsKeyboard('/projects/abc/triage')).toBe(true);
    expect(ownsKeyboard('/projects/abc/board')).toBe(false);
  });

  it('detects typing targets', () => {
    expect(isTypingTarget(document.createElement('input'))).toBe(true);
    expect(isTypingTarget(document.createElement('textarea'))).toBe(true);
    expect(isTypingTarget(document.createElement('select'))).toBe(true);
    const ce = document.createElement('div');
    ce.setAttribute('contenteditable', 'true');
    expect(isTypingTarget(ce)).toBe(true);
    expect(isTypingTarget(document.createElement('button'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });

  it('detects open dialogs', () => {
    expect(isDialogOpen(document)).toBe(false);
    const d = document.createElement('div');
    d.setAttribute('role', 'dialog');
    document.body.appendChild(d);
    expect(isDialogOpen(document)).toBe(true);
    d.remove();
  });

  it('clamps j/k navigation', () => {
    expect(nextNavIndex(-1, 3, 1)).toBe(0);
    expect(nextNavIndex(-1, 3, -1)).toBe(2);
    expect(nextNavIndex(2, 3, 1)).toBe(2);
    expect(nextNavIndex(0, 3, -1)).toBe(0);
    expect(nextNavIndex(1, 3, 1)).toBe(2);
    expect(nextNavIndex(0, 0, 1)).toBe(-1);
  });
});
