// Termius-style command suggestion strip for the SSH terminal.
// Sits above the quick bar / bottom edge; tap a suggestion to run it.
import { suggest, topCommands, recordCommand } from "@/lib/commandSuggestions";

export function CommandSuggest({
  input,
  onSelect,
  disabled,
}: {
  input: string;
  onSelect: (cmd: string) => void;
  disabled?: boolean;
}) {
  // ponytail: recompute on every keystroke against a small local list (<200 entries) — fine;
  // add an API + server-side learned history when this needs to work across devices.
  const list = disabled ? [] : input.trim() ? suggest(input, 5) : topCommands(5);
  if (list.length === 0) return null;

  const commit = (cmd: string) => {
    recordCommand(cmd);
    onSelect(cmd);
  };

  return (
    <div className="flex items-center gap-1 px-2 py-1.5 mr-5 bg-neutral-900/90 backdrop-blur-sm border border-neutral-700 rounded-lg overflow-x-auto scrollbar-hide">
      <span className="text-[9px] text-neutral-600 font-mono shrink-0 mr-0.5">
        ⚡
      </span>
      {list.map((s) => (
        <button
          key={s.cmd}
          onClick={() => commit(s.cmd)}
          title={s.cmd}
          className="shrink-0 h-7 px-2 flex items-center rounded-md text-[11px] font-mono text-neutral-300 bg-neutral-800 hover:bg-neutral-700 active:bg-neutral-600 transition-colors cursor-pointer"
        >
          <span className="max-w-[9rem] truncate">{s.cmd}</span>
        </button>
      ))}
    </div>
  );
}
