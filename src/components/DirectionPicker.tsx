import type { RelationshipDirection } from "../types";

export type DirChoice = "auto" | RelationshipDirection;

export function dirToStored(d: DirChoice): RelationshipDirection | undefined {
  return d === "auto" ? undefined : d;
}

/** Segmented control for the four direction choices. */
export function DirectionPicker({
  value,
  directional,
  onChange,
  disabled,
}: {
  value: DirChoice;
  directional: boolean;
  onChange: (d: DirChoice) => void;
  disabled?: boolean;
}) {
  const opts: { key: DirChoice; label: string; title: string }[] = [
    { key: "auto", label: directional ? "→ auto" : "↔ auto", title: "Use the type's default" },
    { key: "f", label: "→", title: "From → To" },
    { key: "b", label: "←", title: "To → From" },
    { key: "u", label: "↔", title: "Undirected" },
  ];
  return (
    <div className="flex rounded border border-white/10 overflow-hidden">
      {opts.map((o) => (
        <button
          key={o.key}
          type="button"
          disabled={disabled}
          title={o.title}
          onClick={() => onChange(o.key)}
          className={`flex-1 px-2 py-1.5 text-xs font-mono transition-colors ${
            value === o.key
              ? "bg-accent/20 text-accent"
              : "text-ink-muted hover:text-ink hover:bg-white/5"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
