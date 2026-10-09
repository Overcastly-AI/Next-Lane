import { describe, it, expect } from 'vitest';
import {
  SAMPLE_ISSUES, SAMPLE_NAME, createSampleProject, isSampleProject, pickSampleKey,
  sampleStepCount, SampleSeedError, type SampleCall,
} from './sampleProject';

describe('pickSampleKey', () => {
  it('uses SAMPLE when free and skips taken keys', () => {
    expect(pickSampleKey([])).toBe('SAMPLE');
    expect(pickSampleKey(['sample'])).toBe('SAMPLE2');
    expect(pickSampleKey(['SAMPLE', 'SAMPLE2'])).toBe('SAMPLE3');
  });
});

describe('isSampleProject', () => {
  it('matches by name prefix', () => {
    expect(isSampleProject({ name: SAMPLE_NAME })).toBe(true);
    expect(isSampleProject({ name: 'Mobile app' })).toBe(false);
  });
});

function fakeCall(opts: { failOn?: string; conflictFirst?: boolean } = {}) {
  const calls: { path: string; method: string; body: any }[] = [];
  let conflicted = false;
  let n = 0;
  const call = (async (path: string, o: { method?: string; body?: any } = {}) => {
    calls.push({ path, method: o.method ?? 'GET', body: o.body });
    if (opts.failOn && path.includes(opts.failOn)) throw new Error('boom');
    if (path === '/projects' && opts.conflictFirst && !conflicted) {
      conflicted = true;
      throw new Error('Project key already in use');
    }
    if (path === '/projects') return { id: 'p1', key: o.body.key, name: o.body.name };
    if (path.endsWith('/board'))
      return { statuses: [
        { id: 's1', category: 'TODO', order: 0 },
        { id: 's2', category: 'IN_PROGRESS', order: 1 },
        { id: 's3', category: 'DONE', order: 2 },
      ] };
    return { id: `id${++n}` };
  }) as SampleCall;
  return { call, calls };
}

describe('createSampleProject', () => {
  it('creates everything and reports full progress', async () => {
    const { call, calls } = fakeCall();
    let last = 0;
    const p = await createSampleProject(call, 'w1', [], (pr) => { last = pr.done; });
    expect(p.id).toBe('p1');
    expect(last).toBe(sampleStepCount());
    expect(calls.filter((c) => c.path === '/issues')).toHaveLength(SAMPLE_ISSUES.length);
    const statuses = new Set(calls.filter((c) => c.path === '/issues').map((c) => c.body.statusId));
    expect(statuses.size).toBe(3);
    expect(calls.at(-1)?.body).toEqual({ state: 'ACTIVE' });
  });
  it('retries on key collision with the next key', async () => {
    const { call, calls } = fakeCall({ conflictFirst: true });
    await createSampleProject(call, 'w1', []);
    const keys = calls.filter((c) => c.path === '/projects').map((c) => c.body.key);
    expect(keys).toEqual(['SAMPLE', 'SAMPLE2']);
  });
  it('wraps partial failure with the created project', async () => {
    const { call } = fakeCall({ failOn: '/pages' });
    const err = await createSampleProject(call, 'w1', []).catch((e) => e);
    expect(err).toBeInstanceOf(SampleSeedError);
    expect(err.project.id).toBe('p1');
  });
});
