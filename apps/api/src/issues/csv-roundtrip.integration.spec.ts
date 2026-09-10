/**
 * CSV export → import round trip: real app, real Postgres, real HTTP.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Founder report: "I deployed Next Lane on someone's computer and exported the
 * information and imported on their machine. It seems to not have all the
 * data."
 *
 * Export CSV and Import CSV are the only data-movement affordances in the
 * product UI, so they are what a user reaches for to move a project between
 * instances. `IssuesService.exportCsv()` writes 17 fixed columns plus one per
 * custom-field definition; `IssuesImportService.import()` read ten of them.
 * The other seven — Component, Fix Versions, Parent, Original Estimate, and
 * every `CF:` column — were parsed out of the file and dropped on the floor
 * with no error, no warning, and no line in the import report. The user is
 * told "Imported N issues" and reasonably believes the data moved.
 *
 * WHY AN INTEGRATION TEST AND NOT A UNIT TEST
 * A unit test with a mocked Prisma proves the mapper sets the fields it was
 * told to set. The question here is different: does a file that came out of
 * THIS product go back into THIS product with its content intact? That is a
 * claim about two real endpoints agreeing on a file format, including the
 * name-resolution both sides do against real rows (statuses, labels,
 * components, versions, custom-field definitions). Only a real round trip
 * answers it — and the bug is precisely that the two sides disagreed while
 * every unit test on both sides passed.
 *
 * WHAT IT PINS DOWN
 *   1. Every column the exporter writes is either imported or explicitly
 *      reported as skipped. Silence is the defect.
 *   2. Parent links survive, so an epic's children are still its children.
 *   3. Component and Fix Versions resolve by name, creating them in the target
 *      project when absent — the same create-or-match Labels already did.
 *   4. Custom-field VALUES land when the target project defines a field of the
 *      same name, and are reported (not silently dropped) when it does not.
 *   5. The columns that genuinely cannot round-trip (Key, Reporter, Created,
 *      Updated) are named in the report rather than dropped in silence.
 *
 * Run: DATABASE_URL=<url> JWT_SECRET=<secret> pnpm --filter @next-lane/api test:isolation
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as http from 'http';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';

const HAS_DB = Boolean(process.env.DATABASE_URL);

let server: http.Server;

async function call(
  method: string,
  path: string,
  token?: string,
  body?: unknown,
): Promise<{ status: number; text: string }> {
  const addr = server.address() as { port: number };
  const url = `http://127.0.0.1:${addr.port}/api${path}`;
  const resp = await fetch(url, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: resp.status, text: await resp.text() };
}

/** POST/GET returning parsed JSON, failing loudly with the body on non-2xx. */
async function ok<T>(
  method: string,
  path: string,
  token?: string,
  body?: unknown,
): Promise<T> {
  const r = await call(method, path, token, body);
  if (r.status >= 300) {
    throw new Error(`${method} ${path} → ${r.status}: ${r.text}`);
  }
  return JSON.parse(r.text) as T;
}

interface IssueShape {
  id: string;
  key: string;
  title: string;
  type: string;
  storyPoints?: number | null;
  originalEstimateMinutes?: number | null;
  parent?: { id: string; title?: string } | null;
  component?: { id: string; name: string } | null;
  versions?: { id: string; name: string }[];
  customFields?: Record<string, unknown> | null;
  labels?: { name: string }[];
}

