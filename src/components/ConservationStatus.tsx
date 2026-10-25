import type { SpeciesConservation } from "../types";
import { safeHref } from "../utils/safeUrl";
import { Tooltip } from "./Floating";
import { InfoPopover } from "./InfoPopover";

const STATE_NAMES: Record<string, string> = { MN: "Minnesota" };
const RANKS_EXPLAINED_URL = "https://www.natureserve.org/conservation-status-assessment";

// NatureServe's 1-5 scale, most to least at risk. `loss` finishes each
// definition with "extinction" (global) or "disappearing from <state>".
const LEVELS = [
  {
    level: "1",
    name: "Critically Imperiled",
    rgb: "251, 113, 133",
    meaning: (loss: string) =>
      `Very high risk of ${loss}: very restricted range, very few populations, steep declines, or severe threats.`,
  },
  {
    level: "2",
    name: "Imperiled",
    rgb: "251, 146, 60",
    meaning: (loss: string) =>
      `High risk of ${loss}: restricted range, few populations, steep declines, or severe threats.`,
  },
  {
    level: "3",
    name: "Vulnerable",
    rgb: "252, 211, 77",
    meaning: (loss: string) =>
      `Moderate risk of ${loss}: restricted range, relatively few populations, or recent widespread declines.`,
  },
  {
    level: "4",
    name: "Apparently Secure",
    rgb: "190, 214, 110",
    meaning: (loss: string) =>
      `Fairly low risk of ${loss} thanks to an extensive range and/or many populations, with some cause for concern.`,
  },
  {
    level: "5",
    name: "Secure",
    rgb: "127, 176, 105",
    meaning: (loss: string) =>
      `Very low risk of ${loss}: very extensive range, abundant populations, little concern from declines or threats.`,
  },
] as const;

// Ranks that sit off the 1-5 scale.
const OFF_SCALE: Record<string, { name: string; meaning: string; alarming?: boolean }> = {
  H: {
    name: "Possibly Extirpated",
    meaning: "Known only from historical records, but there is some hope it will be found again.",
    alarming: true,
  },
  X: {
    name: "Presumed Extirpated",
    meaning: "Not found despite intensive searches; virtually no chance of rediscovery.",
    alarming: true,
  },
  U: { name: "Unrankable", meaning: "Information is lacking or too conflicting to rank it." },
  NR: { name: "Not yet assessed", meaning: "NatureServe hasn't assessed its status here yet." },
  NA: {
    name: "Not ranked",
    meaning:
      "Not a conservation target here, usually because it's introduced, a hybrid, or an occasional visitor.",
  },
};

function rankParts(rank: string | null) {
  const m = rank?.match(/^([GTS])(NR|NA|[1-5HXU])(B)?/);
  return m ? { scope: m[1], level: m[2], breeding: !!m[3] } : null;
}

function Swatch({ rgb }: { rgb: string }) {
  return (
    <span
      className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
      style={{ backgroundColor: `rgb(${rgb})` }}
    />
  );
}

function Spectrum({
  rank,
  scope,
  place,
}: {
  rank: string | null;
  scope: string;
  /** State name for state ranks; null for global. */
  place: string | null;
}) {
  const parts = rankParts(rank);
  const loss = place ? `disappearing from ${place}` : "extinction";
  const offScale = parts ? OFF_SCALE[parts.level] : undefined;
  const scaleLevel = parts && !offScale ? parts.level : null;

  return (
    <div className="flex items-end gap-[3px] h-3">
      {LEVELS.map((l, i) => {
        const isCurrent = l.level === scaleLevel;
        return (
          <Tooltip
            key={l.level}
            className="group flex-1 h-full flex items-end outline-none cursor-help"
            title={
              <span className="flex items-center gap-1.5">
                <Swatch rgb={l.rgb} />
                {scope}
                {l.level} · {l.name}
              </span>
            }
            content={
              <>
                {l.meaning(loss)}
                {isCurrent && (
                  <span className="block mt-1.5 text-ink">
                    This species is ranked here
                    {parts?.breeding && " (breeding population)"}.
                  </span>
                )}
              </>
            }
          >
            <span
              className={`spec-seg-in block w-full rounded-full transition-all duration-200 ${
                isCurrent ? "h-2.5" : "h-1.5 group-hover:h-2 group-focus-visible:h-2"
              }`}
              style={{
                ["--i" as string]: isCurrent ? LEVELS.length + 1 : i,
                backgroundColor: `rgba(${l.rgb}, ${isCurrent ? 1 : scaleLevel ? 0.2 : 0.1})`,
                boxShadow: isCurrent ? `0 0 10px rgba(${l.rgb}, 0.45)` : undefined,
              }}
            />
          </Tooltip>
        );
      })}
    </div>
  );
}

function statusText(rank: string | null) {
  const parts = rankParts(rank);
  if (!parts) return { name: null, rgb: null, alarming: false };
  const off = OFF_SCALE[parts.level];
  if (off) {
    // Gone everywhere is extinction, not extirpation.
    const name = parts.scope === "S" ? off.name : off.name.replace("Extirpated", "Extinct");
    return { name, rgb: null, alarming: !!off.alarming };
  }
  const l = LEVELS.find((x) => x.level === parts.level)!;
  return { name: l.name, rgb: l.rgb, alarming: false };
}

function rankCodeHint(rank: string, place: string | null): string {
  const parts = rankParts(rank);
  const scope =
    parts?.scope === "S"
      ? `State rank for ${place}`
      : parts?.scope === "T"
        ? "Global rank for this subspecies or variety"
        : "Global rank, across the species' whole range";
  const off = parts ? OFF_SCALE[parts.level] : undefined;
  const breeding = parts?.breeding ? " The B means it applies to the breeding population." : "";
  return `${scope}.${off ? ` ${off.meaning}` : ""}${breeding}`;
}

