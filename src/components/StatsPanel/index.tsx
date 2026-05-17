import { useMemo, useState } from "react";
import { Cpu, Leaf, PawPrint, MapPin, Image as ImageIcon } from "lucide-react";
import type { AIAnalysis, AIVerdict, Organism, Species, Zone } from "../../types";
import { computeStats, RANKS, type TaxonRank } from "../../utils/stats";
import { ModelAttribution } from "../ModelAttribution";
import { HeroBanner, StatTileRow, Section, MiniStat, HighlightCard } from "./chrome";
import { PieChart, RankSelector } from "./PieChart";
import { Timeline } from "./Timeline";
import { EcoFit } from "./EcoFit";

interface Props {
  organisms: Organism[];
  zones: Zone[];
  speciesByShortCode: Map<string, Species>;
  aiAnalyses: AIAnalysis[];
  onSelectTaxon: (name: string) => void;
  onSpotlightZone: (zoneCode: string) => void;
  onShowBioclipConflicts: () => void;
  onShowEcoFit: (verdict: AIVerdict) => void;
}

export default function StatsPanel({
  organisms,
  zones,
  speciesByShortCode,
  aiAnalyses,
  onSelectTaxon,
  onSpotlightZone,
  onShowBioclipConflicts,
  onShowEcoFit,
}: Props) {
  const stats = useMemo(
    () => computeStats(organisms, zones, speciesByShortCode, aiAnalyses),
    [organisms, zones, speciesByShortCode, aiAnalyses],
  );
  const [rank, setRank] = useState<TaxonRank>("family");
  const rankInfo = RANKS.find((r) => r.id === rank) ?? RANKS[4];
  const rankSlices = stats.taxa.slicesByRank[rank];
  const rankCount = stats.taxa.countsByRank[rank];

  if (organisms.length === 0) {
    return (
      <div className="px-6 py-10 text-center">
        <p className="text-sm text-ink-muted">No data yet.</p>
      </div>
    );
  }

  return (
    <div className="px-4 py-5 sm:px-5 space-y-6">
      <HeroBanner days={stats.daysSinceFirst} firstDate={stats.firstDate} />

      <StatTileRow tiles={[
        { icon: ImageIcon, label: "Photos", value: stats.totalPics },
        { icon: Leaf, label: "Plants", value: stats.uniqueOrganismSpecies, hint: `${stats.organismPicCount} photos` },
        { icon: PawPrint, label: "Animals", value: stats.uniqueAnimalSpecies, hint: `${stats.animalPicCount} photos` },
        { icon: MapPin, label: "Zones", value: stats.zonesWithPics, hint: `of ${stats.totalZones}` },
      ]} />

      <Section title="Biodiversity" subtitle="Photos grouped by taxonomic rank">
        <RankSelector value={rank} onChange={setRank} />
        {rankSlices.length > 0 ? (
          <PieChart
            slices={rankSlices}
            title={`Photos by ${rankInfo.label}`}
            centerLabel={rankInfo.plural.toUpperCase()}
            centerValue={rankCount}
            onSelect={onSelectTaxon}
          />
        ) : (
          <p className="text-xs text-ink-faint italic px-1">No {rankInfo.label.toLowerCase()} data available yet.</p>
        )}
      </Section>

      <Section title="Activity" subtitle={stats.timeline.caption}>
        <Timeline buckets={stats.timeline.buckets} />
      </Section>

      <Section title="Zones" subtitle="Where life shows up">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <HighlightCard
            label="Most photographed"
            primary={stats.topZoneByPics?.name ?? "—"}
            secondary={stats.topZoneByPics ? `${stats.topZoneByPics.count} photos` : ""}
            onClick={
              stats.topZoneByPics
                ? () => onSpotlightZone(stats.topZoneByPics!.code)
                : null
            }
          />
          <HighlightCard
            label="Most diverse"
            primary={stats.topZoneByDiversity?.name ?? "—"}
            secondary={stats.topZoneByDiversity ? `${stats.topZoneByDiversity.count} species` : ""}
            onClick={
              stats.topZoneByDiversity
                ? () => onSpotlightZone(stats.topZoneByDiversity!.code)
                : null
            }
          />
        </div>
      </Section>

      <Section
        title="Eco fit (AI)"
        subtitle="AI's read on each organism in its zone"
        info={<ModelAttribution iconSize={11} />}
      >
        {stats.ecoFit.rated > 0 ? (
          <EcoFit
            counts={stats.ecoFit.counts}
            unrated={stats.ecoFit.unrated}
            onSelect={onShowEcoFit}
          />
        ) : (
          <p className="text-xs text-ink-faint italic px-1">
            No AI analyses yet.
          </p>
        )}
      </Section>

      <Section title="Machine ID" subtitle="BioCLIP cross-checks every upload">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
          <MiniStat
            label="Avg confidence"
            value={stats.bioclip.avgConfidence === null ? "—" : `${Math.round(stats.bioclip.avgConfidence * 100)}%`}
          />
          <MiniStat
            label="Agreements"
            value={formatScore(stats.bioclip.agreements)}
            subline={stats.bioclip.genusOnly > 0 ? `+${stats.bioclip.genusOnly} genus` : undefined}
          />
          <MiniStat
            label="Disagreements"
            value={formatScore(stats.bioclip.disagreements)}
            accent={stats.bioclip.disagreements > 0}
            onClick={stats.bioclip.disagreements > 0 ? onShowBioclipConflicts : null}
            hint="View"
            subline={stats.bioclip.genusOnly > 0 ? `incl. ${stats.bioclip.genusOnly} genus` : undefined}
          />
          <MiniStat label="Unidentified" value={stats.unidentifiedPics} accent={stats.unidentifiedPics > 0} />
        </div>
        <p className="text-[11px] text-ink-faint leading-relaxed flex gap-2 items-start">
          <Cpu size={11} strokeWidth={1.5} className="mt-0.5 stroke-ink-faint flex-shrink-0" />
          <span>
            <a
              href="https://imageomics.github.io/bioclip/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-ink-muted hover:text-accent transition-colors"
            >
              BioCLIP
            </a>{" "}
            is a foundation model trained on the Tree of Life. It guesses each
            uploaded photo's species — disagreements flag photos that may need a
            second look.
          </span>
        </p>
      </Section>
    </div>
  );
}

function formatScore(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
