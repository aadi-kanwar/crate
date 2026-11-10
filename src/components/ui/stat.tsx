import { cn } from "@/lib/utils";

/** A labelled figure (MealSync's count tiles, larger). Render inside a <dl>. */
export function Stat({
  label,
  value,
  hint,
  emphasis = false,
  warn = false,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  emphasis?: boolean;
  warn?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-0.5 rounded-md border px-4 py-3",
        emphasis ? "border-primary-subtle-border bg-primary-subtle" : warn ? "border-warning-border bg-warning-subtle" : "border-border bg-surface",
        className,
      )}
    >
      <dt className={cn("truncate text-xs font-medium", warn ? "text-warning" : "text-foreground-secondary")}>{label}</dt>
      <dd className={cn("tabular text-2xl font-semibold", emphasis && "text-primary-text")}>{value}</dd>
      {hint ? <dd className="text-sm text-foreground-secondary">{hint}</dd> : null}
    </div>
  );
}

/** Label / value rows, for details and breakdowns. */
export function DetailList({ rows, className }: { rows: { label: React.ReactNode; value: React.ReactNode; strong?: boolean }[]; className?: string }) {
  return (
    <dl className={cn("flex flex-col divide-y divide-border", className)}>
      {rows.map((row, i) => (
        <div key={i} className={cn("flex items-baseline justify-between gap-4 py-2 text-sm", row.strong && "font-semibold")}>
          <dt className={row.strong ? "text-foreground" : "text-foreground-secondary"}>{row.label}</dt>
          <dd className="tabular text-right">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
