/**
 * McpConnectSection — the MCP config generator on `/developers`.
 *
 * Product-audit finding (docs/AUDIT-PRODUCT.md, Pass 14): Next Lane ships a
 * first-party MCP server that reads AND writes — a real structural advantage
 * no incumbent can match without rebuilding — and until this component
 * existed, the *only* way to learn that was to already know to read
 * `README.md`. `/developers` documented REST curl/Python/Node snippets and
 * never mentioned MCP at all.
 *
 * This turns "we have an MCP server" into "I have it running in ninety
 * seconds": paste a token (or leave the placeholder), copy the block, drop it
 * into an MCP client's config, restart. No doc detour required.
 *
 * Placed FIRST on the page, above the REST snippet — the audit's own framing
 * is that this is the "single highest-leverage" surface, and a page that led
 * with REST (as this one used to) buried the thing that actually
 * differentiates the product behind the thing every tracker already has.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { McpConfigBlock } from './McpConfigBlock';

export function McpConnectSection({ apiBase }: { apiBase: string }) {
  const [token, setToken] = useState('');
  const [reveal, setReveal] = useState(false);

  return (
    <section
      className="mb-6 rounded-xl border border-signal-200 bg-signal-50/40 p-4 shadow-card sm:p-5"
      data-testid="mcp-connect-section"
      id="mcp"
    >
      <div className="mb-1 flex items-center gap-2">
        <span
          className="inline-flex h-5 shrink-0 items-center rounded-full bg-signal-600 px-2 text-[10px] font-bold uppercase tracking-wide text-white"
          aria-hidden="true"
        >
          Agent-native
        </span>
        <h2 className="text-sm font-semibold text-ink-900">Connect an AI agent</h2>
      </div>
      <p className="mt-1 text-sm text-ink-600">
        <code className="rounded bg-ink-100 px-1 py-0.5 font-mono text-xs">@next-lane/mcp</code>{' '}
        gives Claude — or any MCP-capable agent — real read and write access to
        this instance: issues, boards, sprints, workflows, and the Pages
        knowledge base, over the same API this app uses. It is the one thing
        your current tracker cannot do.
      </p>

      <ol className="mt-4 space-y-2 text-sm text-ink-700">
        <li className="flex gap-2">
          <span className="font-semibold text-ink-400">1.</span>
          <span>
            Create a token in{' '}
            <Link
              to="/me/settings"
              className="font-medium text-signal-600 hover:underline"
              data-testid="mcp-token-link"
            >
              Settings → API tokens
            </Link>
            , then paste it below (or leave the placeholder and swap it in
            later — nothing here is sent anywhere; it only fills in the
            snippet on this page).
          </span>
        </li>
        <li className="flex gap-2">
          <span className="font-semibold text-ink-400">2.</span>
          <span>Copy the block and paste it into your MCP client's config (Claude Desktop, Claude Code, or any other MCP host).</span>
        </li>
        <li className="flex gap-2">
          <span className="font-semibold text-ink-400">3.</span>
          <span>Restart the client — it now has agent-native access to this project.</span>
        </li>
      </ol>

      <div className="mt-4 max-w-md">
        <Field label="Your token (optional)" htmlFor="mcp-token-input">
          <div className="flex gap-2">
            <Input
              id="mcp-token-input"
              data-testid="mcp-token-input"
              type={reveal ? 'text' : 'password'}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="nlp_…"
              autoComplete="off"
              spellCheck={false}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setReveal((v) => !v)}
              data-testid="mcp-token-reveal"
            >
              {reveal ? 'Hide' : 'Show'}
            </Button>
          </div>
        </Field>
      </div>

      <div className="mt-3">
        <McpConfigBlock apiBase={apiBase} token={token.trim()} />
      </div>

      <p className="mt-3 text-xs text-ink-500">
        132 tools, full reference in{' '}
        <a
          href="https://github.com/Overcastly-AI/Next-Lane/blob/main/apps/mcp/README.md"
          target="_blank"
          rel="noreferrer"
          className="font-medium text-signal-600 underline-offset-2 hover:underline"
        >
          apps/mcp/README.md
        </a>
        . Lock a project against agent writes at any time from its{' '}
        <span className="font-medium text-ink-700">Agents</span> tab — reads
        stay open, people are never affected.
      </p>
    </section>
  );
}
