import { useState } from "react";
import {
  useSettingsStore,
  AVAILABLE_SHORTCUTS,
  AVAILABLE_TMUX_SHORTCUTS,
} from "@/stores/useSettingsStore";
import { DEFAULT_ROUTER_USAGE_BASE_URL, normalizeRouterUsageBaseUrl } from "@/lib/routerUsage";

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
  const terminalFontSize = useSettingsStore((s) => s.terminalFontSize);
  const setTerminalFontSize = useSettingsStore((s) => s.setTerminalFontSize);
  const bgColor = useSettingsStore((s) => s.bgColor);
  const setBgColor = useSettingsStore((s) => s.setBgColor);
  const quickBarSlots = useSettingsStore((s) => s.quickBarSlots);
  const setQuickBarSlots = useSettingsStore((s) => s.setQuickBarSlots);
  const routerUsageBaseUrl = useSettingsStore((s) => s.routerUsageBaseUrl);
  const setRouterUsageBaseUrl = useSettingsStore((s) => s.setRouterUsageBaseUrl);

  if (currentPage === "root") {
    return (
      <div className="space-y-2.5 p-2.5">
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

        <div className="rounded-lg border border-neutral-700 bg-neutral-800/70 px-3 py-2.5">
          <div className="text-[13px] font-medium text-neutral-100">
            9router usage endpoint
          </div>
          <div className="mt-0.5 text-[11px] text-neutral-400">
            Global source for usage viewer.
          </div>
          <div className="mt-2 flex gap-2">
            <input
              value={routerUsageBaseUrl}
              onChange={(e) => setRouterUsageBaseUrl(e.target.value)}
              placeholder={DEFAULT_ROUTER_USAGE_BASE_URL}
              className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-[12px] text-neutral-100 outline-none transition-colors placeholder:text-neutral-500 focus:border-blue-500"
            />
            <button
              onClick={() =>
                setRouterUsageBaseUrl(DEFAULT_ROUTER_USAGE_BASE_URL)
              }
              className="shrink-0 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-[12px] text-neutral-300 transition-colors cursor-pointer hover:border-neutral-600 hover:text-neutral-100"
            >
              Reset
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2.5 p-2.5 overflow-y-auto max-h-full">
      <div className="rounded-lg border border-neutral-700 bg-neutral-800/70 p-3">
        <h3 className="text-[13px] font-medium text-neutral-100">
          9router usage source
        </h3>
        <p className="mt-1 text-[11px] leading-4.5 text-neutral-400">
          Infinite server fetches usage from this 9router base URL.
        </p>
        <div className="mt-3 flex gap-2">
          <input
            value={routerUsageBaseUrl}
            onChange={(e) => setRouterUsageBaseUrl(e.target.value)}
            placeholder={DEFAULT_ROUTER_USAGE_BASE_URL}
            className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-[12px] text-neutral-100 outline-none transition-colors placeholder:text-neutral-500 focus:border-blue-500"
          />
          <button
            onClick={() =>
              setRouterUsageBaseUrl(DEFAULT_ROUTER_USAGE_BASE_URL)
            }
            className="shrink-0 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-[12px] text-neutral-300 transition-colors cursor-pointer hover:border-neutral-600 hover:text-neutral-100"
          >
            Default
          </button>
        </div>
        <p className="mt-2 text-[10px] text-neutral-500">
          Normalized: {normalizeRouterUsageBaseUrl(routerUsageBaseUrl)}
        </p>
        <p className="mt-1 text-[10px] text-neutral-500">
          Must be reachable from Infinite runtime. Local default uses port 20128.
        </p>
      </div>

      <div className="rounded-lg border border-neutral-700 bg-neutral-800/70 p-3">
        <h3 className="text-[13px] font-medium text-neutral-100">Font size</h3>
        <p className="mt-1 text-[11px] leading-4.5 text-neutral-400">
          Adjust the terminal text size (8-24px).
        </p>
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={() =>
              setTerminalFontSize(Math.max(8, terminalFontSize - 1))
            }
            className="flex h-7 w-7 items-center justify-center rounded bg-neutral-700 text-sm font-medium text-neutral-200 transition-colors cursor-pointer hover:bg-neutral-600"
          >
            -
          </button>
          <span className="w-8 text-center font-mono text-sm text-neutral-200">
            {terminalFontSize}
          </span>
          <button
            onClick={() =>
              setTerminalFontSize(Math.min(24, terminalFontSize + 1))
            }
            className="flex h-7 w-7 items-center justify-center rounded bg-neutral-700 text-sm font-medium text-neutral-200 transition-colors cursor-pointer hover:bg-neutral-600"
          >
            +
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-neutral-700 bg-neutral-800/70 p-3">
        <h3 className="text-[13px] font-medium text-neutral-100">
          Background color
        </h3>
        <p className="mt-1 text-[11px] leading-4.5 text-neutral-400">
          Choose app background and canvas color.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {[
            "#171717",
            "#1a1a1a",
            "#0a0a0a",
            "#1e1e2e",
            "#1a1a2e",
            "#0d1117",
            "#0f1923",
            "#2d1b2e",
          ].map((c) => (
            <button
              key={c}
              onClick={() => setBgColor(c)}
              className={`h-7 w-7 rounded-full border-2 transition-all cursor-pointer ${
                bgColor === c
                  ? "scale-110 border-white"
                  : "border-transparent hover:scale-110"
              }`}
              style={{ backgroundColor: c }}
              title={c}
            />
          ))}
          <label className="relative flex h-7 w-7 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 border-dashed border-neutral-600 hover:border-neutral-400">
            <input
              type="color"
              value={bgColor}
              onChange={(e) => setBgColor(e.target.value)}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
            <span className="pointer-events-none text-xs leading-none text-neutral-500">
              +
            </span>
          </label>
        </div>
      </div>

      <ToggleRow
        title="Terminal button shortcuts"
        description="Show or hide on-screen terminal shortcut buttons for control keys, arrows, and enter/tab actions."
        checked={showTerminalShortcuts}
        onChange={setShowTerminalShortcuts}
      />
      <div className="rounded-lg border border-neutral-700 bg-neutral-800/70 p-3">
        <h3 className="text-[13px] font-medium text-neutral-100">
          Quick bar buttons
        </h3>
        <p className="mt-1 text-[11px] leading-4.5 text-neutral-400">
          Choose which shortcuts appear in mobile quick bar. Terminal shortcuts
          shown at top, tmux shortcuts below.
        </p>
        <div className="mt-2 flex flex-wrap gap-1">
          {AVAILABLE_SHORTCUTS.map((s) => {
            const active = quickBarSlots.some((q) => q.data === s.data);
            return (
              <button
                key={s.label}
                onClick={() => {
                  if (active) {
                    setQuickBarSlots(
                      quickBarSlots.filter((q) => q.data !== s.data),
                    );
                  } else if (quickBarSlots.length < 9) {
                    setQuickBarSlots([...quickBarSlots, s]);
                  }
                }}
                className={`rounded px-2 py-1 font-mono text-[11px] transition-colors cursor-pointer ${
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
        <div className="mt-1.5 flex flex-wrap gap-1 border-t border-neutral-700 pt-1.5">
          {AVAILABLE_TMUX_SHORTCUTS.map((s) => {
            const active = quickBarSlots.some((q) => q.data === s.data);
            return (
              <button
                key={s.label}
                onClick={() => {
                  if (active) {
                    setQuickBarSlots(
                      quickBarSlots.filter((q) => q.data !== s.data),
                    );
                  } else if (quickBarSlots.length < 9) {
                    setQuickBarSlots([...quickBarSlots, s]);
                  }
                }}
                className={`rounded px-2 py-1 font-mono text-[11px] transition-colors cursor-pointer ${
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
          {quickBarSlots.length}/9 selected
        </p>
      </div>
    </div>
  );
}
