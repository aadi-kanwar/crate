"use client";

import type { Id } from "@convex/_generated/dataModel";
import { splitProblem, tidyQuantity } from "@convex/lib/purchases";
import type { BaseUnit } from "@convex/lib/validators";
import { Input } from "@/components/ui/input";
import { formatQuantity, parseDecimal } from "@/lib/format";
import { cn } from "@/lib/utils";

export type SplitPart = { propertyId: Id<"properties">; quantity: number };
type Property = { propertyId: Id<"properties">; name: string };

/** What's typed in a split: on/off and the text per property. */
export type SplitDraft = { on: boolean; texts: Record<string, string> };

export function splitDraftFrom(parts: readonly SplitPart[] | null | undefined): SplitDraft {
  return { on: (parts?.length ?? 0) > 0, texts: Object.fromEntries((parts ?? []).map((p) => [p.propertyId, String(p.quantity)])) };
}

/** The split to save (empty when not split). */
export function splitParts(draft: SplitDraft): SplitPart[] {
  if (!draft.on) return [];
  return Object.entries(draft.texts)
    .map(([propertyId, text]) => ({ propertyId: propertyId as Id<"properties">, quantity: parseDecimal(text) ?? 0 }))
    .filter((p) => p.quantity > 0);
}

/** Why the split can't be saved yet, or null. */
export function splitDraftProblem(draft: SplitDraft, quantity: number | null): string | null {
  if (!draft.on) return null;
  if (quantity === null) return "Enter the quantity first.";
  if (Object.values(draft.texts).some((t) => t.trim() && parseDecimal(t) === null)) return "Use numbers only in the split.";
  const parts = splitParts(draft);
  if (parts.length === 0) return "Enter how much goes to each property, or untick the split.";
  return splitProblem(parts, quantity);
}

export function SplitEditor({
  id,
  draft,
  onChange,
  properties,
  quantity,
  unit,
}: {
  id: string;
  draft: SplitDraft;
  onChange: (next: SplitDraft) => void;
  properties: readonly Property[];
  /** The line's quantity in the item's unit (null until typed). */
  quantity: number | null;
  unit: BaseUnit;
}) {
  const assigned = tidyQuantity(splitParts(draft).reduce((t, p) => t + p.quantity, 0));
  const left = quantity === null ? null : tidyQuantity(quantity - assigned);
  return (
    <div className="flex flex-col gap-2">
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
        <input
          type="checkbox"
          className="size-5 accent-primary"
          checked={draft.on}
          onChange={(e) => onChange({ ...draft, on: e.target.checked })}
        />
        Split between properties
      </label>
      {draft.on ? (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-subtle/40 p-3">
          {properties.map((p) => (
            <div key={p.propertyId} className="flex items-center gap-3">
              <label htmlFor={`${id}-${p.propertyId}`} className="min-w-0 flex-1 truncate text-sm">
                {p.name}
              </label>
              <Input
                id={`${id}-${p.propertyId}`}
                inputMode="decimal"
                className="tabular w-28"
                value={draft.texts[p.propertyId] ?? ""}
                onChange={(e) => onChange({ ...draft, texts: { ...draft.texts, [p.propertyId]: e.target.value } })}
              />
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span
              className={cn("tabular", left === 0 ? "text-success" : "text-warning")}
              aria-live="polite"
            >
              {quantity === null
                ? "Enter the quantity first"
                : left === 0
                  ? `Adds up to ${formatQuantity(quantity, unit)}`
                  : left! > 0
                    ? `${formatQuantity(left!, unit)} still to share out`
                    : `${formatQuantity(-left!, unit)} too much`}
            </span>
            {quantity !== null && properties.length > 0 ? (
              <button
                type="button"
                className="min-h-9 rounded-full border border-border-strong bg-surface px-3 text-xs font-medium hover:bg-subtle"
                onClick={() => {
                  // Equal parts; the last takes the rounding remainder so they add up.
                  const each = Math.floor((quantity / properties.length) * 1000) / 1000;
                  const next: Record<string, string> = {};
                  properties.forEach((p, i) => {
                    next[p.propertyId] = String(i === properties.length - 1 ? tidyQuantity(quantity - each * (properties.length - 1)) : each);
                  });
                  onChange({ ...draft, texts: next });
                }}
              >
                Split evenly
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** "North PG 6 kg · South PG 4 kg" for showing a saved split. */
export function splitText(
  split: readonly { propertyId: string; quantity: number; propertyName?: string }[],
  unit: BaseUnit,
  names?: ReadonlyMap<string, string>,
): string {
  return split
    .map((p) => `${p.propertyName ?? names?.get(p.propertyId) ?? ""} ${formatQuantity(p.quantity, unit)}`)
    .join(" · ");
}
