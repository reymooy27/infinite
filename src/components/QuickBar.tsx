import { useCallback } from "react";
import { Copy } from "lucide-react";

export function QuickBar({
  onSend,
  onCopy,
  copyFeedback,
}: {
  onSend: (data: string) => void;
  onCopy: () => void;
  copyFeedback: boolean;
}) {
  const press = useCallback(
    (data: string) => {
      if (navigator.vibrate) navigator.vibrate(10);
      onSend(data);
    },
    [onSend],
  );

  return (
    <div className="flex items-center gap-1 px-2 py-1.5 bg-neutral-900/90 backdrop-blur-sm border border-neutral-700 rounded-lg">
      <button
        onClick={() => press("\x03")}
        className="flex-1 h-11 flex items-center justify-center rounded-lg bg-neutral-800 active:bg-neutral-600 text-[11px] font-mono text-neutral-300 transition-colors"
      >
        C-c
      </button>
      <button
        onClick={() => press("\x04")}
        className="flex-1 h-11 flex items-center justify-center rounded-lg bg-neutral-800 active:bg-neutral-600 text-[11px] font-mono text-neutral-300 transition-colors"
      >
        C-d
      </button>
      <button
        onClick={() => press("\x09")}
        className="flex-1 h-11 flex items-center justify-center rounded-lg bg-neutral-800 active:bg-neutral-600 text-[11px] font-mono text-neutral-300 transition-colors"
      >
        Tab
      </button>
      <button
        onClick={() => press("\x1b[A")}
        className="flex-1 h-11 flex items-center justify-center rounded-lg bg-neutral-800 active:bg-neutral-600 text-[11px] font-mono text-neutral-300 transition-colors"
      >
        ↑
      </button>
      <button
        onClick={() => press("\x1b[B")}
        className="flex-1 h-11 flex items-center justify-center rounded-lg bg-neutral-800 active:bg-neutral-600 text-[11px] font-mono text-neutral-300 transition-colors"
      >
        ↓
      </button>
      <button
        onClick={onCopy}
        className="flex-1 h-11 flex items-center justify-center rounded-lg bg-neutral-800 active:bg-neutral-600 text-[11px] font-mono text-neutral-300 transition-colors"
      >
        {copyFeedback ? (
          <span className="text-green-400 text-[10px]">✓</span>
        ) : (
          <Copy size={14} />
        )}
      </button>
    </div>
  );
}
