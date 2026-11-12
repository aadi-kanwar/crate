"use client";

import { useState } from "react";
import type { Id } from "@convex/_generated/dataModel";
import { usePropertyScope } from "@/components/app/property-scope";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { todayIn } from "@/lib/format";

/**
 * "All (organisation)", one property, or "Shared". Properties follow the
 * picker at the top of the screen (and change it); Shared is chosen here.
 */
export function useHistoryScope() {
  const header = usePropertyScope();
  const [shared, setShared] = useState(false);
  const value = shared ? "shared" : (header.current?.propertyId ?? "all");
  const choose = (next: string) => {
    if (next === "shared") setShared(true);
    else {
      setShared(false);
      header.choose(next === "all" ? null : (next as Id<"properties">));
    }
  };
  const name =
    value === "shared" ? "Shared" : value === "all" ? "All properties" : (header.properties.find((p) => p.propertyId === value)?.name ?? "");
  return { value, choose, name, properties: header.properties };
}

export function ScopeSelect({ scope, className }: { scope: ReturnType<typeof useHistoryScope>; className?: string }) {
  return (
    <Field id="scope" label="For" className={className}>
      {(p) => (
        <NativeSelect {...p} value={scope.value} onChange={(e) => scope.choose(e.target.value)}>
          <option value="all">All (organisation)</option>
          {scope.properties.map((pr) => (
            <option key={pr.propertyId} value={pr.propertyId}>
              {pr.name}
            </option>
          ))}
          <option value="shared">Shared</option>
        </NativeSelect>
      )}
    </Field>
  );
}

function shiftDays(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function shiftMonths(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

export type RangePreset = "this_month" | "last_30" | "last_3m" | "last_6m" | "last_12m" | "custom";

export const PRESET_LABEL: Record<RangePreset, string> = {
  this_month: "This month",
  last_30: "Last 30 days",
  last_3m: "Last 3 months",
  last_6m: "Last 6 months",
  last_12m: "Last 12 months",
  custom: "Choose dates",
};

function presetRange(preset: Exclude<RangePreset, "custom">) {
  const today = todayIn();
  switch (preset) {
    case "this_month":
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case "last_30":
      return { from: shiftDays(today, -29), to: today };
    case "last_3m":
      return { from: shiftMonths(today, -2), to: today };
    case "last_6m":
      return { from: shiftMonths(today, -5), to: today };
    case "last_12m":
      return { from: shiftMonths(today, -11), to: today };
  }
}

/** A date range from presets, or two dates. */
export function useDateRange(initial: Exclude<RangePreset, "custom">) {
  const [preset, setPreset] = useState<RangePreset>(initial);
  const [custom, setCustom] = useState(() => presetRange(initial));
  const range = preset === "custom" ? custom : presetRange(preset);
  return {
    preset,
    range,
    setPreset: (next: RangePreset) => {
      if (next === "custom") setCustom(range);
      setPreset(next);
    },
    setCustom,
  };
}

export function DateRangeSelect({
  dates,
  presets,
}: {
  dates: ReturnType<typeof useDateRange>;
  presets: RangePreset[];
}) {
  return (
    <>
      <Field id="range" label="When">
        {(p) => (
          <NativeSelect {...p} value={dates.preset} onChange={(e) => dates.setPreset(e.target.value as RangePreset)}>
            {presets.map((preset) => (
              <option key={preset} value={preset}>
                {PRESET_LABEL[preset]}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>
      {dates.preset === "custom" ? (
        <div className="flex gap-2">
          <Field id="from" label="From">
            {(p) => (
              <Input {...p} type="date" value={dates.range.from} max={dates.range.to} onChange={(e) => e.target.value && dates.setCustom({ ...dates.range, from: e.target.value })} />
            )}
          </Field>
          <Field id="to" label="To">
            {(p) => (
              <Input {...p} type="date" value={dates.range.to} min={dates.range.from} onChange={(e) => e.target.value && dates.setCustom({ ...dates.range, to: e.target.value })} />
            )}
          </Field>
        </div>
      ) : null}
    </>
  );
}
