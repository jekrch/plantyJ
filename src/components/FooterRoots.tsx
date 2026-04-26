import React, { useEffect, useState } from 'react';

const VIEW_W = 600;
const VIEW_H = 300;
const TX = 300;
const TRUNK_BASE_Y = 25;
const MAX_Y = VIEW_H - 8;
const MAX_DEPTH = 2;
const MIN_WIDTH = 0.45;

const COLOR_TRUNK = "var(--color-ink-faint)"; //"#6b4423";
const COLOR_BRANCH = "#8b6f47";
const COLOR_ROOTLET = "#b08968";

interface Seg {
  ax: number; ay: number;
  mx: number; my: number;
  bx: number; by: number;
  wa: number; wb: number;
  color: string;
}

interface Quote {
  text: string;
  author: string;
}

function taperedPath(s: Seg): string {
  const { ax, ay, mx, my, bx, by, wa, wb } = s;
  const t1x = mx - ax, t1y = my - ay;
  const t1l = Math.hypot(t1x, t1y) || 1;
  const n1x = -t1y / t1l, n1y = t1x / t1l;
  const t2x = bx - mx, t2y = by - my;
  const t2l = Math.hypot(t2x, t2y) || 1;
  const n2x = -t2y / t2l, n2y = t2x / t2l;
  const ha = wa / 2, hb = wb / 2;
  const aLx = ax + n1x * ha, aLy = ay + n1y * ha;
  const bLx = bx + n2x * hb, bLy = by + n2y * hb;
  const aRx = ax - n1x * ha, aRy = ay - n1y * ha;
  const bRx = bx - n2x * hb, bRy = by - n2y * hb;
  const avgNx = (n1x + n2x) / 2, avgNy = (n1y + n2y) / 2;
  const avgW = (wa + wb) / 2;
  const cLx = mx + avgNx * avgW / 2, cLy = my + avgNy * avgW / 2;
  const cRx = mx - avgNx * avgW / 2, cRy = my - avgNy * avgW / 2;
  const f = (n: number) => n.toFixed(1);
  return `M ${f(aLx)} ${f(aLy)} Q ${f(cLx)} ${f(cLy)} ${f(bLx)} ${f(bLy)} L ${f(bRx)} ${f(bRy)} Q ${f(cRx)} ${f(cRy)} ${f(aRx)} ${f(aRy)} Z`;
}

