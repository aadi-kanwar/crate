"use client";

import { CircleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { similarItems } from "@convex/lib/purchases";
import { rupeesToPaise } from "@convex/lib/purchases";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { BaseUnit, PacketSize } from "@convex/lib/validators";
import { formatUnitPrice, parseDecimal, todayIn } from "@/lib/format";
import { PACKET_SIZE_UNIT_LABEL, UNIT_LABEL } from "@/lib/labels";
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

/** Packet units that make sense for an item counted in `baseUnit`, with how many base units one of them is. */
const PACKET_UNITS_FOR: Partial<Record<BaseUnit, { unit: PacketSize["unit"]; perBase: number }[]>> = {
  kg: [
    { unit: "g", perBase: 1000 },
    { unit: "kg", perBase: 1 },
  ],
  litre: [
    { unit: "ml", perBase: 1000 },
    { unit: "litre", perBase: 1 },
  ],
  piece: [{ unit: "piece", perBase: 1 }],
};

/** For items counted in packets: what one packet holds (e.g. 200 g). */
export function usePacketSize(initial?: PacketSize | null) {
  const [amountText, setAmountText] = useState(initial ? String(initial.amount) : "");
  const [unit, setUnit] = useState<PacketSize["unit"]>(initial?.unit ?? "g");
  const amount = parseDecimal(amountText);
  /** undefined: not given; null: typed but not a number above zero. */
  const value: PacketSize | undefined | null = !amountText.trim() ? undefined : amount === null || amount <= 0 ? null : { amount, unit };
  const reset = (next?: PacketSize | null) => {
    setAmountText(next ? String(next.amount) : "");
    setUnit(next?.unit ?? "g");
  };
  const fields = (id: string) => (
    <div className="grid grid-cols-2 gap-3">
      <Field id={`${id}-amount`} label="One packet holds" hint="e.g. 200 g, 1 litre, 10 pieces">
        {(p) => <Input {...p} inputMode="decimal" className="tabular" value={amountText} onChange={(e) => setAmountText(e.target.value)} />}
      </Field>
      <Field id={`${id}-unit`} label="Unit">
        {(p) => (
          <NativeSelect {...p} value={unit} onChange={(e) => setUnit(e.target.value as PacketSize["unit"])}>
            {(Object.keys(PACKET_SIZE_UNIT_LABEL) as PacketSize["unit"][]).map((u) => (
              <option key={u} value={u}>
                {PACKET_SIZE_UNIT_LABEL[u]}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>
    </div>
  );
  return { value, fields, reset };
}

/**
 * Optional "earlier price" for a new item: the price per unit paid before
 * Crate, with when and where if known. Folded away until asked for.
 */
export function useEarlierPrice(
  baseUnit: BaseUnit,
  shops: readonly { shopId: string; name: string }[],
  initial?: EarlierPrice | null,
) {
  const unitName = UNIT_LABEL[baseUnit].one;
  const packetUnits = PACKET_UNITS_FOR[baseUnit] ?? [];
  const [open, setOpen] = useState(initial != null);
  const [priceText, setPriceText] = useState(initial ? String(initial.unitPricePaise / 100) : "");
  const [date, setDate] = useState(initial?.date ?? "");
  const [shopId, setShopId] = useState(initial?.shopId ?? "");
  // Or: the price of a packet of some size (turned into a price per unit).
  const [byPacket, setByPacket] = useState(false);
  const [packetAmountText, setPacketAmountText] = useState("");
  const [packetUnit, setPacketUnit] = useState<string>("");
  const chosenPacketUnit = packetUnits.find((u) => u.unit === packetUnit) ?? packetUnits[0];
  const packetAmount = parseDecimal(packetAmountText);
  const typed = priceText.trim() ? rupeesToPaise(priceText) : undefined;
  const paise =
    byPacket && packetUnits.length > 0
      ? typed === undefined
        ? undefined
        : typed === null || !packetAmount || packetAmount <= 0
          ? null
          : Math.round((typed * chosenPacketUnit.perBase) / packetAmount)
      : typed;
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
          {packetUnits.length > 0 ? (
            <div role="radiogroup" aria-label="Price given" className="flex flex-wrap gap-2">
              {[false, true].map((mode) => (
                <button
                  key={String(mode)}
                  type="button"
                  role="radio"
                  aria-checked={byPacket === mode}
                  onClick={() => setByPacket(mode)}
                  className={cn(
                    "min-h-10 rounded-full border px-4 text-sm font-medium",
                    byPacket === mode ? "border-primary bg-primary text-primary-foreground" : "border-border-strong bg-surface hover:bg-subtle",
                  )}
                >
                  {mode ? "For a packet" : `Per ${unitName}`}
                </button>
              ))}
            </div>
          ) : null}
          {byPacket && packetUnits.length > 0 ? (
            <div className="grid grid-cols-3 gap-3">
              <Field id={`${id}-packet-amount`} label="Packet of">
                {(p) => <Input {...p} inputMode="decimal" className="tabular" value={packetAmountText} onChange={(e) => setPacketAmountText(e.target.value)} />}
              </Field>
              <Field id={`${id}-packet-unit`} label="Unit">
                {(p) => (
                  <NativeSelect {...p} value={chosenPacketUnit.unit} onChange={(e) => setPacketUnit(e.target.value)}>
                    {packetUnits.map((u) => (
                      <option key={u.unit} value={u.unit}>
                        {PACKET_SIZE_UNIT_LABEL[u.unit]}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
              <Field id={`${id}-price`} label="Packet price (₹)">
                {(p) => <Input {...p} inputMode="decimal" className="tabular" value={priceText} onChange={(e) => setPriceText(e.target.value)} />}
              </Field>
            </div>
          ) : (
            <Field id={`${id}-price`} label={`Price per ${unitName} (₹)`} hint="Used for estimates and the price check until it's bought through Crate.">
              {(p) => <Input {...p} inputMode="decimal" className="tabular" value={priceText} onChange={(e) => setPriceText(e.target.value)} />}
            </Field>
          )}
          {byPacket && typeof paise === "number" ? (
            <p className="tabular text-sm text-foreground-secondary">= {formatUnitPrice(paise, baseUnit)}</p>
          ) : null}
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
    setByPacket(false);
    setPacketAmountText("");
  };
  return { value, fields, reset };
}
