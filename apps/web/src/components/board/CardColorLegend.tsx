/**
 * CardColorLegend — compact legend on the board toolbar showing active
 * color rules (label and swatch). Only rendered when there is at least
 * one rule with a label.
 */
import type { BoardColorRule } from '@next-lane/shared';

interface CardColorLegendProps {
  rules: BoardColorRule[];
}

export function CardColorLegend({ rules }: CardColorLegendProps) {
  // Only show rules that have a label (unlabelled rules still color cards,
  // but there's nothing meaningful to show in the legend).
  const labeled = rules.filter((r) => r.label && r.label.trim());

  if (labeled.length === 0) return null;

  return (
    <div
      aria-label="Card color legend"
      className="flex flex-wrap items-center gap-x-3 gap-y-1"
    >
      {labeled.map((rule) => (
        <span
          key={rule.id}
          className="inline-flex items-center gap-1.5 text-xs text-slate-600"
          title={rule.query}
        >
          <span
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
            style={{ backgroundColor: rule.color }}
            aria-hidden="true"
          />
          {rule.label}
        </span>
      ))}
    </div>
  );
}
