import type { PhenologyStageId, SpeciesPhenology } from "../types";
import { safeHref } from "../utils/safeUrl";
import { Tooltip } from "./Floating";
import { InfoPopover } from "./InfoPopover";

const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const ANNOTATIONS_URL = "https://www.inaturalist.org/pages/annotations";

// Below this many tagged sightings the timing is too noisy to read much into.
const FEW_OBSERVATIONS = 50;
// A month counts toward the active window once it reaches this share of the peak.
const ACTIVE_SHARE = 0.2;

// `rgb` colors the row; cell opacity scales with that month's share of the
// row's peak. `hint` says what observers tagged; `active` phrases the window.
const STAGES: Record<PhenologyStageId, { rgb: string; hint: string; active: string }> = {
  budding: { rgb: "190, 214, 120", hint: "Unopened flower buds visible.", active: "Buds" },
  flowering: { rgb: "232, 140, 190", hint: "Open flowers visible.", active: "Blooms" },
  fruiting: {
    rgb: "230, 180, 90",
    hint: "Fruit, seed heads, or seeds visible.",
    active: "Fruits or seeds",
  },
  leafOut: {
    rgb: "127, 176, 105",
    hint: "Leaf buds breaking open into new leaves.",
    active: "Leafs out",
  },
  fallColor: {
    rgb: "224, 120, 70",
    hint: "Leaves turned color ahead of dropping.",
    active: "Colors",
  },
  egg: { rgb: "200, 200, 170", hint: "Eggs, egg masses, or egg cases.", active: "Eggs seen" },
  larva: {
    rgb: "170, 210, 120",
    hint: "Caterpillars, grubs, maggots, and other larvae.",
    active: "Larvae seen",
  },
  nymph: {
    rgb: "140, 200, 170",
    hint: "Young that resemble small adults, often wingless (e.g. grasshoppers, true bugs).",
    active: "Nymphs seen",
  },
  pupa: {
    rgb: "190, 160, 120",
    hint: "Chrysalises, cocoons, and other resting stages before adulthood.",
    active: "Pupae seen",
  },
  juvenile: { rgb: "130, 190, 220", hint: "Young animals not yet fully grown.", active: "Young seen" },
  adult: { rgb: "110, 160, 230", hint: "Fully grown adults.", active: "Adults seen" },
};
const FALLBACK = STAGES.leafOut;
const PLANT_STAGES = new Set<PhenologyStageId>([
  "budding",
  "flowering",
  "fruiting",
  "leafOut",
  "fallColor",
]);

// The run of months around the peak that stay at or above ACTIVE_SHARE of it,
// wrapping across the new year so winter windows read as e.g. Nov–Feb.
function activeWindow(months: number[]) {
  const peakCount = Math.max(...months);
  const peak = months.indexOf(peakCount);
  const on = (i: number) => months[(i + 12) % 12] >= peakCount * ACTIVE_SHARE;
  let start = peak;
  let end = peak;
  while (end - start < 11 && on(start - 1)) start--;
  while (end - start < 11 && on(end + 1)) end++;
  return {
    peak,
    yearRound: end - start >= 11,
    start: (start + 12) % 12,
    end: end % 12,
  };
}

function summary(stage: PhenologyStageId, months: number[]): string {
  const w = activeWindow(months);
  const lead = STAGES[stage]?.active ?? "Seen";
  if (!w.yearRound && w.start === w.end) return `${lead} mostly in ${MONTH_NAMES[w.peak]}.`;
  const when = w.yearRound ? "year-round" : `mostly ${MONTH_SHORT[w.start]}–${MONTH_SHORT[w.end]}`;
  return `${lead} ${when}, peaking in ${MONTH_NAMES[w.peak]}.`;
}

function Ramp({ rgb, className = "" }: { rgb: string; className?: string }) {
  return (
    <span
      className={`block h-1.5 rounded-full ${className}`}
      style={{
        backgroundImage: `linear-gradient(to right, rgba(${rgb}, 0.15), rgba(${rgb}, 0.9))`,
      }}
    />
  );
}

