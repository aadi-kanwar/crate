"use client";

import { useMutation } from "convex/react";
import { formatInTimeZone } from "date-fns-tz";
import { ArrowLeft, Check, Plus, TriangleAlert, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { choiceOptions, rupeesToPaise, unitPricePaise, tidyQuantity, type PriceCheck } from "@convex/lib/purchases";
import { TIMEZONE } from "@convex/lib/time";
import type { BaseUnit, PackSize } from "@convex/lib/validators";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { LoadingState } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toaster";
import { useQuery } from "@/lib/convex";
import { friendlyError, parseAppError } from "@/lib/errors";
import { formatPaise, formatQuantity, formatUnitPrice, parseDecimal } from "@/lib/format";
import { UNIT_LABEL } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { ItemPicker, ShopPicker, type Catalog, type CatalogItem } from "./pickers";
import { SplitEditor, splitDraftFrom, splitDraftProblem, splitParts, type SplitDraft } from "./split-editor";

type LineItem = Pick<CatalogItem, "itemId" | "name" | "baseUnit" | "packSizes" | "variants" | "brands">;

type DraftLine = {
  key: string;
  item: LineItem;
  variant: string;
  brand: string;
  /** Shared entries: how this line is divided between properties. */
  split: SplitDraft;
  mode: "quantity" | "pack";
  quantityText: string;
  packLabel: string;
  packCountText: string;
  totalText: string;
};

export type Scope = { kind: "property"; propertyId: Id<"properties"> } | { kind: "shared" };

export type EntryInitial = {
  entryId: Id<"entries">;
  scope: Scope;
  shopId: Id<"shops">;
  shopName: string;
  note: string | null;
  loggedAt: number;
  lines: {
    itemId: Id<"items">;
    itemName: string;
    baseUnit: BaseUnit;
    variant: string | null;
    brand: string | null;
    quantity: number;
    packLabel: string | null;
    packCount: number | null;
    split: { propertyId: Id<"properties">; quantity: number }[];
    totalPaise: number;
  }[];
};

let keyCounter = 0;
const newKey = () => `line-${(keyCounter += 1)}`;

/** What a draft line adds up to, or what's missing. */
function computeLine(line: DraftLine) {
  let quantity: number | null = null;
  if (line.mode === "pack") {
    const pack = line.item.packSizes.find((p) => p.label === line.packLabel);
    const count = parseDecimal(line.packCountText);
    if (pack && count !== null && count > 0) quantity = tidyQuantity(count * pack.quantity);
  } else {
    const q = parseDecimal(line.quantityText);
    if (q !== null && q > 0) quantity = tidyQuantity(q);
  }
  const totalPaise = rupeesToPaise(line.totalText);
  const valid = quantity !== null && totalPaise !== null && totalPaise > 0;
  return {
    quantity,
    totalPaise,
    unitPricePaise: valid ? unitPricePaise(totalPaise!, quantity!) : null,
    valid,
  };
}

function lineFromItem(item: LineItem): DraftLine {
  return {
    key: newKey(),
    item,
    variant: "",
    brand: "",
    split: splitDraftFrom(null),
    mode: item.packSizes.length > 0 ? "pack" : "quantity",
    quantityText: "",
    packLabel: item.packSizes[0]?.label ?? "",
    packCountText: "",
    totalText: "",
  };
}

function initialLines(initial: EntryInitial | undefined, catalog: Catalog): DraftLine[] {
  if (!initial) return [];
  return initial.lines.map((l) => {
    const known = catalog.items.find((i) => i.itemId === l.itemId);
    const packSizes: PackSize[] = known?.packSizes ?? [];
    const withOldPack =
      l.packLabel && l.packCount && !packSizes.some((p) => p.label === l.packLabel)
        ? [...packSizes, { label: l.packLabel, quantity: l.quantity / l.packCount }]
        : packSizes;
    const variants = known?.variants ?? [];
    const brands = known?.brands ?? [];
    return {
      key: newKey(),
      item: {
        itemId: l.itemId,
        name: known?.name ?? l.itemName,
        baseUnit: known?.baseUnit ?? l.baseUnit,
        packSizes: withOldPack,
        variants: l.variant && !variants.includes(l.variant) ? [...variants, l.variant] : variants,
        brands: l.brand && !brands.includes(l.brand) ? [...brands, l.brand] : brands,
      },
      variant: l.variant ?? "",
      brand: l.brand ?? "",
      split: splitDraftFrom(l.split),
      mode: l.packLabel ? "pack" : "quantity",
      quantityText: l.packLabel ? "" : String(l.quantity),
      packLabel: l.packLabel ?? withOldPack[0]?.label ?? "",
      packCountText: l.packCount !== null ? String(l.packCount) : "",
      totalText: String(l.totalPaise / 100),
    };
  });
}

/** "2026-11-10T14:05" (India time) for a date-time input. */
const toLocalInput = (ms: number) => formatInTimeZone(new Date(ms), TIMEZONE, "yyyy-MM-dd'T'HH:mm");
const fromLocalInput = (value: string) => Date.parse(`${value}:00+05:30`);

/**
 * New entry, or editing one. Phone-first: big targets, number keypads,
 * Enter on "Total paid" goes straight to the next item.
 */
export function EntryForm({
  properties,
  defaultPropertyId,
  initial,
  allowDate = false,
  onDone,
  onCancel,
}: {
  properties: { propertyId: Id<"properties">; name: string }[];
  defaultPropertyId: Id<"properties"> | null;
  initial?: EntryInitial;
  /** Admins can change the entry's date and time. */
  allowDate?: boolean;
  onDone: (entryId: Id<"entries">) => void;
  onCancel?: () => void;
}) {
  const catalog = useQuery(api.catalog.forEntry, {});
  if (catalog === undefined) return <LoadingState rows={4} />;
  return (
    <LoadedForm
      catalog={catalog}
      properties={properties}
      defaultPropertyId={defaultPropertyId}
      initial={initial}
      allowDate={allowDate}
      onDone={onDone}
      onCancel={onCancel}
    />
  );
}

function LoadedForm({
  catalog,
  properties,
  defaultPropertyId,
  initial,
  allowDate,
  onDone,
  onCancel,
}: {
  catalog: Catalog;
  properties: { propertyId: Id<"properties">; name: string }[];
  defaultPropertyId: Id<"properties"> | null;
  initial?: EntryInitial;
  allowDate: boolean;
  onDone: (entryId: Id<"entries">) => void;
  onCancel?: () => void;
}) {
  const create = useMutation(api.entries.create);
  const update = useMutation(api.entries.update);
  const [shared, setShared] = useState(initial?.scope.kind === "shared");
  // Every property, for splitting a Shared entry between them.
  const splitTargets = useQuery(api.entries.splitTargets, {});
  const [propertyId, setPropertyId] = useState<Id<"properties"> | null>(
    initial?.scope.kind === "property" ? initial.scope.propertyId : defaultPropertyId,
  );
  const [shopId, setShopId] = useState<Id<"shops"> | null>(initial?.shopId ?? null);
  const [lines, setLines] = useState<DraftLine[]>(() => initialLines(initial, catalog));
  const [note, setNote] = useState(initial?.note ?? "");
  const [when, setWhen] = useState(initial ? toLocalInput(initial.loggedAt) : "");
  const [picking, setPicking] = useState(false);
  const [step, setStep] = useState<"edit" | "review">("edit");
  const [showErrors, setShowErrors] = useState(false);
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const firstInputs = useRef(new Map<string, HTMLInputElement>());
  // The line just added: its first box gets the keyboard once it's on screen.
  const pendingFocus = useRef<string | null>(null);

  useEffect(() => {
    if (pendingFocus.current === null) return;
    firstInputs.current.get(pendingFocus.current)?.focus();
    pendingFocus.current = null;
  }, [lines]);

  const computed = useMemo(() => lines.map(computeLine), [lines]);
  const total = computed.reduce((sum, c) => sum + (c.totalPaise ?? 0), 0);
  const problems: string[] = [];
  if (!shared && propertyId === null) problems.push("Choose the property.");
  if (shopId === null) problems.push("Choose the shop.");
  if (lines.length === 0) problems.push("Add at least one item.");
  if (computed.some((c) => !c.valid)) problems.push("Fill in the quantity and amount paid for every item.");
  if (shared)
    lines.forEach((line, i) => {
      const problem = splitDraftProblem(line.split, computed[i].quantity);
      if (problem) problems.push(`${line.item.name}: ${problem}`);
    });

  const setLine = (key: string, change: Partial<DraftLine>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...change } : l)));

  const scope: Scope = shared ? { kind: "shared" } : { kind: "property", propertyId: propertyId! };
  const payloadLines = lines.map((line, i) => ({
    itemId: line.item.itemId,
    variant: line.variant || undefined,
    brand: line.brand || undefined,
    // Only Shared entries are split.
    split: shared && line.split.on ? splitParts(line.split) : undefined,
    ...(line.mode === "pack"
      ? { packLabel: line.packLabel, packCount: parseDecimal(line.packCountText) ?? 0 }
      : { quantity: computed[i].quantity ?? 0 }),
    totalPaise: computed[i].totalPaise ?? 0,
  }));

  const save = async (pricesConfirmed: boolean) => {
    setBusy(true);
    try {
      const base = { scope, shopId: shopId!, note: note.trim() || undefined, lines: payloadLines, pricesConfirmed };
      if (initial) {
        const loggedAt = allowDate && when && toLocalInput(initial.loggedAt) !== when ? fromLocalInput(when) : undefined;
        await update({ ...base, entryId: initial.entryId, loggedAt });
        toast.success("Changes saved.");
        onDone(initial.entryId);
      } else {
        const entryId = await create(base);
        toast.success("Entry saved.");
        onDone(entryId);
      }
    } catch (error) {
      if (parseAppError(error)?.code === "PRICE_CHECK_NEEDED") setStep("review");
      toast.error(friendlyError(error));
      setBusy(false);
    }
  };

  if (step === "review")
    return (
      <Review
        lines={lines}
        computed={computed}
        entryId={initial?.entryId}
        total={total}
        scopeName={shared ? "Shared (whole organisation)" : (properties.find((p) => p.propertyId === propertyId)?.name ?? "")}
        shopName={catalog.shops.find((s) => s.shopId === shopId)?.name ?? (initial?.shopId === shopId ? initial?.shopName : "") ?? ""}
        confirmed={confirmed}
        setConfirmed={setConfirmed}
        busy={busy}
        onBack={() => setStep("edit")}
        onSave={save}
      />
    );

  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="for" className="flex flex-col gap-2">
        <h2 id="for" className="text-sm font-medium">
          Bought for
        </h2>
        {properties.length > 1 && !shared ? (
          <NativeSelect
            aria-label="Property"
            value={propertyId ?? ""}
            onChange={(e) => setPropertyId(e.target.value as Id<"properties">)}
          >
            {properties.map((p) => (
              <option key={p.propertyId} value={p.propertyId}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
        ) : !shared ? (
          <p className="flex min-h-11 items-center rounded-md border border-border bg-subtle px-3 font-medium">
            {properties.find((p) => p.propertyId === propertyId)?.name ?? "—"}
          </p>
        ) : null}
        <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border px-3 has-checked:border-primary has-checked:bg-primary-subtle">
          <input
            type="checkbox"
            className="size-5 shrink-0 accent-primary"
            checked={shared}
            onChange={(e) => setShared(e.target.checked)}
          />
          <span className="flex flex-col py-1">
            <span className="font-medium">Shared</span>
            <span className="text-sm text-foreground-secondary">Bought for the whole organisation, not one property</span>
          </span>
        </label>
      </section>

      <section aria-labelledby="shop" className="flex flex-col gap-2">
        <h2 id="shop" className="text-sm font-medium">
          Shop
        </h2>
        <ShopPicker
          catalog={catalog}
          shopId={shopId}
          extraShop={initial ? { shopId: initial.shopId, name: initial.shopName } : null}
          onChange={setShopId}
        />
      </section>

      {allowDate && initial ? (
        <Field id="entry-when" label="Date and time (India)" hint="Only admins can change this. It's recorded in the audit log.">
          {(p) => <Input {...p} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />}
        </Field>
      ) : null}

      <section aria-labelledby="items" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 id="items" className="text-sm font-medium">
            Items {lines.length > 0 ? <span className="tabular text-foreground-secondary">({lines.length})</span> : null}
          </h2>
          {lines.length > 0 ? <span className="tabular text-sm font-medium">{formatPaise(total)}</span> : null}
        </div>
        {lines.map((line, i) => (
          <LineCard
            key={line.key}
            index={i}
            line={line}
            computed={computed[i]}
            showErrors={showErrors}
            splitProperties={shared ? (splitTargets ?? []) : null}
            onChange={(change) => setLine(line.key, change)}
            onRemove={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
            onNext={() => setPicking(true)}
            firstInputRef={(el) => {
              if (el) firstInputs.current.set(line.key, el);
              else firstInputs.current.delete(line.key);
            }}
          />
        ))}
        <Button variant="secondary" className="min-h-14 text-base" onClick={() => setPicking(true)}>
          <Icon icon={Plus} />
          Add item
        </Button>
        <ItemPicker
          open={picking}
          onOpenChange={setPicking}
          catalog={catalog}
          onPick={(item) => {
            const line = lineFromItem(item);
            pendingFocus.current = line.key;
            setLines((prev) => [...prev, line]);
          }}
        />
      </section>

      <Field id="entry-note" label="Note (optional)">
        {(p) => <Input {...p} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />}
      </Field>

      {showErrors && problems.length > 0 ? (
        <Banner tone="danger" title="Not ready yet">
          <ul className="list-disc pl-4">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Banner>
      ) : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button
          className="min-h-14 text-base"
          onClick={() => {
            setShowErrors(true);
            if (problems.length === 0) {
              setConfirmed(new Set());
              setStep("review");
            }
          }}
        >
          Review {lines.length > 0 ? `· ${formatPaise(total)}` : ""}
        </Button>
      </div>
    </div>
  );
}

function LineCard({
  index,
  line,
  computed,
  showErrors,
  onChange,
  onRemove,
  onNext,
  firstInputRef,
  splitProperties,
}: {
  /** For a Shared entry: every property, so the line can be split. Null otherwise. */
  splitProperties: readonly { propertyId: Id<"properties">; name: string }[] | null;
  index: number;
  line: DraftLine;
  computed: ReturnType<typeof computeLine>;
  showErrors: boolean;
  onChange: (change: Partial<DraftLine>) => void;
  onRemove: () => void;
  onNext: () => void;
  firstInputRef: (el: HTMLInputElement | null) => void;
}) {
  const unit = line.item.baseUnit;
  const id = `line-${line.key}`;
  const hasPacks = line.item.packSizes.length > 0;
  const qtyMissing = showErrors && computed.quantity === null;
  const totalMissing = showErrors && !(computed.totalPaise && computed.totalPaise > 0);
  return (
    <Card>
      <CardBody className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col">
            <span className="font-medium">
              <span className="tabular text-foreground-secondary">{index + 1}. </span>
              {line.item.name}
            </span>
            <span className="text-xs text-foreground-secondary">per {UNIT_LABEL[unit].one}</span>
          </div>
          <Button variant="ghost" size="icon" aria-label={`Remove ${line.item.name}`} onClick={onRemove}>
            <Icon icon={X} />
          </Button>
        </div>

        {/* Variants and brands always offer None and Loose (not for gas cylinders). */}
        {unit !== "cylinder" || line.item.variants.length > 0 ? (
          <Chips
            label="Variant"
            options={choiceOptions(line.item.variants)}
            value={line.variant}
            render={(v) => v || "None"}
            onChange={(variant) => onChange({ variant })}
            title="Variant"
          />
        ) : null}
        {unit !== "cylinder" || line.item.brands.length > 0 ? (
          <Chips
            label="Brand"
            options={choiceOptions(line.item.brands)}
            value={line.brand}
            render={(v) => v || "None"}
            onChange={(brand) => onChange({ brand })}
            title="Brand"
          />
        ) : null}

        {hasPacks ? (
          <Chips
            label="How it was bought"
            options={["quantity", ...line.item.packSizes.map((p) => `pack:${p.label}`)]}
            value={line.mode === "pack" ? `pack:${line.packLabel}` : "quantity"}
            render={(v) => (v === "quantity" ? `Loose (${UNIT_LABEL[unit].many})` : v.slice(5))}
            onChange={(v) =>
              onChange(v === "quantity" ? { mode: "quantity" } : { mode: "pack", packLabel: v.slice(5) })
            }
          />
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          {line.mode === "pack" ? (
            <Field id={`${id}-count`} label="How many" error={qtyMissing ? "Enter a number" : undefined}>
              {(p) => (
                <Input
                  {...p}
                  ref={firstInputRef}
                  inputMode="decimal"
                  enterKeyHint="next"
                  className="tabular text-lg"
                  value={line.packCountText}
                  onChange={(e) => onChange({ packCountText: e.target.value })}
                />
              )}
            </Field>
          ) : (
            <Field id={`${id}-qty`} label={`Quantity (${UNIT_LABEL[unit].many})`} error={qtyMissing ? "Enter a number" : undefined}>
              {(p) => (
                <Input
                  {...p}
                  ref={firstInputRef}
                  inputMode="decimal"
                  enterKeyHint="next"
                  className="tabular text-lg"
                  value={line.quantityText}
                  onChange={(e) => onChange({ quantityText: e.target.value })}
                />
              )}
            </Field>
          )}
          <Field id={`${id}-total`} label="Total paid (₹)" error={totalMissing ? "Enter the amount" : undefined}>
            {(p) => (
              <Input
                {...p}
                inputMode="decimal"
                enterKeyHint="next"
                className="tabular text-lg"
                value={line.totalText}
                onChange={(e) => onChange({ totalText: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onNext();
                  }
                }}
              />
            )}
          </Field>
        </div>
        {splitProperties ? (
          <SplitEditor
            id={`${id}-split`}
            draft={line.split}
            onChange={(split) => onChange({ split })}
            properties={splitProperties}
            quantity={computed.quantity}
            unit={unit}
          />
        ) : null}
        <p className="tabular text-sm text-foreground-secondary" aria-live="polite">
          {computed.quantity !== null ? formatQuantity(computed.quantity, unit) : "—"}
          {computed.unitPricePaise !== null ? (
            <>
              {" · "}
              <span className="font-medium text-foreground">{formatUnitPrice(computed.unitPricePaise, unit)}</span>
            </>
          ) : null}
        </p>
      </CardBody>
    </Card>
  );
}

export function Chips<V extends string>({
  label,
  options,
  value,
  render,
  onChange,
  title,
}: {
  label: string;
  options: readonly V[];
  value: V;
  render: (value: V) => string;
  onChange: (value: V) => void;
  /** A small heading shown before the chips. */
  title?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap items-center gap-2">
      {title ? <span className="w-full text-xs font-medium text-foreground-secondary">{title}</span> : null}
      {options.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          onClick={() => onChange(option)}
          className={cn(
            "min-h-10 rounded-full border px-4 text-sm font-medium",
            value === option
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border-strong bg-surface text-foreground hover:bg-subtle",
          )}
        >
          {render(option)}
        </button>
      ))}
    </div>
  );
}

function Review({
  lines,
  computed,
  entryId,
  total,
  scopeName,
  shopName,
  confirmed,
  setConfirmed,
  busy,
  onBack,
  onSave,
}: {
  lines: DraftLine[];
  computed: ReturnType<typeof computeLine>[];
  entryId?: Id<"entries">;
  total: number;
  scopeName: string;
  shopName: string;
  confirmed: Set<string>;
  setConfirmed: (next: Set<string>) => void;
  busy: boolean;
  onBack: () => void;
  onSave: (pricesConfirmed: boolean) => void;
}) {
  const checks = useQuery(api.entries.checkPrices, {
    entryId,
    lines: lines.map((l, i) => ({
      itemId: l.item.itemId,
      variant: l.variant || undefined,
      unitPricePaise: computed[i].unitPricePaise ?? 0,
    })),
  });
  const flagged = (checks ?? []).map((c, i) => ({ check: c, key: lines[i]?.key })).filter((x) => x.check.status !== "ok");
  const allConfirmed = flagged.every((x) => confirmed.has(x.key));
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-serif text-2xl tracking-tight">Check and save</h2>
        <p className="text-sm text-foreground-secondary">
          {shopName} · {scopeName}
        </p>
      </div>
      {flagged.length > 0 ? (
        <Banner tone="warning" title="Did you mean…?">
          Some prices are very different from the usual. Check each one below, then confirm or go back and fix it.
        </Banner>
      ) : null}
      <Card>
        <ul className="divide-y divide-border" aria-label="Items">
          {lines.map((line, i) => {
            const c = computed[i];
            const check: PriceCheck | undefined = checks?.[i];
            const unit = line.item.baseUnit;
            return (
              <li key={line.key} className="flex flex-col gap-2 px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0">
                    <span className="font-medium">{line.item.name}</span>
                    {[line.variant, line.brand].filter(Boolean).length > 0 ? (
                      <span className="text-foreground-secondary"> · {[line.variant, line.brand].filter(Boolean).join(" · ")}</span>
                    ) : null}
                  </span>
                  <span className="tabular font-medium">{formatPaise(c.totalPaise ?? 0)}</span>
                </div>
                <span className="tabular text-sm text-foreground-secondary">
                  {line.mode === "pack" ? `${line.packCountText} × ${line.packLabel} = ` : ""}
                  {formatQuantity(c.quantity ?? 0, unit)} · {formatUnitPrice(c.unitPricePaise ?? 0, unit)}
                </span>
                {check && check.status !== "ok" ? (
                  <div className="flex flex-col gap-2 rounded-md border border-warning-border bg-warning-subtle p-3 text-sm text-warning">
                    <p className="flex items-start gap-2">
                      <Icon icon={TriangleAlert} className="mt-0.5 size-4" />
                      <span>
                        {formatUnitPrice(c.unitPricePaise ?? 0, unit)} is {check.status === "high" ? "much higher" : "much lower"} than
                        usual (about {formatUnitPrice(check.medianPaise, unit)}). Did you mean a different quantity or amount?
                      </span>
                    </p>
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 font-medium">
                      <input
                        type="checkbox"
                        className="size-5 accent-primary"
                        checked={confirmed.has(line.key)}
                        onChange={(e) => {
                          const next = new Set(confirmed);
                          if (e.target.checked) next.add(line.key);
                          else next.delete(line.key);
                          setConfirmed(next);
                        }}
                      />
                      Yes, this price is right
                    </label>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
        <div className="flex items-baseline justify-between border-t border-border px-4 py-3 font-semibold">
          <span>Total</span>
          <span className="tabular">{formatPaise(total)}</span>
        </div>
      </Card>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onBack}>
          <Icon icon={ArrowLeft} />
          Back to fix
        </Button>
        <Button
          className="min-h-14 text-base"
          loading={busy}
          disabled={checks === undefined || !allConfirmed}
          onClick={() => onSave(flagged.length > 0)}
        >
          <Icon icon={Check} />
          Save entry
        </Button>
      </div>
    </div>
  );
}
