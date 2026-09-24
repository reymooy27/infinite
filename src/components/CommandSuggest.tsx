import { suggest } from "@/lib/commandSuggestions";

export function CommandSuggest({
  input,
  onComplete,
  className,
}: {
  input: string;
  onComplete: (completion: string) => void;
  className?: string;
}) {
  const list = !input.trim() ? [] : suggest(input, 5);
  if (list.length === 0) return null;

  return (
    <div
      className={`flex flex-col overflow-hidden bg-neutral-900/95 backdrop-blur-md border border-neutral-700/80 rounded-lg shadow-xl ${className}`}
      style={{ animation: "cmd-suggest-in 120ms ease-out" }}
    >
      <div className="flex items-center gap-1.5 px-2.5 py-1 border-b border-neutral-800">
        <span className="text-[9px] text-neutral-500 font-mono select-none">
          $ commands
        </span>
      </div>
      <div className="max-h-[9rem] overflow-y-auto">
        {list.map((s) => {
          const completion = s.cmd.slice(input.length);
          return (
            <button
              key={s.cmd}
              onClick={() => onComplete(completion)}
              title={s.cmd}
              className="w-full text-left px-2.5 py-1.5 text-[11px] font-mono text-neutral-300 hover:bg-neutral-800 active:bg-neutral-700 transition-colors cursor-pointer flex items-center gap-2"
            >
              <span className="text-neutral-600 shrink-0 text-[10px]">›</span>
              <span className="truncate">{s.cmd}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