const PRESENCE = {
  native: {
    label: "Native",
    hint: "Occurs here naturally.",
    className: "bg-accent/12 text-accent/90",
  },
  introduced: {
    label: "Introduced",
    hint: "Not native here; brought in by people.",
    className: "bg-amber-300/10 text-amber-200/85",
  },
  both: {
    label: "Native & introduced",
    hint: "Native here, though some populations here were introduced from elsewhere.",
    className: "bg-accent/12 text-accent/90",
  },
};

function Row({
  scopeLabel,
  scopeHint,
  rank,
  place,
  presence,
}: {
  scopeLabel: string;
  scopeHint: string;
  rank: string | null;
  place: string | null;
  presence?: keyof typeof PRESENCE | null;
}) {
  const parts = rankParts(rank);
  const status = statusText(rank);
  const pill = presence ? PRESENCE[presence] : null;
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 items-start">
      <Tooltip
        className="text-[9px] uppercase tracking-widest text-white/35 truncate pt-0.5 cursor-help outline-none hover:text-white/55 focus-visible:text-white/55 transition-colors"
        content={scopeHint}
      >
        {scopeLabel}
      </Tooltip>
      <div className="min-w-0">
        <Spectrum rank={rank} scope={parts?.scope ?? (place ? "S" : "G")} place={place} />
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          {status.name && (
            <span
              className={`text-[11px] ${status.alarming ? "text-rose-300" : status.rgb ? "text-white/80" : "text-white/45"}`}
            >
              {status.name}
            </span>
          )}
          {rank && (
            <Tooltip
              className="text-[9px] font-mono text-white/30 hover:text-white/60 focus-visible:text-white/60 cursor-help outline-none transition-colors"
              title={rank}
              content={rankCodeHint(rank, place)}
            >
              {rank}
            </Tooltip>
          )}
          {pill && (
            <Tooltip
              className={`text-[9px] uppercase tracking-widest leading-none px-1.5 py-1 rounded-full cursor-help outline-none ${pill.className}`}
              content={pill.hint}
            >
              {pill.label}
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  );
}

function presenceOf(native: boolean, exotic: boolean): keyof typeof PRESENCE | null {
  if (native && exotic) return "both";
  if (native) return "native";
  if (exotic) return "introduced";
  return null;
}

export function ConservationStatus({
  conservation,
  url,
}: {
  conservation: SpeciesConservation;
  /** This species' NatureServe Explorer page. */
  url?: string | null;
}) {
  const { globalRank, state } = conservation;
  const stateName = state ? (STATE_NAMES[state.code] ?? state.code) : null;
  const href = safeHref(url);

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2.5">
        <span className="flex items-center gap-1.5">
          <p className="text-[10px] uppercase tracking-widest text-white/50">
            Conservation status
          </p>
          <InfoPopover
            label="About conservation status"
            title="Conservation status"
            iconSize={10}
            panelClassName="w-64"
          >
            <span className="block">How at risk a species is of disappearing, as rated by NatureServe.</span>
            <span className="flex gap-[3px] mt-2.5">
              {LEVELS.map((l) => (
                <span
                  key={l.level}
                  className="flex-1 h-4 rounded-sm flex items-center justify-center font-mono text-[9px] text-surface/80"
                  style={{ backgroundColor: `rgba(${l.rgb}, 0.85)` }}
                >
                  {l.level}
                </span>
              ))}
            </span>
            <span className="flex justify-between mt-1 text-[9px] uppercase tracking-widest text-ink-faint">
              <span>Critically imperiled</span>
              <span>Secure</span>
            </span>
            <span className="grid grid-cols-[1.75rem_1fr] gap-x-2 gap-y-1 mt-2.5">
              <span className="font-mono text-ink">G</span>
              <span>Across its whole range</span>
              <span className="font-mono text-ink">S</span>
              <span>Within {stateName ?? "Minnesota"}; can differ a lot from G</span>
              <span className="font-mono text-ink">NR</span>
              <span>Not yet assessed</span>
              <span className="font-mono text-ink">NA</span>
              <span>Not ranked, usually because it's introduced</span>
            </span>
            <span className="block mt-2.5 text-ink-faint">Hover or tap the bars for details.</span>
            <a
              href={RANKS_EXPLAINED_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mt-1.5 text-accent/85 hover:text-accent transition-colors"
            >
              How NatureServe ranks work {"↗\uFE0E"}
            </a>
          </InfoPopover>
        </span>
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[9px] uppercase tracking-widest text-white/30 hover:text-accent transition-colors"
            title="View this species on NatureServe Explorer"
          >
            NatureServe {"↗\uFE0E"}
          </a>
        ) : (
          <p className="text-[9px] uppercase tracking-widest text-white/20">NatureServe</p>
        )}
      </div>
      <div className="space-y-3">
        {globalRank && (
          <Row
            scopeLabel="Global"
            scopeHint="Status across the species' entire range"
            rank={globalRank}
            place={null}
          />
        )}
        {state && stateName && (
          <Row
            scopeLabel={stateName}
            scopeHint={`Status within ${stateName}`}
            rank={state.rank}
            place={stateName}
            presence={presenceOf(state.native, state.exotic)}
          />
        )}
      </div>
      <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 mt-2">
        <span />
        <span className="flex justify-between text-[8px] uppercase tracking-widest text-white/20">
          <span>← At risk</span>
          <span>Secure →</span>
        </span>
      </div>
    </div>
  );
}
