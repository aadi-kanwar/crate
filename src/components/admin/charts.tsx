"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Two small single-series charts drawn in SVG with the app's tokens: one
 * teal accent, hairline grid, hover/focus tooltips. Every value is also in a
 * table on the page, so the tooltip never hides anything.
 */

const HEIGHT = 220;
const PAD = { top: 12, right: 12, bottom: 28, left: 52 };

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.floor(entry.contentRect.width))));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

/** Round, readable tick values from 0 up to at least `max`. */
export function niceTicks(max: number, count = 4, wholeNumbers = false): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = wholeNumbers ? Math.max(1, max / count) : max / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const steps = wholeNumbers ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10];
  const step = steps.map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.0001; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  if (ticks[ticks.length - 1] < max) ticks.push(Math.round((ticks[ticks.length - 1] + step) * 1e6) / 1e6);
  return ticks;
}

const compact = new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 });
const full = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
const tickText = (v: number, top: number) => (top >= 10_000 ? compact.format(v) : full.format(v));

type Tip = { x: number; y: number; lines: [string, string] } | null;

function Tooltip({ tip }: { tip: Tip }) {
  if (!tip) return null;
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-surface px-3 py-2 text-xs shadow-lg"
      style={{ left: tip.x, top: tip.y - 8 }}
    >
      <p className="tabular text-sm font-semibold text-foreground">{tip.lines[0]}</p>
      <p className="whitespace-nowrap text-foreground-secondary">{tip.lines[1]}</p>
    </div>
  );
}

function YAxis({ ticks, y, width, top }: { ticks: number[]; y: (v: number) => number; width: number; top: number }) {
  return (
    <g aria-hidden>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} />
          <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="tabular fill-foreground-secondary text-[11px]">
            {tickText(t, top)}
          </text>
        </g>
      ))}
    </g>
  );
}

/** Bars rounded at the top (4px), square at the baseline. */
function barPath(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, w / 2, h);
  if (h <= 0) return "";
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

