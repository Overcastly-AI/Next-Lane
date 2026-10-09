import { describe, expect, it } from 'vitest';
import { parseChangelog } from './changelog';

const MD = `# Changelog

## [Unreleased]

_nothing_

## [0.20.0] — 2026-09-23

[Compare with v0.19.0](https://example.com/compare)

### Features

* **web:** design pass on the drawer ([#105](https://x/issues/105)) ([a8af174](https://x/commit/a8af174))
* plain item without scope

### Bug Fixes

* **api:** wrapped
  continuation line ([#9](https://x/9))

## [0.19.0] — 2026-09-22

### Features

* **web:** older

## [0.18.0]

### Features

* **web:** oldest
`;

describe('parseChangelog', () => {
  it('skips Unreleased and returns newest first', () => {
    const e = parseChangelog(MD);
    expect(e.map((x) => x.version)).toEqual(['0.20.0', '0.19.0', '0.18.0']);
    expect(e[0].date).toBe('2026-09-23');
    expect(e[2].date).toBeNull();
  });

  it('extracts scope, text and refs', () => {
    const [first] = parseChangelog(MD)[0].sections[0].items;
    expect(first.scope).toBe('web');
    expect(first.text).toBe('design pass on the drawer');
    expect(first.refs.map((r) => r.label)).toEqual(['#105', 'a8af174']);
  });

  it('handles unscoped items and wrapped lines', () => {
    const e = parseChangelog(MD)[0];
    expect(e.sections[0].items[1]).toMatchObject({ scope: null, text: 'plain item without scope' });
    expect(e.sections[1].items[0].text).toBe('wrapped continuation line');
  });

  it('respects the limit and tolerates empty input', () => {
    expect(parseChangelog(MD, 2)).toHaveLength(2);
    expect(parseChangelog('')).toEqual([]);
  });
});
