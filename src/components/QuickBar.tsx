import { useCallback } from "react";
import { Copy, MoreHorizontal } from "lucide-react";
import { useSettingsStore } from "@/stores/useSettingsStore";
import type { QuickBarSlot } from "@/stores/useSettingsStore";

export function QuickBar({
  onSend,
  onTmux,
  onCopy,
  onToggleDrawer,
  copyFeedback,
  drawerOpen,
}: {
  onSend: (data: string) => void;
  onTmux: (key: string) => void;
  onCopy: () => void;
  onToggleDrawer: () => void;
  copyFeedback: boolean;
  drawerOpen: boolean;
}) {
  const slots = useSettingsStore((s) => s.quickBarSlots);

  const press = useCallback(
    (s: QuickBarSlot) => {
      if (navigator.vibrate) navigator.vibrate(10);
      if (s.isTmux) onTmux(s.data);
      else onSend(s.data);
    },
    [onSend, onTmux],
  );

  const btn = "flex-1 h-10 flex items-center justify-center rounded-lg bg-neutral-800 active:bg-neutral-600 text-[11px] font-mono text-neutral-300 transition-colors";

  return (
    <div className="flex items-center gap-1 px-2 py-1.5 mr-5 bg-neutral-900/90 backdrop-blur-sm border border-neutral-700 rounded-lg">
      {slots.map((s) => (
        <button key={s.label + (s.isTmux ? "-tmux" : "")} onClick={() => press(s)} className={btn}>{s.label}</button>
      ))}
      <button onClick={onCopy} className={btn}>
        {copyFeedback ? <span className="text-green-400 text-[10px]">✓</span> : <Copy size={13} />}
      </button>
      <button
        onClick={onToggleDrawer}
        className={`${btn} ${drawerOpen ? "!bg-neutral-600 text-white" : ""}`}
      >
        <MoreHorizontal size={14} />
      </button>
    </div>
  );
}
