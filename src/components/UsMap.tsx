"use client";

import { useMemo } from "react";
import { geoAlbersUsa, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { FeatureCollection, Geometry } from "geojson";
import statesTopo from "us-atlas/states-10m.json";
import { FIPS_TO_ABBR } from "@/lib/states";

export interface MapPoint {
  lat: number;
  lon: number;
  customers?: number;
}

interface UsMapProps {
  base: MapPoint[];
  points: MapPoint[];
  byState: { state: string; customers: number }[];
  accent: string;
}

const WIDTH = 960;
const HEIGHT = 600;

// topojson -> GeoJSON feature collection (states), computed once.
const STATES = feature(
  statesTopo as unknown as Parameters<typeof feature>[0],
  (statesTopo as unknown as { objects: { states: Geometry } }).objects.states,
) as unknown as FeatureCollection<Geometry, { name: string }> & {
  features: (FeatureCollection<Geometry>["features"][number] & { id: string })[];
};

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

export default function UsMap({ base, points, byState, accent }: UsMapProps) {
  const projection = useMemo(
    () => geoAlbersUsa().fitSize([WIDTH, HEIGHT], STATES),
    [],
  );
  const path = useMemo(() => geoPath(projection), [projection]);

  const project = (p: MapPoint): [number, number] | null =>
    projection([p.lon, p.lat]) as [number, number] | null;

  const stateCustomers = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of byState) m.set(s.state, s.customers);
    return m;
  }, [byState]);

  const maxStateCustomers = useMemo(
    () => Math.max(1, ...byState.map((s) => s.customers)),
    [byState],
  );

  const basePts = useMemo(
    () => base.map(project).filter(Boolean) as [number, number][],
    [base, projection],
  );

  const maxPoint = useMemo(
    () => Math.max(1, ...points.map((p) => p.customers ?? 0)),
    [points],
  );

  const [ar, ag, ab] = hexToRgb(accent);

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="h-auto w-full"
      role="img"
      aria-label="US map of affected pharmacies"
    >
      {/* choropleth */}
      {STATES.features.map((f) => {
        const abbr = FIPS_TO_ABBR[String(f.id)];
        const c = abbr ? stateCustomers.get(abbr) ?? 0 : 0;
        const t = c > 0 ? 0.12 + 0.78 * (c / maxStateCustomers) : 0;
        const fill =
          t > 0
            ? `rgba(${ar}, ${ag}, ${ab}, ${t.toFixed(3)})`
            : "#eef2f6";
        return (
          <path
            key={String(f.id)}
            d={path(f) ?? undefined}
            fill={fill}
            stroke="#ffffff"
            strokeWidth={0.7}
          />
        );
      })}

      {/* faint base network */}
      {basePts.map(([x, y], i) => (
        <circle key={`b${i}`} cx={x} cy={y} r={0.7} fill="#94a3b8" opacity={0.35} />
      ))}

      {/* affected pharmacies, sized by reach */}
      {points.map((p, i) => {
        const xy = project(p);
        if (!xy) return null;
        const r = 1.8 + 5.5 * Math.sqrt((p.customers ?? 1) / maxPoint);
        return (
          <g key={`p${i}`}>
            <circle cx={xy[0]} cy={xy[1]} r={r} fill={accent} opacity={0.75} />
            <circle
              cx={xy[0]}
              cy={xy[1]}
              r={r}
              fill="none"
              stroke={accent}
              strokeOpacity={0.35}
            />
          </g>
        );
      })}
    </svg>
  );
}
