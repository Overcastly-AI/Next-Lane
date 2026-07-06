/**
 * PAT-scope route-coverage guard.
 *
 * WHAT THIS TESTS
 * ───────────────
 * `pat-scope-rollout.integration.spec.ts` proves the DENY/ALLOW *behavior* of
 * every route in its matrix, but nothing previously stopped that matrix from
 * silently drifting from reality: a new controller route could ship with no
 * `@RequireScope` at all, or a `@RequireScope`-decorated route could simply
 * never get added to the matrix (this is not hypothetical — writing this
 * spec caught exactly that: `github.controller.ts` and `gitlab.controller.ts`
 * have been `@RequireScope`-gated since before the "Hardening Night" rollout,
 * but were never added to the matrix; see the `github`/`gitlab` rows added to
 * `pat-scope-matrix.fixture.ts` in the same commit as this spec).
 *
 * This spec boots the REAL app (via Nest's `DiscoveryService`/
 * `MetadataScanner`, no mocks) and walks every registered controller route,
 * then asserts, for every route:
 *
 *   (a) it either carries `@RequireScope` metadata, OR it is on the
 *       explicit, reasoned `EXEMPTIONS` allowlist below (one entry per
 *       route, each with a `category` drawn from a closed set and a
 *       human-readable `reason` — no bare `true`/wildcard exemptions).
 *   (b) if it carries `@RequireScope`, the (method, route-pattern) pair
 *       appears in the shared `MATRIX` fixture (imported from
 *       `pat-scope-matrix.fixture.ts`, NOT duplicated here) with the exact
 *       scope the decorator declares.
 *   (c) every `MATRIX` row corresponds to a real, currently-registered
 *       route (catches the opposite drift: a stale matrix row for a route
 *       that was renamed/removed).
 *   (d) every `EXEMPTIONS` entry corresponds to a real, currently-registered
 *       route (catches a stale exemption for a route that no longer exists,
 *       which would otherwise silently widen the allowlist forever).
 *
 * PROVING IT FAILS (see commit message / PR description for the transcript):
 * temporarily removing `@RequireScope('issues:write')` from
 * `issues.controller.ts#create` (and not adding an exemption) makes this
 * spec fail with a message naming the exact unscoped route; reverting makes
 * it pass again. That round-trip is the acceptance proof for this file.
 *
 * WHY AN INTEGRATION SPEC (needs DB)
 * ───────────────────────────────────
 * Booting `AppModule` triggers `PrismaService#onModuleInit` (`$connect()`),
 * so this cannot run DB-free the way a pure unit spec could; it needs the
 * same real Postgres the sibling `pat-scope-rollout` / `tenant-isolation`
 * integration specs use. It never issues a query — no data is created,
 * fixture-free — but the app cannot reach `app.init()` without a reachable
 * `DATABASE_URL`. Placed alongside the other `*.integration.spec.ts` files so
 * it runs in the same `jest.integration.config.js` CI lane.
 *
 * HOW TO RUN
 * ──────────
 *   DATABASE_URL=... JWT_SECRET=local-dev-secret \
 *     pnpm --filter @next-lane/api exec jest --config jest.integration.config.js pat-scope-coverage
 */

import { INestApplication } from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, DiscoveryModule } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { REQUIRE_SCOPE_KEY } from './auth/require-scope.decorator';
import { IS_PUBLIC_KEY } from './auth/public.decorator';
import { MATRIX, normalizeRoutePattern } from './pat-scope-matrix.fixture';

const DB_URL = process.env.DATABASE_URL;
const HAS_DB = Boolean(DB_URL);

const REQUEST_METHOD_NAME: Record<number, string> = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.DELETE]: 'DELETE',
  [RequestMethod.PATCH]: 'PATCH',
  [RequestMethod.ALL]: 'ALL',
  [RequestMethod.OPTIONS]: 'OPTIONS',
  [RequestMethod.HEAD]: 'HEAD',
};

interface DiscoveredRoute {
  controllerName: string;
  methodName: string;
  httpMethod: string;
  /** Route pattern as Nest registers it, e.g. `/projects/:projectId/github`. */
  pattern: string;
  scope: string | undefined;
  isPublic: boolean;
}

/** Join a controller-level prefix and a method-level path into one route pattern. */
function joinPath(prefix: string, methodPath: string): string {
  const parts = [prefix, methodPath]
    .flatMap((segment) => segment.split('/'))
    .filter((segment) => segment.length > 0);
  return '/' + parts.join('/');
}

