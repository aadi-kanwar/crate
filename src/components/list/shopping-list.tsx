"use client";

import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Check, Circle, CircleCheck, Plus, Store, Trash2, TriangleAlert, Undo2 } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { rupeesToPaise, tidyQuantity, type PriceCheck } from "@convex/lib/purchases";
import type { PackSize } from "@convex/lib/validators";
import { Chips, type Scope } from "@/components/entry/entry-form";
import { ItemPicker, type Catalog, type CatalogItem } from "@/components/entry/pickers";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { LoadingState } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/states";
import { SegmentedTabs } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toaster";
import { useQuery } from "@/lib/convex";
import { friendlyError } from "@/lib/errors";
import { formatPaise, formatQuantity, formatUnitPrice, parseDecimal } from "@/lib/format";
import { UNIT_LABEL } from "@/lib/labels";
import { cn } from "@/lib/utils";

type List = FunctionReturnType<typeof api.shoppingList.get>;
type Row = List["rows"][number];
type Mode = "list" | "buy";
type Sort = "category" | "shop";

/** Dialogs sit at the top of the screen so the phone keyboard doesn't cover them. */
const TOP_DIALOG = "top-4 max-h-[calc(100dvh-2rem)] translate-y-0";
const NO_SHOP = "No shop chosen";

/**
 * The live shopping list of one property (or Shared): List mode to plan,
 * Buy mode to tick off at the shop, and Save purchases to record them.
 */
