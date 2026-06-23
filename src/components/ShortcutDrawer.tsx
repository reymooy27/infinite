import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

interface Shortcut {
  label: string;
  title: string;
  data: string;
  isTmux?: boolean;
}

const TABS = ["Terminal", "Tmux", "Nav", "Vim"] as const;
type Tab = (typeof TABS)[number];

const SHORTCUTS: Record<Tab, Shortcut[]> = {
  Terminal: [
    { label: "C-c", title: "Interrupt", data: "\x03" },
    { label: "C-d", title: "EOF", data: "\x04" },
    { label: "C-u", title: "Clear line", data: "\x15" },
    { label: "C-w", title: "Del word", data: "\x17" },
    { label: "C-l", title: "Clear screen", data: "\x0c" },
    { label: "C-a", title: "Line start", data: "\x01" },
    { label: "C-e", title: "Line end", data: "\x05" },
    { label: "C-r", title: "History search", data: "\x12" },
    { label: "C-z", title: "Suspend", data: "\x1a" },
    { label: "C-k", title: "Kill to end", data: "\x0b" },
    { label: "C-\\", title: "SIGQUIT", data: "\x1c" },
    { label: "C-p", title: "Previous", data: "\x10" },
  ],
  Tmux: [
    { label: "next", title: "Next window", data: "n", isTmux: true },
    { label: "prev", title: "Prev window", data: "p", isTmux: true },
    { label: "new", title: "New window", data: "c", isTmux: true },
    { label: "vsplt", title: "Split vertical", data: "%", isTmux: true },
    { label: "hsplt", title: "Split horizontal", data: '"', isTmux: true },
    { label: "zoom", title: "Zoom pane", data: "z", isTmux: true },
    { label: "kill", title: "Kill pane", data: "x", isTmux: true },
    { label: "win", title: "List windows", data: "w", isTmux: true },
    { label: "detach", title: "Detach", data: "d", isTmux: true },
    { label: "rename", title: "Rename window", data: ",", isTmux: true },
    { label: "scroll", title: "Scroll mode", data: "[", isTmux: true },
    { label: "paste", title: "Paste buffer", data: "]", isTmux: true },
  ],
  Nav: [
    { label: "↑", title: "Up", data: "\x1b[A" },
    { label: "↓", title: "Down", data: "\x1b[B" },
    { label: "←", title: "Left", data: "\x1b[D" },
    { label: "→", title: "Right", data: "\x1b[C" },
    { label: "Home", title: "Home", data: "\x1b[H" },
    { label: "End", title: "End", data: "\x1b[F" },
    { label: "PgUp", title: "Page Up", data: "\x1b[5~" },
    { label: "PgDn", title: "Page Down", data: "\x1b[6~" },
    { label: "Tab", title: "Tab", data: "\x09" },
    { label: "Enter", title: "Enter", data: "\r" },
    { label: "Bksp", title: "Backspace", data: "\x7f" },
    { label: "Del", title: "Delete", data: "\x1b[3~" },
  ],
  Vim: [
    { label: "Esc", title: "Escape", data: "\x1b" },
    { label: ":w", title: "Save", data: "\x1b:w\r" },
    { label: ":q", title: "Quit", data: "\x1b:q\r" },
    { label: ":wq", title: "Save & quit", data: "\x1b:wq\r" },
    { label: ":q!", title: "Force quit", data: "\x1b:q!\r" },
    { label: "dd", title: "Delete line", data: "\x1bdd" },
    { label: "yy", title: "Yank line", data: "\x1byy" },
    { label: "p", title: "Paste", data: "\x1bp" },
    { label: "u", title: "Undo", data: "\x1bu" },
    { label: "i", title: "Insert mode", data: "i" },
    { label: "/", title: "Search", data: "\x1b/" },
    { label: "G", title: "Go to end", data: "\x1bG" },
  ],
};

export function ShortcutDrawer({
  open,
  onClose,
  onSend,
  onTmux,
  anchorRef,
}: {
  open: boolean;
  onClose: () => void;
  onSend: (data: string) => void;
  onTmux: (key: string) => void;
  anchorRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [tab, setTab] = useState<Tab>("Terminal");
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    if (!open || !anchorRef.current) { setPos(null); return; }
    const update = () => {
      const el = anchorRef.current?.closest("[class*='react-draggable']") || anchorRef.current?.parentElement?.parentElement;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const vh = window.visualViewport?.height || window.innerHeight;
      const estimatedH = 240;
      const gap = 4;

      if (vh - rect.bottom < estimatedH + gap && rect.top > estimatedH + gap) {
        setPos({ top: Math.max(gap, rect.top - estimatedH - gap), left: rect.left, width: rect.width });
      } else {
        setPos({ top: Math.min(vh - estimatedH - gap, rect.bottom + gap), left: rect.left, width: rect.width });
      }
    };
    update();
    const id = setInterval(update, 16);
    return () => clearInterval(id);
  }, [open, anchorRef]);

  const handlePress = useCallback(
    (s: Shortcut) => {
      if (navigator.vibrate) navigator.vibrate(10);
      if (s.isTmux) onTmux(s.data);
      else onSend(s.data);
    },
    [onSend, onTmux],
  );

  if (!open || !pos) return null;

  return createPortal(
    <div
      className="fixed z-[500] bg-neutral-900/95 backdrop-blur-sm border border-neutral-700 rounded-xl overflow-hidden shadow-2xl"
      style={{ top: pos.top, left: pos.left, width: pos.width }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-800">
        <div className="flex gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium whitespace-nowrap transition-colors ${
                tab === t ? "bg-neutral-700 text-white" : "text-neutral-500"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <button onClick={onClose} className="p-1 text-neutral-500 hover:text-white">
          <X size={14} />
        </button>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-4 gap-1.5 p-2 max-h-44 overflow-y-auto">
        {SHORTCUTS[tab].map((s) => (
          <button
            key={s.label}
            onClick={() => handlePress(s)}
            className="flex flex-col items-center justify-center h-11 rounded-lg bg-neutral-800 active:bg-neutral-600 transition-colors"
          >
            <span className="text-[11px] font-mono text-neutral-200">{s.label}</span>
            <span className="text-[8px] text-neutral-500 mt-0.5">{s.title}</span>
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}