async function discoverRoutes(app: INestApplication): Promise<DiscoveredRoute[]> {
  const discovery = app.get(DiscoveryService);
  const scanner = new MetadataScanner();
  const controllers = discovery.getControllers();

  const routes: DiscoveredRoute[] = [];

  for (const wrapper of controllers) {
    const { instance, metatype } = wrapper;
    if (!instance || !metatype) continue;

    const prototype = Object.getPrototypeOf(instance);
    const controllerPrefix: string | string[] =
      Reflect.getMetadata(PATH_METADATA, metatype) ?? '';
    // No controller in this codebase uses array-style @Controller([...]) —
    // guard against it explicitly rather than silently mis-scanning one that
    // starts doing so in the future.
    if (Array.isArray(controllerPrefix)) {
      throw new Error(
        `${metatype.name} uses an array @Controller(prefix) — pat-scope-coverage's ` +
          'route walk assumes a single string prefix; extend discoverRoutes() before adding this.',
      );
    }

    const methodNames = scanner.getAllMethodNames(prototype);
    for (const methodName of methodNames) {
      const handler = instance[methodName as keyof typeof instance] as unknown;
      if (typeof handler !== 'function') continue;

      const methodPath: string | string[] | undefined = Reflect.getMetadata(
        PATH_METADATA,
        handler,
      );
      const httpMethodCode: number | undefined = Reflect.getMetadata(METHOD_METADATA, handler);
      // Not a route handler (a plain helper method on the controller class).
      if (methodPath === undefined || httpMethodCode === undefined) continue;
      if (Array.isArray(methodPath)) {
        throw new Error(
          `${metatype.name}#${methodName} uses an array route path — extend ` +
            'discoverRoutes() before adding this.',
        );
      }

      const scope: string | undefined = Reflect.getMetadata(REQUIRE_SCOPE_KEY, handler);
      const isPublic: boolean = Reflect.getMetadata(IS_PUBLIC_KEY, handler) === true;

      routes.push({
        controllerName: metatype.name,
        methodName,
        httpMethod: REQUEST_METHOD_NAME[httpMethodCode] ?? String(httpMethodCode),
        pattern: joinPath(controllerPrefix, methodPath),
        scope,
        isPublic,
      });
    }
  }

  return routes;
}

/**
 * Explicit, reasoned exemption allowlist — every route that intentionally
 * carries NO `@RequireScope`. Categories mirror the in-code exemption
 * rationale documented on the controllers themselves as of the 4aec12a
 * Hardening Night rollout (`auth.controller.ts`, `oidc.controller.ts`,
 * `health.controller.ts`, `public.controller.ts`, `me.controller.ts`,
 * `personal-boards.controller.ts`), plus the inbound webhook receivers.
 *
 * Every entry MUST correspond to a real registered route (enforced below) —
 * a stale entry here for a removed/renamed route fails the spec, so this
 * list can't silently grow beyond what's actually shipped.
 */
type ExemptionCategory =
  | 'auth'
  | 'oidc'
  | 'health'
  | 'public'
  | 'me'
  | 'personal-boards-private'
  | 'webhook-receivers';

interface Exemption {
  controllerName: string;
  methodName: string;
  category: ExemptionCategory;
  reason: string;
}

