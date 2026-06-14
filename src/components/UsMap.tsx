"use client";

import { useMemo, useRef, useState } from "react";
import { geoAlbersUsa, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { FeatureCollection, Geometry } from "geojson";
import type { GeometryCollection, Topology } from "topojson-specification";
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
const topo = statesTopo as unknown as Topology;
const STATES = feature(
  topo,
  topo.objects.states as GeometryCollection,
) as FeatureCollection<Geometry, { name: string }>;

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

interface Hover {
  name: string;
  abbr: string;
  customers: number;
  share: number; // 0..1 of total cohort
  x: number; // px within container
  y: number;
}

export default function UsMap({ base, points, byState, accent }: UsMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);

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

  const totalCustomers = useMemo(
    () => byState.reduce((sum, s) => sum + s.customers, 0),
    [byState],
  );

  const maxStateCustomers = useMemo(
    () => Math.max(1, ...byState.map((s) => s.customers)),
    [byState],
  );

  const handleStateHover = (
    e: React.MouseEvent,
    name: string,
    abbr: string,
    customers: number,
  ) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHover({
      name,
      abbr,
      customers,
      share: totalCustomers > 0 ? customers / totalCustomers : 0,
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  const basePts = useMemo(
    () => base.map(project).filter(Boolean) as [number, number][],
    [base, projection],
  );

  const maxPoint = useMemo(
    () => Math.max(1, ...points.map((p) => p.customers ?? 0)),
    [points],
  );

  // Highest-impact pharmacies emit a radiating "alert broadcast" pulse.
  const topPoints = useMemo(
    () =>
      points
        .map((p, i) => ({ p, i }))
        .sort((a, b) => (b.p.customers ?? 0) - (a.p.customers ?? 0))
        .slice(0, 12),
    [points],
  );

  const [ar, ag, ab] = hexToRgb(accent);

  return (
    <div ref={containerRef} className="relative">
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
          const isHovered = hover?.abbr === abbr && !!abbr;
          return (
            <path
              key={String(f.id)}
              d={path(f) ?? undefined}
              fill={fill}
              stroke={isHovered ? accent : "#ffffff"}
              strokeWidth={isHovered ? 1.6 : 0.7}
              className="cursor-pointer transition-[stroke,stroke-width] duration-100"
              onMouseMove={(e) =>
                handleStateHover(e, f.properties?.name ?? "", abbr ?? "", c)
              }
              onMouseLeave={() => setHover(null)}
            />
          );
        })}

        {/* faint base network */}
        {basePts.map(([x, y], i) => (
          <circle key={`b${i}`} cx={x} cy={y} r={0.7} fill="#94a3b8" opacity={0.35} />
        ))}

        {/* radiating alert pulses from the highest-impact pharmacies */}
        {topPoints.map(({ p, i }, k) => {
          const xy = project(p);
          if (!xy) return null;
          const r = 1.8 + 5.5 * Math.sqrt((p.customers ?? 1) / maxPoint);
          const begin = `${(k % 6) * 0.4}s`;
          return (
            <circle
              key={`ring${i}`}
              cx={xy[0]}
              cy={xy[1]}
              r={r}
              fill="none"
              stroke={accent}
              strokeWidth={1.2}
              opacity={0}
            >
              <animate
                attributeName="r"
                values={`${r};${r + 18}`}
                dur="2.4s"
                begin={begin}
                repeatCount="indefinite"
              />
              <animate
                attributeName="opacity"
                values="0.55;0"
                dur="2.4s"
                begin={begin}
                repeatCount="indefinite"
              />
            </circle>
          );
        })}

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
              <title>
                {`Affected pharmacy · ~${(p.customers ?? 0).toLocaleString(
                  "en-US",
                )} patients reached`}
              </title>
            </g>
          );
        })}
      </svg>

      {/* hover tooltip */}
      {hover && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-xl border border-slate-200 bg-white/95 px-3 py-2 shadow-lg backdrop-blur-sm"
          style={{ left: hover.x, top: hover.y - 10 }}
        >
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-bold text-slate-900">
              {hover.name}
            </span>
            <span className="font-mono text-[10px] text-slate-400">
              {hover.abbr}
            </span>
          </div>
          {hover.customers > 0 ? (
            <div className="mt-0.5 whitespace-nowrap text-[11px] text-slate-600">
              <span
                className="font-semibold tabular-nums"
                style={{ color: accent }}
              >
                {hover.customers.toLocaleString("en-US")}
              </span>{" "}
              patients reached
              <span className="text-slate-400">
                {" "}
                · {(hover.share * 100).toFixed(0)}% of cohort
              </span>
            </div>
          ) : (
            <div className="mt-0.5 whitespace-nowrap text-[11px] text-slate-400">
              Not in this recall&apos;s cohort
            </div>
          )}
        </div>
      )}
    </div>
  );
}
