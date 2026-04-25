import { useState } from "react";
import HatchFiller from "./HatchFiller";

const PYRAMID_ROWS = 5;
const CELL_SIZE = 64;
const CELL_GAP = 4;

const PALETTE = ["#7fb069", "#5a8c4a", "#3d6b30"]; //["#7A8B2A", "#e97d62", "#5B8FA8", "#C7A84E", "#A8627D", "#6B8F71"];

function buildRandomColors(rows: number[]): string[][] {
  return rows.map((count) =>
    Array.from({ length: count }, () =>
      PALETTE[Math.floor(Math.random() * PALETTE.length)]
    )
  );
}

export default function FooterPyramid() {
  const rows: number[] = [];
  for (let i = PYRAMID_ROWS; i >= 1; i--) rows.push(i);

  const [colors] = useState(() => buildRandomColors(rows));

  return (
    <div className="flex flex-col items-center gap-0 pt-8 pb-16">
      <p
        className="text-white/80 font-black tracking-widest uppercase text-md mb-4 mx-10"
        style={{ fontFamily: "'Space Mono', monospace" }}
      >
        "More respect is due the little things that run the world" 
        <p className="text-center">E.O. WILSON</p>
      </p>
      <div className="flex flex-col items-center" style={{ gap: `${CELL_GAP}px` }}>
        {rows.map((cellCount, rowIdx) => (
          <div key={rowIdx} className="flex" style={{ gap: `${CELL_GAP}px` }}>
            {Array.from({ length: cellCount }).map((_, cellIdx) => (
              <div
                key={cellIdx}
                className="rounded-sm overflow-hidden"
                style={{ width: CELL_SIZE, height: CELL_SIZE }}
              >
                <HatchFiller empty colorOverride={colors[rowIdx][cellIdx]} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}