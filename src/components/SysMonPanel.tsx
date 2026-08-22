// @ts-nocheck

import { useEffect } from "react";
import SysMonitor from "@/apps/SysMonitor";
import { useSysMonStore } from "@/stores/useSysMonStore";

export default function SysMonPanel() {
  const open = useSysMonStore((s) => s.open);
  const connectionId = useSysMonStore((s) => s.connectionId);
  const closePanel = useSysMonStore((s) => s.closePanel);
  const setConnectionId = useSysMonStore((s) => s.setConnectionId);

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
        aria-label="Close System Monitor panel"
        className="absolute inset-0 bg-black/55 backdrop-blur-sm"
        onClick={closePanel}
      />
      <aside className="relative z-[10051] h-full w-full max-w-[42rem] border-l border-neutral-800 bg-neutral-950 shadow-2xl">
        <SysMonitor
          connectionId={connectionId ?? undefined}
          onClose={closePanel}
          onConnectionChange={setConnectionId}
        />
      </aside>
    </div>
  );
}
