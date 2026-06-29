import { describe, expect, it } from 'vitest';
import { ConfigError, DEFAULT_API_URL, loadConfig } from './config.js';

describe('loadConfig', () => {
  it('throws ConfigError with an actionable message when NEXT_LANE_TOKEN is missing', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({})).toThrow(/NEXT_LANE_TOKEN is required/);
  });

  it('throws when NEXT_LANE_TOKEN is blank/whitespace', () => {
    expect(() => loadConfig({ NEXT_LANE_TOKEN: '   ' })).toThrow(ConfigError);
  });

  it('defaults the API URL when only the token is provided', () => {
    const cfg = loadConfig({ NEXT_LANE_TOKEN: 'nlp_abc' });
    expect(cfg.token).toBe('nlp_abc');
    expect(cfg.apiUrl).toBe(DEFAULT_API_URL);
  });

  it('normalizes a trailing slash and an accidental /api suffix', () => {
    expect(
      loadConfig({ NEXT_LANE_TOKEN: 't', NEXT_LANE_API_URL: 'http://h:4000/' })
        .apiUrl,
    ).toBe('http://h:4000');
    expect(
      loadConfig({ NEXT_LANE_TOKEN: 't', NEXT_LANE_API_URL: 'http://h:4000/api' })
        .apiUrl,
    ).toBe('http://h:4000');
  });
});
