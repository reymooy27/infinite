"use client";

import { useSettingsStore, AVAILABLE_SHORTCUTS } from "@/stores/useSettingsStore";
import type { QuickBarSlot } from "@/stores/useSettingsStore";

interface SettingsPanelProps {
  currentPage: "root" | "terminal";
  onOpenTerminal: () => void;
}

function ToggleRow({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="rounded-lg border border-neutral-700 bg-neutral-800/70 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[13px] font-medium text-neutral-100">{title}</h3>
          <p className="mt-1 text-[11px] leading-4.5 text-neutral-400">
            {description}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          onClick={() => onChange(!checked)}
          className={`inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors cursor-pointer ${
            checked ? "bg-blue-600" : "bg-neutral-700"
          }`}
        >
          <span
            className={`block h-5 w-5 rounded-full bg-white transition-transform ${
              checked ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      </div>
    </div>
  );
}

export default function SettingsPanel({
  currentPage,
  onOpenTerminal,
}: SettingsPanelProps) {
  const showTerminalShortcuts = useSettingsStore(
    (s) => s.showTerminalShortcuts,
  );
  const setShowTerminalShortcuts = useSettingsStore(
    (s) => s.setShowTerminalShortcuts,
  );
  const showTmuxShortcuts = useSettingsStore((s) => s.showTmuxShortcuts);
  const setShowTmuxShortcuts = useSettingsStore((s) => s.setShowTmuxShortcuts);
  const terminalFontSize = useSettingsStore((s) => s.terminalFontSize);
  const setTerminalFontSize = useSettingsStore((s) => s.setTerminalFontSize);
  const quickBarSlots = useSettingsStore((s) => s.quickBarSlots);
  const setQuickBarSlots = useSettingsStore((s) => s.setQuickBarSlots);

  if (currentPage === "root") {
    return (
      <div className="p-2.5">
        <button
          onClick={onOpenTerminal}
          className="flex w-full items-center justify-between rounded-lg border border-neutral-700 bg-neutral-800/70 px-3 py-2.5 text-left transition-colors cursor-pointer hover:border-neutral-600 hover:bg-neutral-800"
        >
          <div>
            <div className="text-[13px] font-medium text-neutral-100">
              Terminal
            </div>
            <div className="mt-0.5 text-[11px] text-neutral-400">
              Shortcut rows, tmux controls, and terminal UI options.
            </div>
          </div>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0 text-neutral-500"
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2.5 p-2.5">
      <div className="rounded-lg border border-neutral-700 bg-neutral-800/70 p-3">
        <h3 className="text-[13px] font-medium text-neutral-100">Font size</h3>
        <p className="mt-1 text-[11px] leading-4.5 text-neutral-400">
          Adjust the terminal text size (8–24px).
        </p>
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={() => setTerminalFontSize(Math.max(8, terminalFontSize - 1))}
            className="h-7 w-7 rounded bg-neutral-700 text-neutral-200 hover:bg-neutral-600 transition-colors cursor-pointer flex items-center justify-center text-sm font-medium"
          >
            −
          </button>
          <span className="text-sm text-neutral-200 w-8 text-center font-mono">{terminalFontSize}</span>
          <button
            onClick={() => setTerminalFontSize(Math.min(24, terminalFontSize + 1))}
            className="h-7 w-7 rounded bg-neutral-700 text-neutral-200 hover:bg-neutral-600 transition-colors cursor-pointer flex items-center justify-center text-sm font-medium"
          >
            +
          </button>
        </div>
      </div>
      <ToggleRow
        title="Terminal button shortcuts"
        description="Show or hide the on-screen terminal shortcut buttons for control keys, arrows, and enter/tab actions."
        checked={showTerminalShortcuts}
        onChange={setShowTerminalShortcuts}
      />
      <ToggleRow
        title="tmux shortcut row"
        description="Show or hide the separate tmux action row while keeping the main terminal shortcut row available."
        checked={showTmuxShortcuts}
        onChange={setShowTmuxShortcuts}
      />
      <div className="rounded-lg border border-neutral-700 bg-neutral-800/70 p-3">
        <h3 className="text-[13px] font-medium text-neutral-100">Quick bar buttons</h3>
        <p className="mt-1 text-[11px] leading-4.5 text-neutral-400">
          Choose which shortcuts appear in the mobile quick bar. Tap to add/remove.
        </p>
        <div className="mt-2 flex flex-wrap gap-1">
          {AVAILABLE_SHORTCUTS.map((s) => {
            const active = quickBarSlots.some((q) => q.data === s.data);
            return (
              <button
                key={s.label}
                onClick={() => {
                  if (active) {
                    setQuickBarSlots(quickBarSlots.filter((q) => q.data !== s.data));
                  } else if (quickBarSlots.length < 6) {
                    setQuickBarSlots([...quickBarSlots, s]);
                  }
                }}
                className={`px-2 py-1 rounded text-[11px] font-mono transition-colors cursor-pointer ${
                  active
                    ? "bg-blue-600 text-white"
                    : "bg-neutral-700 text-neutral-400 hover:text-neutral-200"
                }`}
              >
                {s.label}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-[10px] text-neutral-500">
          {quickBarSlots.length}/6 selected
        </p>
      </div>
      <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-2.5 text-[11px] leading-4.5 text-neutral-500">
        If terminal shortcuts are disabled, the tmux row is hidden automatically.
      </div>
    </div>
  );
}
