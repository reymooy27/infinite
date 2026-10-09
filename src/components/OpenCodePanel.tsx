import { useEffect } from "react";
import OpenCode from "@/apps/OpenCode";

interface OpenCodePanelProps {
  open: boolean;
  onClose: () => void;
}

export default function OpenCodePanel({ open, onClose }: OpenCodePanelProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[10050] flex justify-end">
      <button
        type="button"
        aria-label="Close OpenCode panel"
        className="absolute inset-0 bg-black/55 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* ponytail: fixed max width sheet like DockerPanel; widen to full-screen chat if used as primary surface */}
      <aside className="relative z-[10051] h-full w-full max-w-[56rem] border-l border-neutral-800 bg-neutral-950 shadow-2xl flex flex-col">
        <OpenCode />
      </aside>
    </div>
  );
}
