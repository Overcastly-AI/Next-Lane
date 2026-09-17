import { Link } from 'react-router-dom';

/**
 * Compact "go connect an agent" pointer to the `/developers` MCP generator
 * (`McpConnectSection`). Reused wherever the agent story needs a doorway
 * without re-implementing the generator itself: the project Agents page and
 * the personal API-tokens page.
 */
export function ConnectAgentCallout({
  description = "Give Claude — or any MCP-capable agent — read and write access to this instance's issues, boards, and Pages knowledge base.",
  linkLabel = 'Set up MCP →',
  testId = 'connect-agent-callout',
}: {
  description?: string;
  linkLabel?: string;
  testId?: string;
}) {
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-signal-200 bg-signal-50/60 px-4 py-3 shadow-card"
      data-testid={testId}
    >
      <div className="min-w-0">
        <p className="text-sm font-semibold text-signal-800">Connect an AI agent</p>
        <p className="mt-0.5 text-xs text-signal-700">{description}</p>
      </div>
      <Link
        to="/developers#mcp"
        data-testid="connect-agent-link"
        className="shrink-0 rounded-md border border-signal-300 bg-surface px-3 py-1.5 text-xs font-semibold text-signal-700 shadow-xs transition-colors duration-[120ms] hover:bg-signal-50"
      >
        {linkLabel}
      </Link>
    </div>
  );
}