function mulberry32(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function colorForWidth(w: number): string {
  if (w > 9) return COLOR_TRUNK;
  if (w > 3.2) return COLOR_BRANCH;
  return COLOR_ROOTLET;
}

function branch(
  segs: Seg[],
  rng: () => number,
  sx: number, sy: number,
  angle: number,
  length: number,
  width: number,
  depth: number,
): void {
  if (depth > MAX_DEPTH || width < MIN_WIDTH || sy >= MAX_Y) return;

  // Subtle gravity bias — pulls drifting branches back toward downward as they get deeper
  const grav = 0.05 * depth;
  let a = angle + (Math.PI / 2 - angle) * grav;
  if (a < 0.04) a = 0.04;
  if (a > Math.PI - 0.04) a = Math.PI - 0.04;

  let ex = sx + Math.cos(a) * length;
  let ey = sy + Math.sin(a) * length;

  if (ey > MAX_Y) {
    const scale = (MAX_Y - sy) / (ey - sy);
    if (scale < 0.15) return;
    ex = sx + (ex - sx) * scale;
    ey = MAX_Y;
    length = length * scale;
  }

  const curve = (rng() - 0.5) * 0.22;
  const perpX = -Math.sin(a), perpY = Math.cos(a);
  const mx = (sx + ex) / 2 + perpX * length * curve;
  const my = (sy + ey) / 2 + perpY * length * curve;

  const endWidth = Math.max(MIN_WIDTH, width * (0.55 + rng() * 0.12));

  const childSegs: Seg[] = [];

  if (depth < MAX_DEPTH && endWidth >= MIN_WIDTH * 1.4) {
    const r = rng();
    const numKids = r < 0.62 ? 2 : r < 0.85 ? 3 : 1;

    if (numKids === 1) {
      const childAngle = a + (rng() - 0.5) * 0.5;
      const childLen = length * (0.55 + rng() * 0.15);
      const childW = endWidth * (0.85 + rng() * 0.1);
      branch(childSegs, rng, ex, ey, childAngle, childLen, childW, depth + 1);
    } else {
      const totalSpread = 0.55 + rng() * 0.55;
      for (let i = 0; i < numKids; i++) {
        const t = i / (numKids - 1) - 0.5;
        const childAngle = a + t * totalSpread + (rng() - 0.5) * 0.18;
        const childLen = length * (0.45 + rng() * 0.2);
        const childW = endWidth * (0.78 + rng() * 0.18);
        branch(childSegs, rng, ex, ey, childAngle, childLen, childW, depth + 1);
      }
    }
  }

  // Children first, parent last — parent overdraws the joint so width steps stay hidden
  segs.push(...childSegs);
  segs.push({
    ax: sx, ay: sy,
    mx, my,
    bx: ex, by: ey,
    wa: width, wb: endWidth,
    color: colorForWidth(width),
  });
}

function buildSegments(): Seg[] {
  const segs: Seg[] = [];
  const rng = mulberry32(11);

  const primaries = [
    { angle: Math.PI * 0.93, length: 95,  width: 10, xOff: -13 },
    { angle: Math.PI * 0.78, length: 110, width: 13, xOff: -8  },
    { angle: Math.PI * 0.62, length: 130, width: 15, xOff: -3  },
    { angle: Math.PI * 0.50, length: 145, width: 17, xOff:  0  },
    { angle: Math.PI * 0.35, length: 130, width: 15, xOff:  3  },
    { angle: Math.PI * 0.22, length: 110, width: 13, xOff:  8  },
    { angle: Math.PI * 0.07, length: 95,  width: 10, xOff: 13  },
  ];

  for (const p of primaries) {
    branch(segs, rng, TX + p.xOff, TRUNK_BASE_Y, p.angle, p.length, p.width, 0);
  }

  // Trunk drawn last so it covers every primary's joint at the base
  segs.push({
    ax: TX, ay: 0,
    mx: TX + 1, my: TRUNK_BASE_Y * 0.5,
    bx: TX, by: TRUNK_BASE_Y,
    wa: 28, wb: 34,
    color: COLOR_TRUNK,
  });

  return segs;
}

const SEGMENTS = buildSegments();

export default function FooterRoots() {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    fetch('/data/quotes.json')
      .then((res) => res.json())
      .then((data) => {
        setQuotes(data);
        setIsVisible(true);
      })
      .catch((err) => console.error("Failed to fetch quotes:", err));
  }, []);

  useEffect(() => {
    if (quotes.length <= 1) return;

    const interval = setInterval(() => {
      // Fade out
      setIsVisible(false);
      
      // Wait for fade-out to finish before changing text and fading back in
      setTimeout(() => {
        setCurrentIndex((prev) => (prev + 1) % quotes.length);
        setIsVisible(true);
      }, 600); // matches CSS duration slightly plus a buffer
      
    }, 9000); // 9 seconds per quote cycle

    return () => clearInterval(interval);
  }, [quotes.length]);

  // Fallback state while loading
  const currentQuote = quotes[currentIndex] || { text: "...", author: "..." };

  return (
    <div className="flex flex-col items-center pt-8 pb-8 w-full overflow-hidden">
      
      {/* Container with a fixed min-height to prevent UI jumping during quote changes */}
      <div className="min-h-[100px] flex items-center justify-center mb-6 max-w-2xl mx-auto px-6">
        <p
          className={`font-black tracking-widest uppercase text-xs text-center transition-all duration-500 ease-in-out ${
            isVisible ? 'opacity-100 translate-y-0 text-white/80' : 'opacity-0 translate-y-2 text-white/0'
          }`}
          style={{ fontFamily: "'Space Mono', monospace" }}
        >
          "{currentQuote.text}"
          <span className="block mt-2 text-white/40">— {currentQuote.author}</span>
        </p>
      </div>

      <div className="w-full" style={{ maxWidth: 640 }}>
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="xMidYMin meet"
          width="100%"
          className="block"
          aria-hidden="true"
        >
          {SEGMENTS.map((seg, i) => (
            <path key={i} d={taperedPath(seg)} fill={seg.color} />
          ))}
        </svg>
      </div>
    </div>
  );
}