export function ShoppingList({
  lists,
  initialScope,
}: {
  /** The lists this person can open: their properties, then Shared. */
  lists: { key: string; name: string; scope: Scope }[];
  initialScope: string;
}) {
  const [listKey, setListKey] = useState(initialScope);
  const [mode, setMode] = useState<Mode>("list");
  const [sortChoice, setSortChoice] = useState<Sort | null>(null);
  const sort: Sort = sortChoice ?? (mode === "buy" ? "shop" : "category");
  const chosen = lists.find((l) => l.key === listKey) ?? lists[0];
  const data = useQuery(api.shoppingList.get, { scope: chosen.scope });
  const catalog = useQuery(api.catalog.forEntry, {});
  const [shown, setShown] = useState(data);
  if (data !== undefined && data !== shown) setShown(data);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        {lists.length === 2 ? (
          // Staff: their current property (chosen at the top of the screen) or Shared.
          <SegmentedTabs<string>
            label="Which list"
            idPrefix="which-list"
            value={chosen.key}
            onChange={setListKey}
            items={lists.map((l) => ({ value: l.key, label: l.name }))}
          />
        ) : lists.length > 2 ? (
          <Field id="which-list" label="List for">
            {(p) => (
              <NativeSelect {...p} value={chosen.key} onChange={(e) => setListKey(e.target.value)}>
                {lists.map((l) => (
                  <option key={l.key} value={l.key}>
                    {l.name}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
        ) : null}
        <SegmentedTabs<Mode>
          label="Mode"
          idPrefix="list-mode"
          value={mode}
          onChange={setMode}
          items={[
            { value: "list", label: "List" },
            { value: "buy", label: "Buy" },
          ]}
        />
      </div>
      {shown === undefined || catalog === undefined ? (
        <LoadingState rows={5} />
      ) : (
        <div id="list-mode-panel" role="tabpanel" className={cn("flex flex-col gap-4 transition-opacity", data === undefined && "opacity-60")}>
          <Bills list={shown} mode={mode} />
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-foreground-secondary">Sort by</span>
            <SegmentedTabs<Sort>
              label="Sort by"
              idPrefix="list-sort"
              className="w-56"
              value={sort}
              onChange={setSortChoice}
              items={[
                { value: "category", label: "Category" },
                { value: "shop", label: "Shop" },
              ]}
            />
          </div>
          {mode === "list" ? (
            <ListMode list={shown} catalog={catalog} scope={chosen.scope} sort={sort} />
          ) : (
            <BuyMode list={shown} catalog={catalog} scope={chosen.scope} sort={sort} />
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Estimated bill per shop
// ---------------------------------------------------------------------------

function Bills({ list, mode }: { list: List; mode: Mode }) {
  if (list.rows.length === 0) return null;
  // Shops by name; "No shop chosen" last.
  const planned = list.bills
    .filter((b) => b.items > 0)
    .sort((a, b) => (a.shopName === null ? 1 : b.shopName === null ? -1 : a.shopName.localeCompare(b.shopName)));
  const bought = list.bills.filter((b) => b.boughtItems > 0);
  return (
    <Card>
      <div className="flex flex-col gap-2 px-4 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-medium">Estimated bill</h2>
          <span className="tabular text-lg font-semibold">{formatPaise(list.totals.estimatedPaise)}</span>
        </div>
        <ul className="flex flex-col gap-1 text-sm" aria-label="Estimated bill per shop">
          {planned.map((b) => (
            <li key={b.shopId ?? "none"} className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-foreground-secondary">
                {b.shopName ?? NO_SHOP} · {b.items} {b.items === 1 ? "item" : "items"}
                {b.unpriced > 0 ? ` (${b.unpriced} without a price)` : ""}
              </span>
              <span className="tabular shrink-0">{formatPaise(b.estimatedPaise)}</span>
            </li>
          ))}
        </ul>
        {list.totals.unpriced > 0 ? (
          <p className="text-xs text-foreground-muted">
            Items never bought before have no price to go on: add an expected price in List mode to include them.
          </p>
        ) : null}
        {mode === "buy" && bought.length > 0 ? (
          <div className="mt-1 flex flex-col gap-1 border-t border-border pt-2 text-sm">
            <div className="flex items-baseline justify-between gap-3 font-medium">
              <span>Bought so far</span>
              <span className="tabular">{formatPaise(list.totals.boughtPaise)}</span>
            </div>
            {bought.map((b) => (
              <div key={b.shopId ?? "none"} className="flex items-baseline justify-between gap-3 text-foreground-secondary">
                <span className="truncate">
                  {b.shopName} · {b.boughtItems} {b.boughtItems === 1 ? "item" : "items"}
                </span>
                <span className="tabular">{formatPaise(b.boughtPaise)}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

function groupRows(rows: Row[], sort: Sort, shopOf: (r: Row) => string | null = (r) => r.shopName) {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = sort === "category" ? row.categoryLabel || "No category" : (shopOf(row) ?? NO_SHOP);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const entries = [...groups.entries()];
  if (sort === "shop") entries.sort((a, b) => (a[0] === NO_SHOP ? 1 : b[0] === NO_SHOP ? -1 : a[0].localeCompare(b[0])));
  return entries;
}

function plannedText(row: Row) {
  const pack = row.packLabel && row.packCount !== null ? `${row.packCount} × ${row.packLabel} = ` : "";
  return `${pack}${formatQuantity(row.quantity, row.baseUnit)}`;
}

// ---------------------------------------------------------------------------
// List mode
// ---------------------------------------------------------------------------

function ListMode({ list, catalog, scope, sort }: { list: List; catalog: Catalog; scope: Scope; sort: Sort }) {
  const [picking, setPicking] = useState(false);
  const [adding, setAdding] = useState<CatalogItem | null>(null);
  const [editing, setEditing] = useState<Row | null>(null);
  const groups = groupRows(list.rows, sort);
  return (
    <>
      <Button className="min-h-14 text-base" onClick={() => setPicking(true)}>
        <Icon icon={Plus} />
        Add items
      </Button>
      <ItemPicker
        open={picking}
        onOpenChange={setPicking}
        catalog={catalog}
        onPick={(item) => {
          const already = list.rows.find((r) => r.itemId === item.itemId && r.variant === null);
          if (already) setEditing(already);
          else setAdding(item);
        }}
      />
      {list.rows.length === 0 ? (
        <EmptyState
          title="The list is empty"
          description="Add the items you need, with how much and from which shop. The list stays here for next time."
        />
      ) : (
        groups.map(([title, rows]) => (
          <section key={title} className="flex flex-col gap-2" aria-label={title}>
            <h3 className="flex items-baseline justify-between text-sm font-medium text-foreground-secondary">
              <span>{title}</span>
              {sort === "shop" ? (
                <span className="tabular">≈{formatPaise(rows.reduce((sum, r) => sum + (r.estimatePaise ?? 0), 0))}</span>
              ) : null}
            </h3>
            <Card>
              <ul className="divide-y divide-border">
                {rows.map((row) => (
                  <li key={row.rowId}>
                    <button type="button" onClick={() => setEditing(row)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-subtle">
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="font-medium">
                          {row.itemName}
                          {row.variant ? <span className="font-normal text-foreground-secondary"> · {row.variant}</span> : null}
                        </span>
                        <span className="tabular text-sm text-foreground-secondary">
                          {plannedText(row)}
                          {sort === "category" ? ` · ${row.shopName ?? NO_SHOP}` : ` · ${row.categoryLabel}`}
                        </span>
                      </div>
                      <span className="tabular shrink-0 text-right text-sm">
                        {row.estimatePaise !== null ? `≈${formatPaise(row.estimatePaise)}` : <span className="text-foreground-muted">No price</span>}
                        {row.estimateUnitPricePaise !== null ? (
                          <span className="block text-xs text-foreground-secondary">
                            {formatUnitPrice(row.estimateUnitPricePaise, row.baseUnit)}
                            {row.estimateSource === "typed" ? "" : row.estimateSource === "this_shop" ? " last time" : " elsewhere"}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        ))
      )}
      {adding ? (
        <PlanDialog
          key={`new-${adding.itemId}`}
          catalog={catalog}
          scope={scope}
          item={{ itemId: adding.itemId, name: adding.name, baseUnit: adding.baseUnit, packSizes: adding.packSizes, variants: adding.variants }}
          initial={{ shopId: adding.defaultShopId }}
          onClose={() => setAdding(null)}
        />
      ) : null}
      {editing ? (
        <PlanDialog
          key={editing.rowId}
          catalog={catalog}
          scope={scope}
          item={{ itemId: editing.itemId, name: editing.itemName, baseUnit: editing.baseUnit, packSizes: editing.packSizes, variants: editing.variants }}
          row={editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}

type ItemInfo = { itemId: Id<"items">; name: string; baseUnit: Row["baseUnit"]; packSizes: PackSize[]; variants: string[] };

/** How much (directly or in packs) and which variant: shared by planning and ticking off. */
function useAmount(item: ItemInfo, initial: { variant?: string | null; quantity?: number; packLabel?: string | null; packCount?: number | null }) {
  const variants = initial.variant && !item.variants.includes(initial.variant) ? [...item.variants, initial.variant] : item.variants;
  const [variant, setVariant] = useState(initial.variant ?? "");
  const [mode, setMode] = useState<"quantity" | "pack">(initial.packLabel ? "pack" : item.packSizes.length > 0 && initial.quantity === undefined ? "pack" : "quantity");
  const [packLabel, setPackLabel] = useState(initial.packLabel ?? item.packSizes[0]?.label ?? "");
  const [packCountText, setPackCountText] = useState(initial.packCount != null ? String(initial.packCount) : "");
  const [quantityText, setQuantityText] = useState(initial.quantity !== undefined && !initial.packLabel ? String(initial.quantity) : "");
  const pack = item.packSizes.find((p) => p.label === packLabel);
  const count = parseDecimal(packCountText);
  const direct = parseDecimal(quantityText);
  const quantity =
    mode === "pack" ? (pack && count !== null && count > 0 ? tidyQuantity(count * pack.quantity) : null) : direct !== null && direct > 0 ? tidyQuantity(direct) : null;
  const payload =
    mode === "pack"
      ? { variant: variant || undefined, packLabel, packCount: count ?? 0 }
      : { variant: variant || undefined, quantity: quantity ?? 0 };
  const fields = (id: string, autoFocus = false) => (
    <>
      {variants.length > 0 ? (
        <Chips label="Variant" options={["", ...variants]} value={variant} render={(v) => v || "Any"} onChange={setVariant} />
      ) : null}
      {item.packSizes.length > 0 ? (
        <Chips
          label="How"
          options={["quantity", ...item.packSizes.map((p) => `pack:${p.label}`)]}
          value={mode === "pack" ? `pack:${packLabel}` : "quantity"}
          render={(v) => (v === "quantity" ? `Loose (${UNIT_LABEL[item.baseUnit].many})` : v.slice(5))}
          onChange={(v) => {
            if (v === "quantity") setMode("quantity");
            else {
              setMode("pack");
              setPackLabel(v.slice(5));
            }
          }}
        />
      ) : null}
      {mode === "pack" ? (
        <Field id={`${id}-count`} label="How many packs">
          {(p) => (
            <Input {...p} autoFocus={autoFocus} inputMode="decimal" className="tabular text-lg" value={packCountText} onChange={(e) => setPackCountText(e.target.value)} />
          )}
        </Field>
      ) : (
        <Field id={`${id}-qty`} label={`Quantity (${UNIT_LABEL[item.baseUnit].many})`}>
          {(p) => (
            <Input {...p} autoFocus={autoFocus} inputMode="decimal" className="tabular text-lg" value={quantityText} onChange={(e) => setQuantityText(e.target.value)} />
          )}
        </Field>
      )}
    </>
  );
  return { quantity, payload, fields };
}

function ShopSelect({
  id,
  label,
  catalog,
  value,
  onChange,
  allowNone,
  extra,
}: {
  id: string;
  label: string;
  catalog: Catalog;
  value: string;
  onChange: (value: string) => void;
  allowNone: boolean;
  extra?: { shopId: string; name: string } | null;
}) {
  const shops = [...catalog.shops.map((s) => ({ shopId: s.shopId as string, name: s.name }))];
  if (extra && !shops.some((s) => s.shopId === extra.shopId)) shops.push(extra);
  return (
    <Field id={id} label={label}>
      {(p) => (
        <NativeSelect {...p} value={value} onChange={(e) => onChange(e.target.value)}>
          {allowNone ? <option value="">Not decided</option> : <option value="" disabled>Choose the shop</option>}
          {shops.map((s) => (
            <option key={s.shopId} value={s.shopId}>
              {s.name}
            </option>
          ))}
        </NativeSelect>
      )}
    </Field>
  );
}

/** Add an item to the list, or change / remove one. */
function PlanDialog({
  catalog,
  scope,
  item,
  row,
  initial,
  onClose,
}: {
  catalog: Catalog;
  scope: Scope;
  item: ItemInfo;
  row?: Row;
  initial?: { shopId: Id<"shops"> | null };
  onClose: () => void;
}) {
  const add = useMutation(api.shoppingList.add);
  const update = useMutation(api.shoppingList.update);
  const remove = useMutation(api.shoppingList.remove);
  const amount = useAmount(item, row ?? {});
  const [shopId, setShopId] = useState<string>(row?.shopId ?? initial?.shopId ?? "");
  const [priceText, setPriceText] = useState(row?.expectedUnitPricePaise != null ? String(row.expectedUnitPricePaise / 100) : "");
  const [busy, setBusy] = useState(false);
  const expected = priceText.trim() ? rupeesToPaise(priceText) : undefined;
  const save = async () => {
    if (amount.quantity === null) return toast.error("Enter how much is needed.");
    if (expected === null) return toast.error("Enter the expected price in rupees, or leave it empty.");
    setBusy(true);
    try {
      const common = { ...amount.payload, shopId: (shopId || undefined) as Id<"shops"> | undefined, expectedUnitPricePaise: expected };
      if (row) await update({ rowId: row.rowId, ...common });
      else await add({ scope, itemId: item.itemId, ...common });
      onClose();
    } catch (error) {
      toast.error(friendlyError(error));
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={row ? item.name : `Add ${item.name}`} description="How much is needed, and from which shop." className={TOP_DIALOG}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          {amount.fields("plan", !row)}
          <ShopSelect id="plan-shop" label="Buy from" catalog={catalog} value={shopId} onChange={setShopId} allowNone extra={row?.shopId ? { shopId: row.shopId, name: row.shopName ?? "" } : null} />
          <Field
            id="plan-price"
            label={`Expected price per ${UNIT_LABEL[item.baseUnit].one} (₹, optional)`}
            hint={row?.estimateSource && row.estimateSource !== "typed" ? `Leave empty to use the last price paid (${formatUnitPrice(row.estimateUnitPricePaise!, item.baseUnit)}).` : "Leave empty to use the last price paid."}
          >
            {(p) => <Input {...p} inputMode="decimal" className="tabular" value={priceText} onChange={(e) => setPriceText(e.target.value)} />}
          </Field>
          <DialogFooter>
            {row ? (
              <Button
                type="button"
                variant="ghost"
                onClick={async () => {
                  try {
                    await remove({ rowId: row.rowId });
                    onClose();
                  } catch (error) {
                    toast.error(friendlyError(error));
                  }
                }}
              >
                <Icon icon={Trash2} />
                Remove from list
              </Button>
            ) : (
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
            )}
            <Button type="submit" loading={busy}>
              {row ? "Save" : "Add to list"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Buy mode
// ---------------------------------------------------------------------------

function BuyMode({ list, catalog, scope, sort }: { list: List; catalog: Catalog; scope: Scope; sort: Sort }) {
  const [ticking, setTicking] = useState<Row | null>(null);
  const [moving, setMoving] = useState<Row | null>(null);
  const [saving, setSaving] = useState(false);
  const untick = useMutation(api.shoppingList.untick);
  const toBuy = list.rows.filter((r) => !r.bought);
  const bought = list.rows.filter((r) => r.bought);
  if (list.rows.length === 0)
    return <EmptyState title="Nothing to buy" description="Switch to List to add the items you need." />;
  return (
    <>
      <section className="flex flex-col gap-3" aria-labelledby="to-buy">
        <h2 id="to-buy" className="font-serif text-2xl tracking-tight">
          To buy <span className="tabular text-base text-foreground-secondary">({toBuy.length})</span>
        </h2>
        {toBuy.length === 0 ? (
          <p className="text-sm text-foreground-secondary">Everything is ticked off.</p>
        ) : (
          groupRows(toBuy, sort).map(([title, rows]) => (
            <div key={title} className="flex flex-col gap-2">
              <h3 className="text-sm font-medium text-foreground-secondary">{title}</h3>
              <Card>
                <ul className="divide-y divide-border">
                  {rows.map((row) => (
                    <li key={row.rowId} className="flex items-center gap-2 pr-2">
                      <button
                        type="button"
                        onClick={() => setTicking(row)}
                        className="flex min-h-16 min-w-0 flex-1 items-center gap-3 px-4 py-2 text-left hover:bg-subtle"
                        aria-label={`Tick off ${row.itemName}`}
                      >
                        <Icon icon={Circle} className="size-7 shrink-0 text-border-strong" />
                        <span className="flex min-w-0 flex-col">
                          <span className="font-medium">
                            {row.itemName}
                            {row.variant ? <span className="font-normal text-foreground-secondary"> · {row.variant}</span> : null}
                          </span>
                          <span className="tabular text-sm text-foreground-secondary">
                            {plannedText(row)}
                            {sort === "category" ? ` · ${row.shopName ?? NO_SHOP}` : ""}
                            {row.estimatePaise !== null ? ` · ≈${formatPaise(row.estimatePaise)}` : ""}
                          </span>
                        </span>
                      </button>
                      <Button variant="ghost" size="icon" aria-label={`Change shop for ${row.itemName}`} onClick={() => setMoving(row)}>
                        <Icon icon={Store} />
                      </Button>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          ))
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="bought">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="bought" className="font-serif text-2xl tracking-tight">
            Bought <span className="tabular text-base text-foreground-secondary">({bought.length})</span>
          </h2>
          {bought.length > 0 ? <span className="tabular font-semibold">{formatPaise(list.totals.boughtPaise)}</span> : null}
        </div>
        {bought.length === 0 ? (
          <p className="text-sm text-foreground-secondary">Tick items off above as you collect them. They gather here until you save them.</p>
        ) : (
          <>
            {groupRows(bought, "shop", (r) => r.bought!.shopName).map(([title, rows]) => (
              <div key={title} className="flex flex-col gap-2">
                <h3 className="flex items-baseline justify-between text-sm font-medium text-foreground-secondary">
                  <span>{title}</span>
                  <span className="tabular">{formatPaise(rows.reduce((sum, r) => sum + r.bought!.totalPaise, 0))}</span>
                </h3>
                <Card>
                  <ul className="divide-y divide-border">
                    {rows.map((row) => (
                      <li key={row.rowId} className="flex items-center gap-2 pr-2">
                        <button
                          type="button"
                          onClick={() => setTicking(row)}
                          className="flex min-h-16 min-w-0 flex-1 items-center gap-3 px-4 py-2 text-left hover:bg-subtle"
                          aria-label={`Change what was bought: ${row.itemName}`}
                        >
                          <Icon icon={CircleCheck} className="size-7 shrink-0 text-primary" />
                          <span className="flex min-w-0 flex-col">
                            <span className="font-medium">
                              {row.itemName}
                              {row.bought!.variant ? <span className="font-normal text-foreground-secondary"> · {row.bought!.variant}</span> : null}
                            </span>
                            <span className="tabular text-sm text-foreground-secondary">
                              {formatQuantity(row.bought!.quantity, row.baseUnit)} · {formatPaise(row.bought!.totalPaise)} ·{" "}
                              {formatUnitPrice(row.bought!.unitPricePaise, row.baseUnit)}
                              {row.bought!.quantity !== row.quantity ? ` (planned ${formatQuantity(row.quantity, row.baseUnit)})` : ""}
                            </span>
                          </span>
                        </button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Untick ${row.itemName}`}
                          onClick={async () => {
                            try {
                              await untick({ rowId: row.rowId });
                            } catch (error) {
                              toast.error(friendlyError(error));
                            }
                          }}
                        >
                          <Icon icon={Undo2} />
                        </Button>
                      </li>
                    ))}
                  </ul>
                </Card>
              </div>
            ))}
            <Button className="min-h-14 text-base" onClick={() => setSaving(true)}>
              <Icon icon={Check} />
              Save purchases
            </Button>
            <p className="text-xs text-foreground-secondary">
              Saving records the bought items as entries (one per shop) and clears the ticks. The items stay on the list for next time.
            </p>
          </>
        )}
      </section>

      {ticking ? <TickDialog key={ticking.rowId} row={ticking} catalog={catalog} onClose={() => setTicking(null)} /> : null}
      {moving ? <MoveDialog key={moving.rowId} row={moving} catalog={catalog} onClose={() => setMoving(null)} /> : null}
      {saving ? <SaveDialog list={list} scope={scope} onClose={() => setSaving(false)} /> : null}
    </>
  );
}

/** Tick an item off (or change what was bought): quantity, variant, shop and the amount paid. */
function TickDialog({ row, catalog, onClose }: { row: Row; catalog: Catalog; onClose: () => void }) {
  const tick = useMutation(api.shoppingList.tick);
  const item: ItemInfo = { itemId: row.itemId, name: row.itemName, baseUnit: row.baseUnit, packSizes: row.packSizes, variants: row.variants };
  const start = row.bought ?? row;
  const amount = useAmount(item, start);
  const [shopId, setShopId] = useState<string>(row.bought?.shopId ?? row.shopId ?? "");
  // The price is asked per unit (per kg, per litre…); the total is worked out from the quantity.
  const [priceText, setPriceText] = useState(row.bought ? String(row.bought.unitPricePaise / 100) : "");
  const [busy, setBusy] = useState(false);
  const pricePaise = rupeesToPaise(priceText);
  const totalPaise = amount.quantity !== null && pricePaise ? Math.round(pricePaise * amount.quantity) : null;
  const unitName = UNIT_LABEL[row.baseUnit].one;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={row.itemName}
        description={`Planned: ${plannedText(row)}${row.shopName ? ` from ${row.shopName}` : ""}. Change anything that was bought differently.`}
        className={TOP_DIALOG}
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (amount.quantity === null) return toast.error("Enter how much was bought.");
            if (!pricePaise) return toast.error(`Enter the price per ${unitName}.`);
            if (!totalPaise) return toast.error("The total comes to zero. Check the quantity and price.");
            if (!shopId) return toast.error("Choose the shop.");
            setBusy(true);
            try {
              await tick({ rowId: row.rowId, ...amount.payload, shopId: shopId as Id<"shops">, totalPaise });
              onClose();
            } catch (error) {
              toast.error(friendlyError(error));
              setBusy(false);
            }
          }}
        >
          {amount.fields("tick")}
          <Field id="tick-price" label={`Price per ${unitName} (₹)`}>
            {(p) => (
              <Input
                {...p}
                autoFocus
                inputMode="decimal"
                className="tabular text-lg"
                placeholder={row.estimateUnitPricePaise !== null ? `about ${(row.estimateUnitPricePaise / 100).toFixed(0)}` : undefined}
                value={priceText}
                onChange={(e) => setPriceText(e.target.value)}
              />
            )}
          </Field>
          <p className="tabular text-sm text-foreground-secondary" aria-live="polite">
            {amount.quantity !== null ? formatQuantity(amount.quantity, row.baseUnit) : "—"}
            {pricePaise ? ` × ${formatUnitPrice(pricePaise, row.baseUnit)}` : ""}
            {totalPaise ? (
              <>
                {" = "}
                <span className="font-semibold text-foreground">{formatPaise(totalPaise)}</span>
              </>
            ) : null}
          </p>
          <ShopSelect id="tick-shop" label="Bought at" catalog={catalog} value={shopId} onChange={setShopId} allowNone={false} extra={row.bought ? { shopId: row.bought.shopId, name: row.bought.shopName } : null} />
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button type="submit" loading={busy} className="min-h-12">
              <Icon icon={Check} />
              {row.bought ? "Save" : "Tick off"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Buy mode: buy an item from a different shop than planned. */
function MoveDialog({ row, catalog, onClose }: { row: Row; catalog: Catalog; onClose: () => void }) {
  const update = useMutation(api.shoppingList.update);
  const [shopId, setShopId] = useState<string>(row.shopId ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={`Buy ${row.itemName} from…`} description="Moves it to another shop on this list." className={TOP_DIALOG}>
        <ShopSelect id="move-shop" label="Shop" catalog={catalog} value={shopId} onChange={setShopId} allowNone extra={row.shopId ? { shopId: row.shopId, name: row.shopName ?? "" } : null} />
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await update({
                  rowId: row.rowId,
                  variant: row.variant ?? undefined,
                  ...(row.packLabel ? { packLabel: row.packLabel, packCount: row.packCount ?? 0 } : { quantity: row.quantity }),
                  shopId: (shopId || undefined) as Id<"shops"> | undefined,
                  expectedUnitPricePaise: row.expectedUnitPricePaise ?? undefined,
                });
                onClose();
              } catch (error) {
                toast.error(friendlyError(error));
                setBusy(false);
              }
            }}
          >
            Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Review the Bought list (per shop, with the price check) and save it as entries. */
function SaveDialog({ list, scope, onClose }: { list: List; scope: Scope; onClose: () => void }) {
  const save = useMutation(api.shoppingList.savePurchases);
  const bought = useMemo(() => list.rows.filter((r) => r.bought), [list.rows]);
  const checks = useQuery(api.entries.checkPrices, {
    lines: bought.map((r) => ({ itemId: r.itemId, variant: r.bought!.variant ?? undefined, unitPricePaise: r.bought!.unitPricePaise })),
  });
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const flagged = bought.map((r, i) => ({ row: r, check: checks?.[i] as PriceCheck | undefined })).filter((x) => x.check && x.check.status !== "ok");
  const shops = groupRows(bought, "shop", (r) => r.bought!.shopName);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title="Save purchases"
        description={`${shops.length} ${shops.length === 1 ? "entry" : "entries"} will be recorded (one per shop) for ${formatPaise(list.totals.boughtPaise)} in all.`}
        className={TOP_DIALOG}
      >
        <ul className="flex flex-col gap-1 text-sm">
          {shops.map(([shop, rows]) => (
            <li key={shop} className="flex items-baseline justify-between gap-3">
              <span>
                {shop} · {rows.length} {rows.length === 1 ? "item" : "items"}
              </span>
              <span className="tabular font-medium">{formatPaise(rows.reduce((sum, r) => sum + r.bought!.totalPaise, 0))}</span>
            </li>
          ))}
        </ul>
        {flagged.length > 0 ? (
          <Banner tone="warning" title="Did you mean…?">
            <ul className="flex flex-col gap-1">
              {flagged.map(({ row, check }) => (
                <li key={row.rowId}>
                  <Icon icon={TriangleAlert} className="mr-1 inline size-4" />
                  {row.itemName}: {formatUnitPrice(row.bought!.unitPricePaise, row.baseUnit)} is much {check!.status === "high" ? "higher" : "lower"} than usual (about{" "}
                  {formatUnitPrice((check as { medianPaise: number }).medianPaise, row.baseUnit)}).
                </li>
              ))}
            </ul>
            <label className="mt-2 flex min-h-11 cursor-pointer items-center gap-3 font-medium">
              <input type="checkbox" className="size-5 accent-primary" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              Yes, these prices are right
            </label>
          </Banner>
        ) : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Back</Button>
          </DialogClose>
          <Button
            loading={busy}
            disabled={checks === undefined || (flagged.length > 0 && !confirmed)}
            onClick={async () => {
              setBusy(true);
              try {
                const saved = await save({ scope, pricesConfirmed: flagged.length > 0 });
                toast.success(`Saved ${saved.length} ${saved.length === 1 ? "entry" : "entries"}.`);
                onClose();
              } catch (error) {
                toast.error(friendlyError(error));
                setBusy(false);
              }
            }}
          >
            <Icon icon={Check} />
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
