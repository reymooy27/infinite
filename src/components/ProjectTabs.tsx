import { useProjectStore, readRecentProjectIds } from "@/stores/useProjectStore";

const MAX_TABS = 8;

export default function ProjectTabs() {
  const projects = useProjectStore((s) => s.projects);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const switchProject = useProjectStore((s) => s.switchProject);

  if (!activeProjectId || projects.length < 2) return null;

  const rank = new Map(readRecentProjectIds().map((id, i) => [id, i]));
  const tabs = [...projects]
    .sort(
      (a, b) =>
        (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    )
    .slice(0, MAX_TABS);

  return (
    <div className="absolute top-2 left-1/2 -translate-x-1/2 z-40 flex items-center gap-0.5 max-w-[85vw] overflow-x-auto rounded-lg border border-neutral-700 bg-neutral-900/90 px-1.5 py-1 shadow-xl">
      {tabs.map((p) => (
        <button
          key={p.id}
          onClick={() => void switchProject(p.id)}
          title={p.directory ? `${p.name} — ${p.directory}` : p.name}
          className={`shrink-0 max-w-44 truncate rounded-md px-2.5 py-1 text-xs transition-colors cursor-pointer ${
            p.id === activeProjectId
              ? "bg-neutral-700 text-white"
              : "text-neutral-400 hover:bg-neutral-800 hover:text-white"
          }`}
        >
          {p.name}
        </button>
      ))}
    </div>
  );
}