const EXEMPTIONS: Exemption[] = [
  // auth.controller.ts — public registration/login/password-reset flows have
  // no request.user yet (ScopeGuard can't key off it); GET/PATCH me is
  // authenticated self-identity data with no PAT-scope model.
  { controllerName: 'AuthController', methodName: 'register', category: 'auth', reason: '@Public() registration — no request.user to scope-check' },
  { controllerName: 'AuthController', methodName: 'login', category: 'auth', reason: '@Public() login — no request.user to scope-check' },
  { controllerName: 'AuthController', methodName: 'providers', category: 'auth', reason: '@Public() — lists configured SSO providers pre-auth' },
  { controllerName: 'AuthController', methodName: 'forgotPassword', category: 'auth', reason: '@Public() password-reset request — no request.user to scope-check' },
  { controllerName: 'AuthController', methodName: 'resetPassword', category: 'auth', reason: '@Public() password-reset completion — no request.user to scope-check' },
  { controllerName: 'AuthController', methodName: 'me', category: 'auth', reason: 'authenticated self-identity read; no PAT-scope model for "my own profile"' },
  { controllerName: 'AuthController', methodName: 'updateMe', category: 'auth', reason: 'authenticated self-identity write; no PAT-scope model for "my own profile"' },

  // auth/oidc/oidc.controller.ts — browser SSO redirect + callback, always
  // unauthenticated at the time they're hit.
  { controllerName: 'OidcController', methodName: 'login', category: 'oidc', reason: '@Public() browser redirect into the IdP — never bearer-authenticated' },
  { controllerName: 'OidcController', methodName: 'callback', category: 'oidc', reason: '@Public() IdP callback — never bearer-authenticated' },

  // health.controller.ts — infra probes, no bearer auth at all.
  { controllerName: 'HealthController', methodName: 'check', category: 'health', reason: '@Public() liveness/readiness probe — no auth of any kind' },
  { controllerName: 'HealthController', methodName: 'live', category: 'health', reason: '@Public() liveness probe — no auth of any kind' },

  // public/public.controller.ts — ScopeGuard is keyed off request.user, which
  // @Public() routes never populate; cannot be scope-gated even in principle.
  { controllerName: 'PublicController', methodName: 'getBoard', category: 'public', reason: "@Public() share-token read — ScopeGuard can't key off request.user on a route that never populates it" },
  { controllerName: 'PublicController', methodName: 'getDashboard', category: 'public', reason: "@Public() share-token read — ScopeGuard can't key off request.user on a route that never populates it" },

  // workspaces/workspaces.controller.ts — logo image is a low-sensitivity
  // public branding asset served via a plain <img src>, deliberately
  // @Public() so the browser never needs a bearer token to render it.
  { controllerName: 'WorkspacesController', methodName: 'serveLogo', category: 'public', reason: '@Public() branding-asset stream for a plain <img src> — no request.user to scope-check' },

  // me/me.controller.ts — every route is caller-private data with no
  // cross-user access path, so there is no meaningful scope to enforce.
  { controllerName: 'MeController', methodName: 'work', category: 'me', reason: 'caller-private aggregate view, no PAT-scope model applies' },
  { controllerName: 'MeController', methodName: 'listQuickLinks', category: 'me', reason: 'caller-private data, no PAT-scope model applies' },
  { controllerName: 'MeController', methodName: 'createQuickLink', category: 'me', reason: 'caller-private data, no PAT-scope model applies' },
  { controllerName: 'MeController', methodName: 'updateQuickLink', category: 'me', reason: 'caller-private data, no PAT-scope model applies' },
  { controllerName: 'MeController', methodName: 'deleteQuickLink', category: 'me', reason: 'caller-private data, no PAT-scope model applies' },

  // personal-boards/personal-boards.controller.ts — every route except
  // `promoteCard` (which IS @RequireScope('issues:write') and appears in the
  // matrix) operates purely on the caller's own private personal board.
  { controllerName: 'PersonalBoardsController', methodName: 'getBoard', category: 'personal-boards-private', reason: 'caller-private board, no PAT-scope model applies' },
  { controllerName: 'PersonalBoardsController', methodName: 'createColumn', category: 'personal-boards-private', reason: 'caller-private board, no PAT-scope model applies' },
  { controllerName: 'PersonalBoardsController', methodName: 'reorderColumns', category: 'personal-boards-private', reason: 'caller-private board, no PAT-scope model applies' },
  { controllerName: 'PersonalBoardsController', methodName: 'updateColumn', category: 'personal-boards-private', reason: 'caller-private board, no PAT-scope model applies' },
  { controllerName: 'PersonalBoardsController', methodName: 'deleteColumn', category: 'personal-boards-private', reason: 'caller-private board, no PAT-scope model applies' },
  { controllerName: 'PersonalBoardsController', methodName: 'createCard', category: 'personal-boards-private', reason: 'caller-private board, no PAT-scope model applies' },
  { controllerName: 'PersonalBoardsController', methodName: 'updateCard', category: 'personal-boards-private', reason: 'caller-private board, no PAT-scope model applies' },
  { controllerName: 'PersonalBoardsController', methodName: 'deleteCard', category: 'personal-boards-private', reason: 'caller-private board, no PAT-scope model applies' },

  // Inbound webhook receivers — called by the external forge (GitHub/GitLab/
  // Gitea), never carry a bearer token at all; authenticity is instead
  // established per-request via an HMAC signature / shared-secret header
  // compared against the project's stored webhook secret.
  { controllerName: 'GithubController', methodName: 'webhook', category: 'webhook-receivers', reason: '@Public() inbound webhook — authenticated via X-Hub-Signature-256 HMAC, not a bearer token' },
  { controllerName: 'GitlabController', methodName: 'webhook', category: 'webhook-receivers', reason: '@Public() inbound webhook — authenticated via X-Gitlab-Token shared secret, not a bearer token' },
  { controllerName: 'GiteaController', methodName: 'webhook', category: 'webhook-receivers', reason: '@Public() inbound webhook — authenticated via HMAC signature, not a bearer token' },
];

function exemptionKey(controllerName: string, methodName: string): string {
  return `${controllerName}#${methodName}`;
}

