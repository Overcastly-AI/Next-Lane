import type { ProjectDto } from '@next-lane/shared';

export function ProjectCard({
  project,
  onClick,
}: {
  project: ProjectDto;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group flex flex-col items-start gap-3 rounded-xl border border-ink-200 bg-surface p-4 text-left shadow-card transition-all duration-[120ms] hover:-translate-y-0.5 hover:border-signal-200 hover:shadow-cardHover focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-400"
    >
      {/* Project key badge — cobalt fill */}
      <span className="flex h-9 w-9 items-center justify-center rounded font-display text-sm font-bold bg-signal-50 text-signal-700 border border-signal-100 group-hover:bg-signal-100 transition-colors duration-[120ms]">
        {project.key.slice(0, 2)}
      </span>
      <div className="min-w-0">
        <p className="truncate font-semibold text-ink-900 group-hover:text-signal-700 transition-colors duration-[120ms]">
          {project.name}
        </p>
        <p className="font-mono text-xs text-ink-400">{project.key}</p>
      </div>
      {project.description && (
        <p className="line-clamp-2 text-sm text-ink-500">
          {project.description}
        </p>
      )}
    </button>
  );
}
