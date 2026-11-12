"use client";

import { cn } from "@/lib/utils";

/**
 * Segmented tabs (MealSync's "Current / Moved out" control as a component).
 * The panel is rendered by the caller; give it id `${idPrefix}-panel`.
 */
export function SegmentedTabs<V extends string>({
  label,
  items,
  value,
  onChange,
  className,
  idPrefix = "tabs",
}: {
  label: string;
  items: readonly { value: V; label: string; count?: number }[];
  value: V;
  onChange: (value: V) => void;
  className?: string;
  idPrefix?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn("flex gap-1 overflow-x-auto rounded-md bg-muted p-1", className)}
    >
      {items.map((item) => (
        <button
          key={item.value}
          role="tab"
          type="button"
          aria-selected={value === item.value}
          aria-controls={`${idPrefix}-panel`}
          onClick={() => onChange(item.value)}
          className={cn(
            "min-h-11 flex-1 shrink-0 rounded-sm px-3 text-sm font-medium whitespace-nowrap transition-colors",
            value === item.value
              ? "bg-surface text-foreground shadow-sm"
              : "text-foreground-secondary hover:text-foreground",
          )}
        >
          {item.label}
          {item.count !== undefined ? <span className="tabular"> ({item.count})</span> : null}
        </button>
      ))}
    </div>
  );
}
