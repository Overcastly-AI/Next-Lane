/**
 * Unit tests for UpsertAgentContextDto — mainly the 64 KB byte-length cap
 * (measured in UTF-8 bytes, not UTF-16 code units, so multi-byte characters
 * count correctly against on-disk/over-the-wire size).
 */

import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { AGENT_CONTEXT_MAX_BYTES, UpsertAgentContextDto } from './upsert-agent-context.dto';

async function validateDto(plain: Record<string, unknown>): Promise<string[]> {
  const instance = plainToInstance(UpsertAgentContextDto, plain);
  const errors = await validate(instance);
  return errors.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('UpsertAgentContextDto', () => {
  it('accepts an empty string (clearing the document)', async () => {
    const errors = await validateDto({ content: '' });
    expect(errors).toHaveLength(0);
  });

  it('accepts a normal markdown handoff document', async () => {
    const errors = await validateDto({
      content: '# Handoff\n\nCurrent goal: ship the feature.\n\n## Next steps\n- Write tests',
    });
    expect(errors).toHaveLength(0);
  });

  it('accepts content at exactly the 64 KB cap (boundary)', async () => {
    const content = 'a'.repeat(AGENT_CONTENT_TEST_MAX());
    const errors = await validateDto({ content });
    expect(errors).toHaveLength(0);
  });

  it('rejects content one byte over the 64 KB cap', async () => {
    const content = 'a'.repeat(AGENT_CONTENT_TEST_MAX() + 1);
    const errors = await validateDto({ content });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join(' ')).toMatch(/64 KB/);
  });

  it('measures multi-byte characters in UTF-8 bytes, not UTF-16 code units', async () => {
    // Each '中' is 1 UTF-16 code unit but 3 UTF-8 bytes — a naive @MaxLength
    // would under-count this relative to real storage size.
    const perCharBytes = 3;
    const charCount = Math.floor(AGENT_CONTENT_TEST_MAX() / perCharBytes) + 1;
    const content = '中'.repeat(charCount);
    expect(Buffer.byteLength(content, 'utf8')).toBeGreaterThan(AGENT_CONTENT_TEST_MAX());

    const errors = await validateDto({ content });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a non-string content value', async () => {
    const errors = await validateDto({ content: 12345 });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a missing content field', async () => {
    const errors = await validateDto({});
    expect(errors.length).toBeGreaterThan(0);
  });
});

function AGENT_CONTENT_TEST_MAX(): number {
  return AGENT_CONTEXT_MAX_BYTES;
}