async function bootstrapApp(): Promise<INestApplication> {
  const { AppModule } = await import('./app.module');

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule, DiscoveryModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

(HAS_DB ? describe : describe.skip)('PAT-scope route coverage (DiscoveryService walk)', () => {
  let app: INestApplication;
  let routes: DiscoveredRoute[];

  beforeAll(async () => {
    app = await bootstrapApp();
    routes = await discoverRoutes(app);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it('discovers a non-trivial number of routes (sanity check the walk itself works)', () => {
    // Guards against a silently-broken discovery walk (e.g. DiscoveryService
    // wired to the wrong module) reporting a trivially-true "0 unscoped
    // routes found" pass.
    expect(routes.length).toBeGreaterThan(150);
  });

  it('every EXEMPTIONS entry has a non-empty reason and a recognized category', () => {
    const KNOWN_CATEGORIES: ExemptionCategory[] = [
      'auth',
      'oidc',
      'health',
      'public',
      'me',
      'personal-boards-private',
      'webhook-receivers',
    ];
    for (const exemption of EXEMPTIONS) {
      expect(exemption.reason.length).toBeGreaterThan(10);
      expect(KNOWN_CATEGORIES).toContain(exemption.category);
    }
  });

  it('every EXEMPTIONS entry corresponds to a real, currently-registered route', () => {
    const stale = EXEMPTIONS.filter(
      (exemption) =>
        !routes.some(
          (route) =>
            route.controllerName === exemption.controllerName &&
            route.methodName === exemption.methodName,
        ),
    );
    expect(stale).toEqual([]);
  });

  it('every non-exempt route carries @RequireScope', () => {
    const exemptKeys = new Set(EXEMPTIONS.map((e) => exemptionKey(e.controllerName, e.methodName)));

    const unscoped = routes.filter((route) => {
      if (route.scope) return false;
      if (exemptKeys.has(exemptionKey(route.controllerName, route.methodName))) return false;
      return true;
    });

    if (unscoped.length > 0) {
      const details = unscoped
        .map((r) => `  - ${r.httpMethod} ${r.pattern} (${r.controllerName}#${r.methodName})`)
        .join('\n');
      throw new Error(
        `${unscoped.length} route(s) have no @RequireScope and are not on the ` +
          `EXEMPTIONS allowlist in pat-scope-coverage.integration.spec.ts:\n${details}\n\n` +
          'Fix: add @RequireScope(<scope>) to the handler (and a matching row in ' +
          'pat-scope-matrix.fixture.ts), OR — only if the route is genuinely ' +
          'identity/self-service/public/webhook-receiver — add a reasoned entry to EXEMPTIONS.',
      );
    }
  });

  it('every @RequireScope route appears in pat-scope-matrix.fixture.ts with a matching scope', () => {
    const matrixByKey = new Map<string, string[]>();
    for (const row of MATRIX) {
      const key = `${row.method} ${normalizeRoutePattern(row.path)}`;
      const scopes = matrixByKey.get(key) ?? [];
      scopes.push(row.scope);
      matrixByKey.set(key, scopes);
    }

    const scopedRoutes = routes.filter((r) => r.scope);
    const missing = scopedRoutes.filter((route) => {
      const key = `${route.httpMethod} ${normalizeRoutePattern(route.pattern)}`;
      const scopes = matrixByKey.get(key);
      return !scopes || !scopes.includes(route.scope as string);
    });

    if (missing.length > 0) {
      const details = missing
        .map(
          (r) =>
            `  - ${r.httpMethod} ${r.pattern} requires '${r.scope}' (${r.controllerName}#${r.methodName})`,
        )
        .join('\n');
      throw new Error(
        `${missing.length} @RequireScope route(s) are missing from MATRIX in ` +
          `pat-scope-matrix.fixture.ts (or the matrix scope doesn't match the decorator):\n${details}\n\n` +
          'Fix: add a { controller, method, path, scope } row to MATRIX for each.',
      );
    }
  });

  it('every MATRIX row corresponds to a real, currently-registered @RequireScope route (no stale rows)', () => {
    const routeKeys = new Set(
      routes
        .filter((r) => r.scope)
        .map((r) => `${r.httpMethod} ${normalizeRoutePattern(r.pattern)}::${r.scope}`),
    );

    const stale = MATRIX.filter((row) => {
      const key = `${row.method} ${normalizeRoutePattern(row.path)}::${row.scope}`;
      return !routeKeys.has(key);
    });

    if (stale.length > 0) {
      const details = stale
        .map((row) => `  - ${row.method} ${row.path} (${row.controller}, scope '${row.scope}')`)
        .join('\n');
      throw new Error(
        `${stale.length} MATRIX row(s) in pat-scope-matrix.fixture.ts no longer match any ` +
          `registered @RequireScope route (renamed/removed?):\n${details}`,
      );
    }
  });
});
