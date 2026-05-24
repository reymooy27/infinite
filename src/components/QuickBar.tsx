import { useCallback } from "react";
import { Copy, MoreHorizontal } from "lucide-react";

export function QuickBar({
  onSend,
  onCopy,
  onToggleDrawer,
  copyFeedback,
  drawerOpen,
}: {
  onSend: (data: string) => void;
  onCopy: () => void;
  onToggleDrawer: () => void;
  copyFeedback: boolean;
  drawerOpen: boolean;
}) {
  const press = useCallback(
    (data: string) => {
      if (navigator.vibrate) navigator.vibrate(10);
      onSend(data);
    },
    [onSend],
  );

  const btn = "flex-1 h-10 flex items-center justify-center rounded-lg bg-neutral-800 active:bg-neutral-600 text-[11px] font-mono text-neutral-300 transition-colors";

  return (
    <div className="flex items-center gap-1 px-2 py-1.5 mr-5 bg-neutral-900/90 backdrop-blur-sm border border-neutral-700 rounded-lg">
      <button onClick={() => press("\x03")} className={btn}>C-c</button>
      <button onClick={() => press("\x04")} className={btn}>C-d</button>
      <button onClick={() => press("\x09")} className={btn}>Tab</button>
      <button onClick={() => press("\x1b[A")} className={btn}>↑</button>
      <button onClick={() => press("\x1b[B")} className={btn}>↓</button>
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
