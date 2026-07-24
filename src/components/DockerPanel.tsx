
import { useEffect } from "react";
import DockerManager from "@/apps/DockerManager";
import { useDockerStore } from "@/stores/useDockerStore";

export default function DockerPanel() {
  const open = useDockerStore((s) => s.open);
  const connectionId = useDockerStore((s) => s.connectionId);
  const closePanel = useDockerStore((s) => s.closePanel);
  const setConnectionId = useDockerStore((s) => s.setConnectionId);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePanel();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, closePanel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[10050] flex justify-end">
      <button
        type="button"
        aria-label="Close Docker panel"
        className="absolute inset-0 bg-black/55 backdrop-blur-sm"
        onClick={closePanel}
      />
      <aside className="relative z-[10051] h-full w-full max-w-[42rem] border-l border-neutral-800 bg-neutral-950 shadow-2xl">
        <DockerManager
          connectionId={connectionId ?? undefined}
          onClose={closePanel}
          onConnectionChange={setConnectionId}
        />
      </aside>
    </div>
  );
}
