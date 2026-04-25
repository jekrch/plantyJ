import { ChevronLeft, ChevronRight } from "lucide-react";

interface NavButtonProps {
  direction: "prev" | "next";
  enabled: boolean;
  onClick: () => void;
}

function NavButton({ direction, enabled, onClick }: NavButtonProps) {
  const Icon = direction === "prev" ? ChevronLeft : ChevronRight;
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        if (enabled) onClick();
      }}
      disabled={!enabled}
      className={`
        px-4 rounded-full transition-colors duration-150 cursor-pointer
        outline-none focus:outline-none focus-visible:outline-none
      `}
      aria-label={direction === "prev" ? "Previous panel" : "Next panel"}
    >
      <Icon size={38} strokeWidth={1.5} 
            className={`${enabled
          ? "stroke-white/40 hover:stroke-white/60 active:stroke-white/80"
          : "stroke-white/10 cursor-default"}
       `}/>
    </button>
  );
}

export default NavButton;