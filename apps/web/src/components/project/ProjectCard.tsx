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
      className="group flex flex-col items-start gap-3 rounded-xl border border-gray-200 bg-white p-4 text-left shadow-card transition-all hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-cardHover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-100 text-sm font-bold text-brand-700">
        {project.key.slice(0, 2)}
      </span>
      <div className="min-w-0">
        <p className="truncate font-semibold text-gray-900 group-hover:text-brand-700">
          {project.name}
        </p>
        <p className="text-xs text-gray-500">{project.key}</p>
      </div>
      {project.description && (
        <p className="line-clamp-2 text-sm text-gray-500">
          {project.description}
        </p>
      )}
    </button>
  );
}
