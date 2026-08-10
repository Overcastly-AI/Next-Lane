import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request facts that deep code needs but cannot be handed.
 *
 * WHY THIS EXISTS: locking a project against agent writes has to be enforced
 * at `assertProjectRole` / `assertProjectMember` — the chokepoint every
 * project-scoped permission check already funnels through, 100+ call sites
 * across 35 files. Those helpers take a `userId`, not the request, and
 * threading two more parameters through every call site is exactly the kind of
 * change where missing ONE site leaves a hole in a security control and
 * nothing fails loudly. So the two facts travel out-of-band instead: set once
 * where the request is authenticated, read once where the decision is made.
 *
 * Deliberately narrow. This is not a general-purpose request bag — it carries
 * only what an authorization decision needs, so it cannot quietly become a way
 * to smuggle state into services.
 */
export interface RequestContext {
  /** HTTP method, so a read can never be mistaken for a write. */
  method: string;
  /**
   * True when the caller authenticated with a Personal Access Token rather
   * than a browser session — i.e. the MCP server or another agent.
   */
  isApiToken: boolean;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Run `fn` with a fresh context for this request. */
export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/**
 * The current request's context, or null outside a request — queue workers,
 * scheduled jobs, tests calling a service directly. Callers must treat null as
 * "not an agent write", which is the safe default: background work is trusted
 * code, not an inbound token.
 */
export function getRequestContext(): RequestContext | null {
  return storage.getStore() ?? null;
}

/** HTTP methods that cannot change anything. */
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Is this request an agent trying to WRITE?
 *
 * Method-based rather than inferring from the required role: reads legitimately
 * ask for VIEWER and writes for MEMBER, but a GET that happens to require
 * MEMBER would then be refused for no reason. The verb is the honest signal.
 */
export function isAgentWrite(): boolean {
  const ctx = getRequestContext();
  if (!ctx) return false;
  return ctx.isApiToken && !READ_METHODS.has(ctx.method.toUpperCase());
}

/** Mark the in-flight request as authenticated by an API token. */
export function markApiTokenRequest(): void {
  const ctx = storage.getStore();
  if (ctx) ctx.isApiToken = true;
}
