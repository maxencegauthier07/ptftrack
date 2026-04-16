"use client";

import { useMemo } from "react";

type Props = {
  data: number[];              // série de valeurs, la plus récente en dernier
  width?: number;
  height?: number;
  color?: string;               // couleur principale (ligne + fill gradient)
  strokeWidth?: number;
  fillOpacity?: number;
  showArea?: boolean;
  className?: string;
};

/**
 * Mini-graph SVG pur, zero-dep. Rendu instantané, pas de re-layout.
 * Si < 2 points, affiche juste une ligne plate dim.
 */
export default function Sparkline({
  data, width = 100, height = 32,
  color = "var(--accent)", strokeWidth = 1.5,
  fillOpacity = 0.15, showArea = true, className,
}: Props) {
  const { path, areaPath, empty } = useMemo(() => {
    if (!data || data.length < 2) {
      return { path: "", areaPath: "", empty: true };
    }
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const stepX = width / (data.length - 1);

    const points = data.map((v, i) => {
      const x = i * stepX;
      // y inversé (SVG : 0 en haut)
      const y = height - ((v - min) / range) * (height - 4) - 2;
      return [x, y];
    });

    const p = points.map(([x, y], i) => (i === 0 ? `M${x},${y}` : `L${x},${y}`)).join(" ");
    const a = `${p} L${width},${height} L0,${height} Z`;

    return { path: p, areaPath: a, empty: false };
  }, [data, width, height]);

  const gradientId = useMemo(() => `spark-${Math.random().toString(36).slice(2, 9)}`, []);

  if (empty) {
    return (
      <svg width={width} height={height} className={className}>
        <line x1="0" y1={height / 2} x2={width} y2={height / 2}
          stroke="var(--text-4)" strokeWidth="1" strokeDasharray="2 2" />
      </svg>
    );
  }

  return (
    <svg width={width} height={height} className={className} style={{ overflow: "visible" }}>
      {showArea && (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={fillOpacity} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={areaPath} fill={`url(#${gradientId})`} />
        </>
      )}
      <path d={path} fill="none" stroke={color} strokeWidth={strokeWidth}
        strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}