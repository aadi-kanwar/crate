"use client";

import { CircleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { similarItems } from "@convex/lib/purchases";
import { rupeesToPaise } from "@convex/lib/purchases";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { todayIn } from "@/lib/format";
import { cn } from "@/lib/utils";

type Existing = { id: string; name: string; aliases: readonly string[]; hint?: string; archived?: boolean };

/**
 * While a new item's name is typed: items already in the list with a similar
 * name or other name, so duplicates aren't made by accident. With `onUse`,
 * each one can be picked instead.
 */
export function SimilarItems({
  name,
  items,
  onUse,
}: {
  name: string;
  items: readonly Existing[];
  onUse?: (id: string) => void;
}) {
  const matches = useMemo(() => similarItems(name, items), [name, items]);
  if (matches.length === 0) return null;
  return (
    <div role="status" className="flex flex-col gap-2 rounded-md border border-warning-border bg-warning-subtle px-3 py-2 text-sm">
      <p className="flex items-center gap-2 font-medium text-warning">
        <Icon icon={CircleAlert} className="size-4" />
        Already in the list?
      </p>
      <ul className="flex flex-col gap-1">
        {matches.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-3">
            <span className="min-w-0 text-foreground">
              <span className="font-medium">{m.name}</span>
              <span className="text-foreground-secondary">
                {m.hint ? ` · ${m.hint}` : ""}
                {m.aliases.length > 0 ? ` · also “${m.aliases.slice(0, 2).join("”, “")}”` : ""}
                {m.archived ? " · archived" : ""}
              </span>
            </span>
            {onUse && !m.archived ? (
              <button
                type="button"
                onClick={() => onUse(m.id)}
                className="min-h-9 shrink-0 rounded-full border border-border-strong bg-surface px-3 text-xs font-medium hover:bg-subtle"
              >
                Use this
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export type EarlierPrice = { unitPricePaise: number; shopId?: string; date?: string };

/**
 * Optional "earlier price" for a new item: the price per unit paid before
 * Crate, with when and where if known. Folded away until asked for.
 */
export function useEarlierPrice(
  unitName: string,
  shops: readonly { shopId: string; name: string }[],
  initial?: EarlierPrice | null,
) {
  const [open, setOpen] = useState(initial != null);
  const [priceText, setPriceText] = useState(initial ? String(initial.unitPricePaise / 100) : "");
  const [date, setDate] = useState(initial?.date ?? "");
  const [shopId, setShopId] = useState(initial?.shopId ?? "");
  const paise = priceText.trim() ? rupeesToPaise(priceText) : undefined;
  /** undefined: none given; null: typed but not a valid amount. */
  const value: EarlierPrice | undefined | null =
    !open || paise === undefined ? undefined : paise === null || paise <= 0 ? null : { unitPricePaise: paise, shopId: shopId || undefined, date: date || undefined };

  const fields = (id: string) => (
    <div className="flex flex-col gap-3">
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
        <input type="checkbox" className="size-5 accent-primary" checked={open} onChange={(e) => setOpen(e.target.checked)} />
        I know an earlier price
      </label>
      {open ? (
        <div className={cn("flex flex-col gap-3 rounded-md border border-border bg-subtle/40 p-3")}>
          <Field id={`${id}-price`} label={`Price per ${unitName} (₹)`} hint="Used for estimates and the price check until it's bought through Crate.">
            {(p) => <Input {...p} inputMode="decimal" className="tabular" value={priceText} onChange={(e) => setPriceText(e.target.value)} />}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id={`${id}-date`} label="When (optional)">
              {(p) => <Input {...p} type="date" max={todayIn()} value={date} onChange={(e) => setDate(e.target.value)} />}
            </Field>
            <Field id={`${id}-shop`} label="Where (optional)">
              {(p) => (
                <NativeSelect {...p} value={shopId} onChange={(e) => setShopId(e.target.value)}>
                  <option value="">Not sure</option>
                  {shops.map((s) => (
                    <option key={s.shopId} value={s.shopId}>
                      {s.name}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
          </div>
        </div>
      ) : null}
    </div>
  );
  /** Starts again (when a dialog reopens), optionally with a saved price. */
  const reset = (next?: EarlierPrice | null) => {
    setOpen(next != null);
    setPriceText(next ? String(next.unitPricePaise / 100) : "");
    setDate(next?.date ?? "");
    setShopId(next?.shopId ?? "");
  };
  return { value, fields, reset };
}
