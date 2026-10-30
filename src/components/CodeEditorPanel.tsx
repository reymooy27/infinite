// @ts-nocheck


import FileExplorer from "@/components/FileExplorer";
import { useCodeEditorStore } from "@/stores/useCodeEditorStore";

export default function CodeEditorPanel({
  projectId,
  connectionId,
  directory,
}: {
  projectId: string | null;
  connectionId?: number;
  directory?: string;
}) {
  const open = useCodeEditorStore((s) => s.open);
  const closePanel = useCodeEditorStore((s) => s.closePanel);

  if (!open || !projectId) return null;

  return (
    <div className="fixed inset-0 z-[10050] flex justify-end">
      <button
        type="button"
        aria-label="Close code editor panel"
        className="absolute inset-0 bg-black/55 backdrop-blur-sm"
        onClick={closePanel}
      />
      <aside className="relative z-[10051] h-full w-full max-w-[56rem]">
        <FileExplorer
          open
          projectId={projectId}
          connectionId={connectionId}
          directory={directory}
          onClose={closePanel}
          embedded
        />
      </aside>
    </div>
  );
}
