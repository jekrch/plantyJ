export function CtrlBtn({
  label,
  onClick,
  children,
  active,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`flex items-center justify-center h-7 w-7 rounded transition-colors ${
        active
          ? "text-accent bg-white/5"
          : "text-ink-muted hover:text-accent hover:bg-white/5"
      }`}
    >
      {children}
    </button>
  );
}

export function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative -mb-px py-1.5 text-[11px] font-display tracking-wider uppercase transition-colors ${
        active
          ? "text-accent border-b border-accent"
          : "text-ink-muted hover:text-ink border-b border-transparent"
      }`}
    >
      {children}
    </button>
  );
}
