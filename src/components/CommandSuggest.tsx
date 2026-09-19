// Termius-style command suggestion strip for the SSH terminal.
// Sits above the quick bar / bottom edge; tap to complete the current input.
import { suggest } from "@/lib/commandSuggestions";

export function CommandSuggest({
  input,
  onComplete,
  disabled,
}: {
  input: string;
  onComplete: (completion: string) => void;
  disabled?: boolean;
}) {
  const list = disabled || !input.trim() ? [] : suggest(input, 5);
  if (list.length === 0) return null;

  return (
    <div className="flex items-center gap-1 px-2 py-1.5 mr-5 bg-neutral-900/90 backdrop-blur-sm border border-neutral-700 rounded-lg overflow-x-auto scrollbar-hide">
      <span className="text-[9px] text-neutral-600 font-mono shrink-0 mr-0.5">
        ⚡
      </span>
      {list.map((s) => {
        const completion = s.cmd.slice(input.length);
        return (
          <button
            key={s.cmd}
            onClick={() => onComplete(completion)}
            title={s.cmd}
            className="shrink-0 h-7 px-2 flex items-center rounded-md text-[11px] font-mono text-neutral-300 bg-neutral-800 hover:bg-neutral-700 active:bg-neutral-600 transition-colors cursor-pointer"
          >
            <span className="max-w-[9rem] truncate">{s.cmd}</span>
          </button>
        );
      })}
    </div>
  );
}
