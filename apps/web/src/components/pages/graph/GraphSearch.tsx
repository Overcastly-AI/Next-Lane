/**
 * GraphSearch — "search-to-fly": Obsidian has no in-graph search at all (you
 * have to already know roughly where a node is). Typing here highlights
 * every title match live on the canvas; picking one (click or Enter) flies
 * the camera to center that node and opens its side rail, same as clicking
 * the node directly.
 */
import { useId, useState } from 'react';
import type { PageGraphNode } from '@next-lane/shared';

export interface GraphSearchProps {
  nodes: PageGraphNode[];
  /** Called whenever the query changes, with the set of matching node ids —
   * the canvas uses this to highlight matches live, independent of selection. */
  onMatchesChange: (ids: Set<string>) => void;
  onPick: (nodeId: string) => void;
}

const MAX_RESULTS = 8;

export function GraphSearch({ nodes, onMatchesChange, onPick }: GraphSearchProps) {
  const [query, setQuery] = useState('');
  const listId = useId();

  const matches = query.trim()
    ? nodes.filter((n) => n.title.toLowerCase().includes(query.trim().toLowerCase())).slice(0, MAX_RESULTS)
    : [];

  function handleChange(value: string) {
    setQuery(value);
    const q = value.trim().toLowerCase();
    onMatchesChange(q ? new Set(nodes.filter((n) => n.title.toLowerCase().includes(q)).map((n) => n.id)) : new Set());
  }

  function pick(id: string) {
    onPick(id);
    setQuery('');
    onMatchesChange(new Set());
  }

  return (
    <div className="relative w-full max-w-[15rem] sm:max-w-[13rem]">
      <label htmlFor={listId} className="sr-only">
        Search pages in this graph
      </label>
      <div className="relative">
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
          className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-400"
        >
          <circle cx="11" cy="11" r="7" />
          <path strokeLinecap="round" d="m21 21-4.3-4.3" />
        </svg>
        <input
          id={listId}
          type="text"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && matches.length > 0) {
              e.preventDefault();
              pick(matches[0].id);
            } else if (e.key === 'Escape' && query) {
              e.preventDefault();
              handleChange('');
            }
          }}
          placeholder="Search pages…"
          data-testid="page-graph-search-input"
          role="combobox"
          aria-expanded={matches.length > 0}
          aria-controls={`${listId}-results`}
          autoComplete="off"
          className="h-8 w-full rounded-md border border-ink-200 bg-surface pl-7 pr-2 text-xs text-ink-800 placeholder:text-ink-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-400"
        />
      </div>

      {matches.length > 0 && (
        <ul
          id={`${listId}-results`}
          data-testid="page-graph-search-results"
          className="absolute left-0 top-full z-30 mt-1 max-h-64 w-full min-w-[13rem] overflow-y-auto rounded-md border border-ink-200 bg-surface-raised py-1 shadow-dropdown"
        >
          {matches.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => pick(n.id)}
                data-testid={`page-graph-search-result-${n.id}`}
                className="block w-full truncate px-2.5 py-1.5 text-left text-xs text-ink-700 hover:bg-ink-50 hover:text-signal-700 focus:outline-none focus-visible:bg-ink-50 focus-visible:text-signal-700"
              >
                {n.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
