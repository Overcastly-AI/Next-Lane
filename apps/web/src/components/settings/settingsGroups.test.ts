import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROJECT_SETTINGS_GROUP,
  PROJECT_SETTINGS_GROUPS,
} from './settingsGroups';

describe('PROJECT_SETTINGS_GROUPS', () => {
  it('covers the five groups the spec defines', () => {
    expect(PROJECT_SETTINGS_GROUPS.map((g) => g.to)).toEqual([
      'general',
      'people',
      'work',
      'templates',
      'integrations',
    ]);
  });

  // Agents is a tab, not a settings group. This is asserted rather than
  // merely omitted because the pair has already migrated between the two
  // homes once; a future tidy-up that re-buries them fails here first.
  it('has no Agents group — agent access and context live on the Agents tab', () => {
    expect(PROJECT_SETTINGS_GROUPS.map((g) => g.to)).not.toContain('agents');
  });

  it('has a unique route segment per group', () => {
    const segments = PROJECT_SETTINGS_GROUPS.map((g) => g.to);
    expect(new Set(segments).size).toBe(segments.length);
  });

  it('gives every group a label and a description for the rail', () => {
    for (const group of PROJECT_SETTINGS_GROUPS) {
      expect(group.label.length).toBeGreaterThan(0);
      expect(group.description.length).toBeGreaterThan(0);
    }
  });

  // The default is what `/projects/:id/settings` redirects to. If it ever
  // named a group that does not exist, that redirect would fall through to
  // the app-level catch-all and the old URL — which is in docs, the README
  // and MCP output — would silently eject the user to `/`.
  it('defaults to a group that exists', () => {
    expect(PROJECT_SETTINGS_GROUPS.map((g) => g.to)).toContain(
      DEFAULT_PROJECT_SETTINGS_GROUP,
    );
  });
});
