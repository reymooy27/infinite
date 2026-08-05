
import { useEffect } from "react";
import FocusModeGitPanel from "@/components/FocusModeGitPanel";
import { useGitStore } from "@/stores/useGitStore";

export default function GitPanel({
  projectId,
  connectionId,
  directory,
  onOpenFile,
}: {
  projectId: string | null;
  connectionId?: number;
  directory?: string;
  onOpenFile?: (path: string) => void;
}) {
  const open = useGitStore((s) => s.open);
  const closePanel = useGitStore((s) => s.closePanel);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePanel();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, closePanel]);

  if (!open || !projectId) return null;

  return (
    <div className="fixed inset-0 z-[10050] flex justify-end">
      <button
        type="button"
        aria-label="Close Git panel"
        className="absolute inset-0 bg-black/55 backdrop-blur-sm"
        onClick={closePanel}
      />
      <aside className="relative z-[10051] h-full w-full max-w-[24rem]">
        <FocusModeGitPanel
          key={`${projectId}:${connectionId ?? "none"}:${directory ?? ""}`}
          open
          projectId={projectId}
          connectionId={connectionId}
          directory={directory}
          onOpenFile={onOpenFile}
          onClose={closePanel}
          embedded
        />
      </aside>
    </div>
  );
}
