/** The relationship-type name that rides on top of an edge. */
export default function EdgeLabel({
  text,
  x,
  y,
  angle,
  isActive,
  dim,
}: {
  text: string;
  x: number;
  y: number;
  angle: number;
  isActive: boolean;
  dim: boolean;
}) {
  return (
    <g transform={`translate(${x},${y}) rotate(${angle})`} pointerEvents="none">
      <text
        textAnchor="middle"
        dy={-5}
        fontFamily="'Space Mono', monospace"
        fontSize={9}
        letterSpacing="0.06em"
        fill={isActive ? "var(--color-ink)" : "var(--color-ink-muted)"}
        fillOpacity={dim ? 0.2 : isActive ? 1 : 0.85}
        stroke="var(--color-surface)"
        strokeWidth={4}
        strokeOpacity={0.9}
        paintOrder="stroke fill"
      >
        {text}
      </text>
    </g>
  );
}