/** Columns: one per period. `label` under some columns; `tip` on hover/focus. */
export function BarChart({
  data,
  label,
  ariaLabel,
  wholeNumbers = false,
}: {
  data: { key: string; value: number; axisLabel: string; tip: [string, string] }[];
  label: (value: number) => string;
  ariaLabel: string;
  /** Counts of whole things (cylinders, pieces): no 0.5 ticks. */
  wholeNumbers?: boolean;
}) {
  const { ref, width } = useWidth();
  const [tip, setTip] = useState<Tip>(null);
  const [active, setActive] = useState<string | null>(null);
  const max = Math.max(0, ...data.map((d) => d.value));
  const ticks = niceTicks(max, 4, wholeNumbers);
  const top = ticks[ticks.length - 1];
  const innerW = width - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const y = (v: number) => PAD.top + innerH - (v / top) * innerH;
  const band = innerW / Math.max(1, data.length);
  const barW = Math.max(2, Math.min(24, band - 2));
  const every = Math.ceil(data.length / Math.max(1, Math.floor(innerW / 64)));
  return (
    <div ref={ref} className="relative w-full" onPointerLeave={() => { setTip(null); setActive(null); }}>
      <svg width={width} height={HEIGHT} role="img" aria-label={ariaLabel} className="block overflow-visible">
        <YAxis ticks={ticks} y={y} width={width} top={top} />
        {data.map((d, i) => {
          const cx = PAD.left + band * i + band / 2;
          const h = y(0) - y(d.value);
          const show = () => {
            setActive(d.key);
            setTip({ x: cx, y: y(d.value), lines: d.tip });
          };
          return (
            <g key={d.key}>
              <path d={barPath(cx - barW / 2, y(d.value), barW, h)} className={cn("fill-primary transition-opacity", active && active !== d.key && "opacity-50")} />
              {/* Hit area: the whole band, taller than the bar. */}
              <rect
                x={PAD.left + band * i}
                y={PAD.top}
                width={band}
                height={innerH}
                fill="transparent"
                tabIndex={0}
                aria-label={`${d.tip[1]}: ${label(d.value)}`}
                onPointerEnter={show}
                onFocus={show}
                onBlur={() => { setTip(null); setActive(null); }}
                className="outline-none"
              />
              {i % every === 0 ? (
                <text x={cx} y={HEIGHT - 8} textAnchor="middle" className="fill-foreground-secondary text-[11px]">
                  {d.axisLabel}
                </text>
              ) : null}
            </g>
          );
        })}
        <line x1={PAD.left} x2={width - PAD.right} y1={y(0)} y2={y(0)} className="stroke-border-strong" strokeWidth={1} />
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

/** Price over time: dots joined by a 2px line; the nearest point to the pointer is highlighted. */
export function PriceChart({
  points,
  ariaLabel,
  xLabel,
}: {
  points: { key: string; time: number; value: number; tip: [string, string] }[];
  ariaLabel: string;
  xLabel: (time: number) => string;
}) {
  const { ref, width } = useWidth();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const max = Math.max(0, ...points.map((p) => p.value));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const innerW = width - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const t0 = points[0]?.time ?? 0;
  const t1 = points[points.length - 1]?.time ?? 1;
  const span = Math.max(1, t1 - t0);
  const x = (t: number) => (points.length === 1 ? PAD.left + innerW / 2 : PAD.left + ((t - t0) / span) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / top) * innerH;
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.time)},${y(p.value)}`).join(" ");
  const active = activeIndex !== null ? points[activeIndex] : null;
  const xTicks = points.length <= 1 ? points.map((p) => p.time) : [t0, t0 + span / 2, t1];

  const nearest = (clientX: number, rect: DOMRect) => {
    const px = clientX - rect.left;
    let best = 0;
    for (let i = 1; i < points.length; i += 1) if (Math.abs(x(points[i].time) - px) < Math.abs(x(points[best].time) - px)) best = i;
    return best;
  };

  return (
    <div ref={ref} className="relative w-full">
      <svg
        width={width}
        height={HEIGHT}
        role="img"
        aria-label={ariaLabel}
        tabIndex={0}
        className="block overflow-visible outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onPointerMove={(e) => points.length && setActiveIndex(nearest(e.clientX, e.currentTarget.getBoundingClientRect()))}
        onPointerLeave={() => setActiveIndex(null)}
        onFocus={() => points.length && setActiveIndex(points.length - 1)}
        onBlur={() => setActiveIndex(null)}
        onKeyDown={(e) => {
          if (activeIndex === null) return;
          if (e.key === "ArrowLeft") setActiveIndex(Math.max(0, activeIndex - 1));
          if (e.key === "ArrowRight") setActiveIndex(Math.min(points.length - 1, activeIndex + 1));
        }}
      >
        <YAxis ticks={ticks} y={y} width={width} top={top} />
        {active ? <line x1={x(active.time)} x2={x(active.time)} y1={PAD.top} y2={PAD.top + innerH} className="stroke-border-strong" strokeWidth={1} /> : null}
        <path d={path} fill="none" className="stroke-primary" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <circle
            key={p.key}
            cx={x(p.time)}
            cy={y(p.value)}
            r={activeIndex === i ? 6 : 4}
            className="fill-primary stroke-surface"
            strokeWidth={2}
          />
        ))}
        {xTicks.map((t, i) => (
          <text key={i} x={x(t)} y={HEIGHT - 8} textAnchor={i === 0 && xTicks.length > 1 ? "start" : i === xTicks.length - 1 && xTicks.length > 1 ? "end" : "middle"} className="fill-foreground-secondary text-[11px]">
            {xLabel(t)}
          </text>
        ))}
      </svg>
      <Tooltip tip={active ? { x: x(active.time), y: y(active.value), lines: active.tip } : null} />
    </div>
  );
}