(HAS_DB ? describe : describe.skip)('CSV export → import round trip', () => {
  jest.setTimeout(120_000);

  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let sourceProjectId: string;
  let targetProjectId: string;
  let csv: string;

  const uniq = `rt${Date.now().toString(36)}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api', { exclude: ['health', 'health/live'] });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    await app.listen(0);
    server = app.getHttpServer() as http.Server;
    prisma = app.get(PrismaService);

    // ── Source instance: a project with the full field surface populated ────
    const auth = await ok<{ accessToken: string }>('POST', '/auth/register', undefined, {
      email: `${uniq}@example.com`,
      name: 'Round Trip',
      password: 'password123',
    });
    token = auth.accessToken;

    const ws = await ok<{ id: string }>('POST', '/workspaces', token, {
      name: `RT ${uniq}`,
    });

    const source = await ok<{ id: string }>('POST', '/projects', token, {
      workspaceId: ws.id,
      key: `SRC${uniq.slice(-4).toUpperCase()}`.slice(0, 10),
      name: 'Source',
    });
    sourceProjectId = source.id;

    const target = await ok<{ id: string }>('POST', '/projects', token, {
      workspaceId: ws.id,
      key: `DST${uniq.slice(-4).toUpperCase()}`.slice(0, 10),
      name: 'Target',
    });
    targetProjectId = target.id;

    // Structure that the export writes columns for.
    const component = await ok<{ id: string }>(
      'POST',
      `/projects/${sourceProjectId}/components`,
      token,
      { name: 'Billing' },
    );
    const version = await ok<{ id: string }>(
      'POST',
      `/projects/${sourceProjectId}/versions`,
      token,
      { name: '2.1.0' },
    );
    const cfText = await ok<{ id: string }>(
      'POST',
      `/projects/${sourceProjectId}/custom-fields`,
      token,
      { name: 'Customer', type: 'TEXT' },
    );

    // The SAME custom field exists in the target project — a real migration
    // recreates its configuration before importing the issues.
    await ok('POST', `/projects/${targetProjectId}/custom-fields`, token, {
      name: 'Customer',
      type: 'TEXT',
    });

    const epic = await ok<IssueShape>('POST', '/issues', token, {
      projectId: sourceProjectId,
      title: 'Payments platform',
      type: 'EPIC',
    });

    await ok<IssueShape>('POST', '/issues', token, {
      projectId: sourceProjectId,
      title: 'Refund a charge',
      type: 'STORY',
      parentId: epic.id,
      componentId: component.id,
      storyPoints: 5,
      originalEstimateMinutes: 240,
      customFields: { [cfText.id]: 'Acme Corp' },
    });

    // Fix Versions is a separate PUT, mirroring how the UI assigns them.
    const issues = await ok<{ items: IssueShape[] }>(
      'GET',
      `/issues?projectId=${sourceProjectId}`,
      token,
    );
    const story = issues.items.find((i) => i.title === 'Refund a charge')!;
    await ok('PUT', `/issues/${story.id}/versions`, token, {
      versionIds: [version.id],
    });

    // ── The export the user downloads ──────────────────────────────────────
    const exported = await call(
      'GET',
      `/projects/${sourceProjectId}/issues.csv`,
      token,
    );
    expect(exported.status).toBe(200);
    csv = exported.text;
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it('exports the columns this test claims to be about', () => {
    const header = csv.split('\n')[0];
    for (const col of [
      'Parent',
      'Component',
      'Fix Versions',
      'Original Estimate (minutes)',
      'CF: Customer',
    ]) {
      expect(header).toContain(col);
    }
  });

  describe('importing that exact file into a fresh project', () => {
    let report: {
      created: number;
      skipped: number;
      errors: { row: number; message: string }[];
      warnings?: { row: number; message: string }[];
      unimportedColumns?: { column: string; reason: string }[];
    };
    let imported: IssueShape[];

    beforeAll(async () => {
      report = await ok('POST', `/projects/${targetProjectId}/issues/import`, token, {
        csv,
      });
      const list = await ok<{ items: IssueShape[] }>(
        'GET',
        `/issues?projectId=${targetProjectId}`,
        token,
      );
      imported = list.items;
    });

    it('creates every exported row', () => {
      expect(report.errors).toEqual([]);
      expect(report.created).toBe(2);
      expect(imported).toHaveLength(2);
    });

    it('keeps the epic → story parent link', async () => {
      const story = imported.find((i) => i.title === 'Refund a charge')!;
      const epic = imported.find((i) => i.title === 'Payments platform')!;
      // The list response carries no parent relation — only the detail route
      // includes it, so read the issue the way the drawer does.
      const detail = await ok<IssueShape>('GET', `/issues/${story.id}`, token);
      expect(detail.parent?.id).toBe(epic.id);
    });

    it('resolves Component by name, creating it in the target project', () => {
      const story = imported.find((i) => i.title === 'Refund a charge')!;
      expect(story.component?.name).toBe('Billing');
    });

    it('resolves Fix Versions by name, creating them in the target project', () => {
      const story = imported.find((i) => i.title === 'Refund a charge')!;
      expect(story.versions?.map((v) => v.name)).toEqual(['2.1.0']);
    });

    it('carries the original estimate', () => {
      const story = imported.find((i) => i.title === 'Refund a charge')!;
      expect(story.originalEstimateMinutes).toBe(240);
    });

    it('carries custom-field values into the matching field definition', async () => {
      const story = imported.find((i) => i.title === 'Refund a charge')!;
      const defs = await ok<{ id: string; name: string }[]>(
        'GET',
        `/projects/${targetProjectId}/custom-fields`,
        token,
      );
      const customerDef = defs.find((d) => d.name === 'Customer')!;
      expect(story.customFields?.[customerDef.id]).toBe('Acme Corp');
    });

    it('names the columns it could not import instead of dropping them silently', () => {
      // Key/Reporter/Created/Updated cannot round-trip: keys are assigned by
      // the target project, and authorship/timestamps belong to the importing
      // user and the write itself. That is defensible — being silent about it
      // is not, because silence is indistinguishable from "it all came over".
      const named = (report.unimportedColumns ?? []).map((c) => c.column);
      expect(named).toEqual(
        expect.arrayContaining(['Key', 'Reporter', 'Sprint', 'Created', 'Updated']),
      );
      // Every entry says WHY, or the report is just a different kind of silence.
      for (const entry of report.unimportedColumns ?? []) {
        expect(entry.reason.length).toBeGreaterThan(0);
      }
      // The columns this fix taught the importer to apply must NOT appear here.
      expect(named).not.toContain('Parent');
      expect(named).not.toContain('Component');
      expect(named).not.toContain('Fix Versions');
      expect(named).not.toContain('CF: Customer');
    });

    it('imports cleanly, with nothing left unexplained', () => {
      expect(report.warnings ?? []).toEqual([]);
    });
  });
});
