/**
 * Unit tests for CreateQuickLinkDto / UpdateQuickLinkDto — confirms the
 * class-validator rules reject the inputs we care about (empty label, non-http
 * URLs like javascript:, over-long values) so bad payloads produce 400s.
 */
import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateQuickLinkDto, UpdateQuickLinkDto } from './quick-link.dto';

async function errorsFor<T extends object>(
  cls: new () => T,
  plain: Record<string, unknown>,
): Promise<string[]> {
  const instance = plainToInstance(cls, plain);
  const errors = await validate(instance);
  return errors.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('CreateQuickLinkDto', () => {
  it('accepts a valid label + https url', async () => {
    expect(
      await errorsFor(CreateQuickLinkDto, {
        label: 'Grafana',
        url: 'https://grafana.example.com',
      }),
    ).toHaveLength(0);
  });

  it('accepts http urls', async () => {
    expect(
      await errorsFor(CreateQuickLinkDto, {
        label: 'Local',
        url: 'http://localhost:3000',
      }),
    ).toHaveLength(0);
  });

  it('rejects a javascript: url (no protocol allowlist match)', async () => {
    const errors = await errorsFor(CreateQuickLinkDto, {
      label: 'Bad',
      url: 'javascript:alert(1)',
    });
    expect(errors.join(' ')).toContain('valid http(s) URL');
  });

  it('rejects an empty label', async () => {
    const errors = await errorsFor(CreateQuickLinkDto, {
      label: '',
      url: 'https://x.example.com',
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('trims surrounding whitespace before validating', async () => {
    expect(
      await errorsFor(CreateQuickLinkDto, {
        label: '  Grafana  ',
        url: '  https://grafana.example.com  ',
      }),
    ).toHaveLength(0);
  });

  it('accepts a valid hex color and a group name', async () => {
    expect(
      await errorsFor(CreateQuickLinkDto, {
        label: 'Grafana',
        url: 'https://grafana.example.com',
        color: '#2563eb',
        group: 'Monitoring',
      }),
    ).toHaveLength(0);
  });

  it('treats empty color/group strings as unset (no error)', async () => {
    expect(
      await errorsFor(CreateQuickLinkDto, {
        label: 'Grafana',
        url: 'https://grafana.example.com',
        color: '',
        group: '   ',
      }),
    ).toHaveLength(0);
  });

  it('rejects a non-hex color', async () => {
    const errors = await errorsFor(CreateQuickLinkDto, {
      label: 'Grafana',
      url: 'https://grafana.example.com',
      color: 'blue',
    });
    expect(errors.join(' ')).toContain('hex color');
  });

  it('rejects an over-long group name', async () => {
    const errors = await errorsFor(CreateQuickLinkDto, {
      label: 'Grafana',
      url: 'https://grafana.example.com',
      group: 'x'.repeat(41),
    });
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('UpdateQuickLinkDto', () => {
  it('accepts a partial update (label only)', async () => {
    expect(
      await errorsFor(UpdateQuickLinkDto, { label: 'Renamed' }),
    ).toHaveLength(0);
  });

  it('accepts an empty object (no fields)', async () => {
    expect(await errorsFor(UpdateQuickLinkDto, {})).toHaveLength(0);
  });

  it('rejects a negative order', async () => {
    const errors = await errorsFor(UpdateQuickLinkDto, { order: -1 });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a non-http url when provided', async () => {
    const errors = await errorsFor(UpdateQuickLinkDto, {
      url: 'ftp://files.example.com',
    });
    expect(errors.join(' ')).toContain('valid http(s) URL');
  });
});