export function PhenologyStrip({
  phenology,
  url,
}: {
  phenology: SpeciesPhenology;
  /** This species' iNaturalist taxon page. */
  url?: string | null;
}) {
  const href = safeHref(url);
  const thisMonth = new Date().getMonth();
  const total = phenology.stages.reduce(
    (sum, s) => sum + s.months.reduce((a, b) => a + b, 0),
    0,
  );
  const isFallback = phenology.place !== "Minnesota";
  const legendRgb = (STAGES[phenology.stages[0]?.stage] ?? FALLBACK).rgb;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2.5">
        <span className="flex items-center gap-1.5">
          <p className="text-[10px] uppercase tracking-widest text-white/50">Seasonal timeline</p>
          <InfoPopover
            label="About the seasonal timeline"
            title="Seasonal timeline"
            iconSize={10}
            panelClassName="w-64"
          >
            <span className="block">
              When this species is usually seen at each life stage, counted by month from
              iNaturalist photos that observers have tagged with what the{" "}
              {phenology.stages.some((s) => PLANT_STAGES.has(s.stage)) ? "plant" : "animal"}{" "}
              is doing.
            </span>
            <Ramp rgb={legendRgb} className="mt-2.5 h-2" />
            <span className="flex justify-between mt-1 text-[9px] uppercase tracking-widest text-ink-faint">
              <span>Few sightings</span>
              <span>Peak month</span>
            </span>
            <span className="grid grid-cols-[3.25rem_1fr] gap-x-2 gap-y-1 mt-2.5">
              <span className="text-ink">Rows</span>
              <span>Each is shaded against its own peak, so compare timing across rows, not size.</span>
              <span className="text-ink">Peak</span>
              <span>The month with the most sightings at that stage.</span>
              <span className="text-ink">Place</span>
              <span>Minnesota sightings, or US-wide when Minnesota has too few.</span>
              <span className="text-ink">Bias</span>
              <span>Counts follow when people are out looking, so summer runs high and winter low.</span>
            </span>
            <span className="block mt-2.5 text-ink-faint">
              A regional pattern, not a record of your garden. Hover or tap a month for counts.
            </span>
            <a
              href={ANNOTATIONS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mt-1.5 text-accent/85 hover:text-accent transition-colors"
            >
              How iNaturalist annotations work {"↗\uFE0E"}
            </a>
          </InfoPopover>
        </span>
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[9px] uppercase tracking-widest text-white/30 hover:text-accent transition-colors"
            title="View this species on iNaturalist"
          >
            iNaturalist {"↗\uFE0E"}
          </a>
        ) : (
          <p className="text-[9px] uppercase tracking-widest text-white/20">iNaturalist</p>
        )}
      </div>
      <div
        className="grid gap-x-[2px] gap-y-1 items-center"
        style={{ gridTemplateColumns: "5.5rem repeat(12, minmax(0, 1fr)) 2rem" }}
      >
        <span />
        {MONTHS.map((m, i) => (
          <span
            key={`head-${i}`}
            className={`text-[9px] text-center font-mono ${i === thisMonth ? "text-accent" : "text-white/30"}`}
            title={i === thisMonth ? `${MONTH_NAMES[i]} (this month)` : MONTH_NAMES[i]}
          >
            {m}
          </span>
        ))}
        <span className="text-[8px] uppercase tracking-widest text-white/25 text-right">Peak</span>
        {phenology.stages.map((s, row) => {
          const info = STAGES[s.stage] ?? FALLBACK;
          const stageTotal = s.months.reduce((a, b) => a + b, 0);
          const peakCount = Math.max(...s.months);
          const peak = s.months.indexOf(peakCount);
          return [
            <Tooltip
              key={`${s.stage}-label`}
              className="text-[9px] uppercase tracking-widest text-white/35 truncate pr-1 cursor-help outline-none hover:text-white/55 focus-visible:text-white/55 transition-colors"
              title={
                <span className="flex items-center gap-1.5">
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: `rgb(${info.rgb})` }}
                  />
                  {s.label}
                </span>
              }
              content={
                <>
                  {info.hint}
                  <span className="block mt-1.5 text-ink">{summary(s.stage, s.months)}</span>
                  <span className="block mt-1 text-ink-faint tabular-nums">
                    {stageTotal.toLocaleString()} tagged sighting{stageTotal === 1 ? "" : "s"}
                  </span>
                </>
              }
            >
              {s.label}
            </Tooltip>,
            ...s.months.map((count, i) => {
              const share = peakCount > 0 ? count / peakCount : 0;
              const pct = stageTotal > 0 ? Math.round((count / stageTotal) * 100) : 0;
              return (
                <Tooltip
                  key={`${s.stage}-${i}`}
                  className="group h-3 flex items-stretch cursor-help outline-none"
                  title={`${s.label} · ${MONTH_NAMES[i]}`}
                  panelClassName="w-48"
                  content={
                    count > 0 ? (
                      <>
                        <span className="tabular-nums">
                          {count.toLocaleString()} sighting{count === 1 ? "" : "s"} ({pct}% of this
                          stage).
                        </span>
                        {i === peak && <span className="block mt-1 text-ink">Peak month.</span>}
                      </>
                    ) : (
                      "No tagged sightings this month."
                    )
                  }
                >
                  <span
                    className={`spec-seg-in block w-full rounded-[2px] transition-[filter] duration-150 group-hover:brightness-125 group-focus-visible:brightness-125 ${
                      i === thisMonth ? "ring-1 ring-inset ring-white/25" : ""
                    }`}
                    style={{
                      ["--i" as string]: row + i,
                      backgroundColor:
                        count > 0
                          ? `rgba(${info.rgb}, ${0.15 + 0.75 * share})`
                          : "rgba(255,255,255,0.04)",
                    }}
                  />
                </Tooltip>
              );
            }),
            <span
              key={`${s.stage}-peak`}
              className="text-[9px] font-mono text-white/45 text-right"
              title={`Peak: ${MONTH_NAMES[peak]}`}
            >
              {MONTH_SHORT[peak]}
            </span>,
          ];
        })}
      </div>
      <div
        className="grid gap-x-[2px] mt-2 items-center"
        style={{ gridTemplateColumns: "5.5rem minmax(0, 1fr) 2rem" }}
      >
        <span />
        <span className="flex items-center gap-1.5 text-[8px] uppercase tracking-widest text-white/20">
          <span>Few</span>
          <Ramp rgb={legendRgb} className="flex-1 opacity-60" />
          <span>Peak</span>
        </span>
        <span />
      </div>
      <p className="mt-2 text-[10px] leading-snug text-white/35 tabular-nums">
        {total.toLocaleString()} tagged sighting{total === 1 ? "" : "s"} in {phenology.place}.
        {isFallback && " Too few in Minnesota, so this uses US-wide data and timing may run earlier or later than here."}
        {total < FEW_OBSERVATIONS && " That's a small sample, so treat the timing as rough."}
      </p>
    </div>
  );
}
