import { ArrowLeft } from "lucide-react";

interface TerminalPrevButtonProps {
  disabled?: boolean;
  onClick: () => void;
  className?: string;
  iconOnly?: boolean;
}

export default function TerminalPrevButton({
  disabled = false,
  onClick,
  className = "",
  iconOnly = false,
}: TerminalPrevButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title="Previous terminal"
      className={className}
    >
      <ArrowLeft size={14} />
      {!iconOnly && <span>Previous</span>}
    </button>
  );
}
