import { ArrowRight } from "lucide-react";

interface TerminalNextButtonProps {
  disabled?: boolean;
  onClick: () => void;
  className?: string;
  iconOnly?: boolean;
}

export default function TerminalNextButton({
  disabled = false,
  onClick,
  className = "",
  iconOnly = false,
}: TerminalNextButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title="Next terminal"
      className={className}
    >
      <ArrowRight size={14} />
      {!iconOnly && <span>Next</span>}
    </button>
  );
}
