import { useState } from 'react';
import { Button } from '@/components/ui/Button';

/** Placeholder shown until the visitor pastes a real token into the generator. */
export const MCP_TOKEN_PLACEHOLDER = 'nlp_your_personal_access_token';

/**
 * The exact `mcpServers` block documented in `README.md` and
 * `apps/mcp/README.md` — this function is the one place that shape is
 * assembled, so the app can never drift from what those docs promise.
 */
export function buildMcpConfig(apiBase: string, token: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        'next-lane': {
          command: 'npx',
          args: ['-y', '@next-lane/mcp'],
          env: {
            NEXT_LANE_API_URL: apiBase,
            NEXT_LANE_TOKEN: token || MCP_TOKEN_PLACEHOLDER,
          },
        },
      },
    },
    null,
    2,
  );
}

/**
 * A copy-pasteable `mcpServers` JSON block, wired to this install's API
 * origin, with a one-click copy — the same "code block + Copy" pattern
 * `ApiDocsPage`'s REST snippet already uses, so the two surfaces read as one
 * feature rather than two different developer tools bolted together.
 */
export function McpConfigBlock({
  apiBase,
  token,
  testId = 'mcp-config-snippet',
  copyTestId = 'mcp-config-copy',
}: {
  apiBase: string;
  /** Real token when known (embeds it directly); empty shows a placeholder. */
  token: string;
  testId?: string;
  copyTestId?: string;
}) {
  const [copied, setCopied] = useState(false);
  const snippet = buildMcpConfig(apiBase, token);

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can be denied; the block is still selectable by hand.
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-ink-200">
      <div className="flex items-center justify-between border-b border-ink-200 bg-ink-50/60 px-2 py-1.5">
        <span className="px-1 text-[11px] font-medium uppercase tracking-wide text-ink-500">
          mcpServers
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={copy}
          data-testid={copyTestId}
          className="h-6 px-2 text-xs"
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <pre className="overflow-x-auto bg-surface p-3 text-xs leading-relaxed text-ink-800">
        <code data-testid={testId}>{snippet}</code>
      </pre>
    </div>
  );
}
