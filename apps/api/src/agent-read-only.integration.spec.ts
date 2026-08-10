/**
 * Project agent-lock: real app, real Postgres, real HTTP.
 *
 * Founder: "I want to be able to lock a board so that the MCP server cannot
 * update it. Just read it." — scoped, on their follow-up, to "lock a project
 * and it going into read only for the MCP".
 *
 * WHY THIS IS AN INTEGRATION TEST AND NOT A UNIT TEST
 * ───────────────────────────────────────────────────
 * This is a security control, and the only claim worth making about one is
 * that it holds on the real routes. The enforcement lives in
 * `common/membership.util.ts` — the helper every project-scoped permission
 * check already funnels through — and it reads the caller's identity out of an
 * AsyncLocalStorage context opened by `RequestContextMiddleware` and stamped by
 * `JwtAuthGuard`. A unit test could mock all three and prove nothing: the
 * question is whether the context actually survives the middleware → guard →
 * pipe → handler → service chain in the built app, and whether every one of
 * these routes really does go through the chokepoint. Only real HTTP answers
 * that.
 *
 * WHAT IT PINS DOWN
 *   1. Reads keep working for the agent. A lock that broke reads would be a
 *      different (and useless) feature.
 *   2. Writes are refused, across a spread of routes owned by different
 *      modules — issues, comments, labels, sprints, the project itself — so
 *      the coverage claim is not "the one endpoint I remembered".
 *   3. The lock defends its own switch: an agent cannot clear it.
 *   4. People are untouched. Same requests, browser session, all succeed.
 *   5. It is project-scoped, not global: a second, unlocked project in the
 *      same workspace still accepts agent writes.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as http from 'http';

const HAS_DB = Boolean(process.env.DATABASE_URL);

async function req(
  server: http.Server,
  method: string,
  path: string,
  token: string,
  body?: unknown,
): Promise<{ status: number; body: string }> {
  const addr = server.address() as { port: number };
  const url = `http://127.0.0.1:${addr.port}/api${path}`;
  const resp = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: resp.status, body: await resp.text() };
}

const json = <T>(raw: string): T => JSON.parse(raw) as T;

(HAS_DB ? describe : describe.skip)('Project agent lock (real HTTP)', () => {
  let app: INestApplication;
  let server: http.Server;

  /** Browser-session JWT — a person. */
  let jwt = '';
  /** Personal Access Token — what the MCP server holds. */
  let pat = '';
  let lockedProjectId = '';
  let openProjectId = '';
  let issueId = '';
  let openIssueId = '';

  beforeAll(async () => {
    const { AppModule } = await import('./app.module');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api', { exclude: ['health', 'health/live'] });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    server = app.getHttpServer() as http.Server;
    server.listen(0);

    const stamp = Date.now();
    const reg = await req(server, 'POST', '/auth/register', '', {
      name: 'Agent Lock QA',
      email: `agent-lock-${stamp}@test.example`,
      password: 'AgentLock#1',
    });
    expect(reg.status).toBe(201);
    jwt = json<{ accessToken: string }>(reg.body).accessToken;

    const tok = await req(server, 'POST', '/me/tokens', jwt, {
      name: 'mcp-agent',
    });
    expect(tok.status).toBe(201);
    pat = json<{ rawToken: string }>(tok.body).rawToken;

    const ws = await req(server, 'POST', '/workspaces', jwt, {
      name: `Agent Lock WS ${stamp}`,
      slug: `agentlock${stamp}`,
    });
    expect(ws.status).toBe(201);
    const workspaceId = json<{ id: string }>(ws.body).id;

    const mk = async (key: string, name: string) => {
      const p = await req(server, 'POST', '/projects', jwt, {
        workspaceId,
        key,
        name,
      });
      expect(p.status).toBe(201);
      return json<{ id: string }>(p.body).id;
    };
    lockedProjectId = await mk(`L${String(stamp).slice(-4)}`, 'Locked project');
    openProjectId = await mk(`O${String(stamp).slice(-4)}`, 'Open project');

    const mkIssue = async (projectId: string) => {
      const i = await req(server, 'POST', '/issues', jwt, {
        projectId,
        title: 'Seed issue',
      });
      expect(i.status).toBe(201);
      return json<{ id: string }>(i.body).id;
    };
    issueId = await mkIssue(lockedProjectId);
    openIssueId = await mkIssue(openProjectId);
  }, 90_000);

  afterAll(async () => {
    await app?.close();
  });

  it('lets the agent write freely before the lock is on', async () => {
    const r = await req(server, 'PATCH', `/issues/${issueId}`, pat, {
      title: 'agent edit, pre-lock',
    });
    expect(r.status).toBe(200);
  });

  it('turns on only for an ADMIN, through the project endpoint', async () => {
    const r = await req(server, 'PATCH', `/projects/${lockedProjectId}`, jwt, {
      agentReadOnly: true,
    });
    expect(r.status).toBe(200);
    expect(json<{ agentReadOnly: boolean }>(r.body).agentReadOnly).toBe(true);
  });

  it('still lets the agent READ everything', async () => {
    const list = await req(
      server,
      'GET',
      `/issues?projectId=${lockedProjectId}`,
      pat,
    );
    expect(list.status).toBe(200);

    const one = await req(server, 'GET', `/issues/${issueId}`, pat);
    expect(one.status).toBe(200);

    const project = await req(
      server,
      'GET',
      `/projects/${lockedProjectId}`,
      pat,
    );
    expect(project.status).toBe(200);
    // And it can SEE that it is locked, so a well-behaved agent need not
    // discover the rule by being refused.
    expect(json<{ agentReadOnly: boolean }>(project.body).agentReadOnly).toBe(
      true,
    );
  });

  /*
   * Deliberately spread across modules. Each of these reaches the chokepoint
   * by a different path, so a regression that reintroduces a bypass in any one
   * module fails here rather than being discovered by someone's agent.
   */
  const writes: Array<{
    what: string;
    method: string;
    path: () => string;
    body: () => unknown;
  }> = [
    {
      what: 'edit an issue',
      method: 'PATCH',
      path: () => `/issues/${issueId}`,
      body: () => ({ title: 'agent edit, post-lock' }),
    },
    {
      what: 'create an issue',
      method: 'POST',
      path: () => '/issues',
      body: () => ({ projectId: lockedProjectId, title: 'agent new' }),
    },
    {
      what: 'comment on an issue',
      method: 'POST',
      path: () => `/issues/${issueId}/comments`,
      body: () => ({ body: 'agent comment' }),
    },
    {
      what: 'create a label',
      method: 'POST',
      path: () => `/projects/${lockedProjectId}/labels`,
      body: () => ({ name: `agent-${Date.now()}`, color: '#ef4444' }),
    },
    {
      what: 'create a sprint',
      method: 'POST',
      path: () => `/projects/${lockedProjectId}/sprints`,
      body: () => ({ name: `agent sprint ${Date.now()}` }),
    },
    {
      what: 'rename the project',
      method: 'PATCH',
      path: () => `/projects/${lockedProjectId}`,
      body: () => ({ name: 'renamed by agent' }),
    },
  ];

  it.each(writes)('refuses the agent trying to $what', async (w) => {
    const r = await req(server, w.method, w.path(), pat, w.body());
    expect(r.status).toBe(403);
    // The message has to say what to do about it — an agent relays this to
    // whoever is reading its output.
    expect(r.body).toContain('read-only');
  });

  it('will not let the agent unlock the project it is locked out of', async () => {
    const r = await req(server, 'PATCH', `/projects/${lockedProjectId}`, pat, {
      agentReadOnly: false,
    });
    expect(r.status).toBe(403);

    // And it really is still locked.
    const check = await req(server, 'GET', `/projects/${lockedProjectId}`, jwt);
    expect(json<{ agentReadOnly: boolean }>(check.body).agentReadOnly).toBe(
      true,
    );
  });

  it.each(writes)('still lets a person $what', async (w) => {
    const r = await req(server, w.method, w.path(), jwt, w.body());
    expect([200, 201]).toContain(r.status);
  });

  it('leaves other projects alone — the lock is not global', async () => {
    const r = await req(server, 'PATCH', `/issues/${openIssueId}`, pat, {
      title: 'agent edit in the unlocked project',
    });
    expect(r.status).toBe(200);
  });

  it('lets a person turn it back off, and the agent writes again', async () => {
    const off = await req(
      server,
      'PATCH',
      `/projects/${lockedProjectId}`,
      jwt,
      { agentReadOnly: false },
    );
    expect(off.status).toBe(200);
    expect(json<{ agentReadOnly: boolean }>(off.body).agentReadOnly).toBe(false);

    const r = await req(server, 'PATCH', `/issues/${issueId}`, pat, {
      title: 'agent edit, unlocked again',
    });
    expect(r.status).toBe(200);
  });
});
