"use client";

import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Plus, Store, CircleHelp } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { matchesSearch } from "@convex/lib/purchases";
import { BASE_UNITS, SHOP_TYPES, type BaseUnit, type ShopType } from "@convex/lib/validators";
import { CategorySelect } from "@/components/app/category-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { SearchInput } from "@/components/ui/filter-bar";
import { StatusBadge } from "@/components/ui/status-badge";
import { toast } from "@/components/ui/toaster";
import { friendlyError } from "@/lib/errors";
import { SHOP_TYPE_LABEL, UNIT_LABEL } from "@/lib/labels";

export type Catalog = FunctionReturnType<typeof api.catalog.forEntry>;
export type CatalogItem = Catalog["items"][number];
export type CatalogShop = Catalog["shops"][number];

const MAX_RESULTS = 60;
/** Dialogs used while entering sit at the top of the screen, so the phone keyboard doesn't cover them. */
const TOP_DIALOG = "top-4 max-h-[calc(100dvh-2rem)] translate-y-0";

const resultClass =
  "flex min-h-14 w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left hover:bg-subtle active:bg-muted";

function Unverified() {
  return (
    <StatusBadge tone="warning" icon={CircleHelp}>
      New
    </StatusBadge>
  );
}

/** Search items by name or other name, or add a new one. */
export function ItemPicker({
  open,
  onOpenChange,
  catalog,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  catalog: Catalog;
  onPick: (item: CatalogItem) => void;
}) {
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const results = useMemo(
    () => catalog.items.filter((i) => matchesSearch(query, i.name, i.aliases)).slice(0, MAX_RESULTS),
    [catalog.items, query],
  );
  const pick = (item: CatalogItem) => {
    onPick(item);
    onOpenChange(false);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (next) {
          setQuery("");
          setAdding(false);
        }
      }}
    >
      <DialogContent title={adding ? "Add a new item" : "Add item"} className={TOP_DIALOG}>
        {adding ? (
          <NewItemForm
            initialName={query}
            catalog={catalog}
            onCancel={() => setAdding(false)}
            onCreated={pick}
          />
        ) : (
          <>
            <SearchInput
              label="Search items"
              placeholder="Name, or what you call it (e.g. tamatar)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && results.length > 0) {
                  e.preventDefault();
                  pick(results[0]);
                }
              }}
              autoFocus
              autoComplete="off"
            />
            <ul className="-mx-2 flex flex-col" aria-label="Items">
              {results.map((item) => {
                const alias = query.trim() && !matchesSearch(query, item.name)
                  ? item.aliases.find((a) => matchesSearch(query, a))
                  : undefined;
                return (
                  <li key={item.itemId}>
                    <button type="button" className={resultClass} onClick={() => pick(item)}>
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-medium">{item.name}</span>
                        <span className="truncate text-sm text-foreground-secondary">
                          {alias ? `“${alias}” · ` : ""}per {UNIT_LABEL[item.baseUnit].one}
                        </span>
                      </span>
                      {item.verified ? null : <Unverified />}
                    </button>
                  </li>
                );
              })}
              {results.length === 0 ? (
                <li className="px-3 py-2 text-sm text-foreground-secondary">No item matches “{query}”.</li>
              ) : null}
            </ul>
            <Button variant="secondary" onClick={() => setAdding(true)}>
              <Icon icon={Plus} />
              {query.trim() ? `Add “${query.trim()}” as a new item` : "Add a new item"}
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function NewItemForm({
  initialName,
  catalog,
  onCancel,
  onCreated,
}: {
  initialName: string;
  catalog: Catalog;
  onCancel: () => void;
  onCreated: (item: CatalogItem) => void;
}) {
  const addItem = useMutation(api.catalog.addItem);
  const [name, setName] = useState(initialName.trim());
  const [categoryId, setCategoryId] = useState<Id<"categories"> | "">(catalog.categories[0]?.categoryId ?? "");
  const [baseUnit, setBaseUnit] = useState<BaseUnit>("kg");
  const [alias, setAlias] = useState("");
  const [defaultShopId, setDefaultShopId] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!categoryId) return;
        setBusy(true);
        try {
          const aliases = alias.trim() ? [alias.trim()] : [];
          const shop = (defaultShopId || undefined) as Id<"shops"> | undefined;
          const itemId = await addItem({ name, categoryId, baseUnit, aliases, defaultShopId: shop });
          onCreated({
            itemId,
            name: name.trim(),
            categoryId,
            baseUnit,
            aliases,
            packSizes: [],
            variants: [],
            defaultShopId: shop ?? null,
            verified: false,
          });
          toast.success("Item added. An admin will check it.");
        } catch (error) {
          toast.error(friendlyError(error));
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field id="new-item-name" label="Item name">
        {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} autoFocus required />}
      </Field>
      <Field id="new-item-alias" label="Other name (optional)" hint="What you call it, in any language, e.g. tamatar.">
        {(p) => <Input {...p} value={alias} onChange={(e) => setAlias(e.target.value)} />}
      </Field>
      <CategorySelect
        categories={catalog.categories}
        value={categoryId}
        onChange={(id) => setCategoryId(id as Id<"categories">)}
        idPrefix="new-item"
        mode="form"
        className="grid grid-cols-2 gap-3"
      />
      <Field id="new-item-unit" label="Counted in" hint="Every purchase of this item is entered in this unit.">
        {(p) => (
          <NativeSelect {...p} value={baseUnit} onChange={(e) => setBaseUnit(e.target.value as BaseUnit)}>
            {BASE_UNITS.map((u) => (
              <option key={u} value={u}>
                {UNIT_LABEL[u].one}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>
      <Field id="new-item-shop" label="Usually bought from (optional)">
        {(p) => (
          <NativeSelect {...p} value={defaultShopId} onChange={(e) => setDefaultShopId(e.target.value)}>
            <option value="">Not sure</option>
            {catalog.shops.map((sh) => (
              <option key={sh.shopId} value={sh.shopId}>
                {sh.name}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Back
        </Button>
        <Button type="submit" loading={busy}>
          Add item
        </Button>
      </DialogFooter>
    </form>
  );
}

/** The chosen shop as a big button; opens a searchable list with "+ Add shop". */
export function ShopPicker({
  catalog,
  shopId,
  extraShop,
  onChange,
}: {
  catalog: Catalog;
  shopId: Id<"shops"> | null;
  /** The entry's current shop when it's no longer in the live list (archived). */
  extraShop?: { shopId: Id<"shops">; name: string } | null;
  onChange: (shopId: Id<"shops">) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<{ shopId: Id<"shops">; name: string } | null>(null);
  const chosen =
    catalog.shops.find((s) => s.shopId === shopId) ??
    (added?.shopId === shopId ? added : null) ??
    (extraShop?.shopId === shopId ? extraShop : null);
  const results = catalog.shops.filter((s) => matchesSearch(query, s.name, s.note ? [s.note] : [])).slice(0, MAX_RESULTS);
  const pick = (id: Id<"shops">) => {
    onChange(id);
    setOpen(false);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setQuery("");
          setAdding(false);
        }
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-14 w-full items-center gap-3 rounded-md border border-border-strong bg-surface px-4 text-left hover:bg-subtle"
      >
        <Icon icon={Store} className="text-foreground-secondary" />
        <span className={chosen ? "font-medium" : "text-foreground-muted"}>{chosen?.name ?? "Choose the shop"}</span>
      </button>
      <DialogContent title={adding ? "Add a new shop" : "Which shop?"} className={TOP_DIALOG}>
        {adding ? (
          <NewShopForm
            initialName={query}
            onCancel={() => setAdding(false)}
            onCreated={(shop) => {
              setAdded(shop);
              pick(shop.shopId);
            }}
          />
        ) : (
          <>
            <SearchInput
              label="Search shops"
              placeholder="Shop name"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
              autoComplete="off"
            />
            <ul className="-mx-2 flex flex-col" aria-label="Shops">
              {results.map((shop) => (
                <li key={shop.shopId}>
                  <button type="button" className={resultClass} onClick={() => pick(shop.shopId)}>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">{shop.name}</span>
                      <span className="truncate text-sm text-foreground-secondary">
                        {SHOP_TYPE_LABEL[shop.type]}
                        {shop.note ? ` · ${shop.note}` : ""}
                      </span>
                    </span>
                    {shop.verified ? null : <Unverified />}
                  </button>
                </li>
              ))}
              {results.length === 0 ? (
                <li className="px-3 py-2 text-sm text-foreground-secondary">
                  {catalog.shops.length === 0 ? "No shops yet." : `No shop matches “${query}”.`}
                </li>
              ) : null}
            </ul>
            <Button variant="secondary" onClick={() => setAdding(true)}>
              <Icon icon={Plus} />
              {query.trim() ? `Add “${query.trim()}” as a new shop` : "Add a new shop"}
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function NewShopForm({
  initialName,
  onCancel,
  onCreated,
}: {
  initialName: string;
  onCancel: () => void;
  onCreated: (shop: { shopId: Id<"shops">; name: string }) => void;
}) {
  const addShop = useMutation(api.catalog.addShop);
  const [name, setName] = useState(initialName.trim());
  const [type, setType] = useState<ShopType>("kirana");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const shopId = await addShop({ name, type, note: note.trim() || undefined });
          onCreated({ shopId, name: name.trim() });
          toast.success("Shop added. An admin will check it.");
        } catch (error) {
          toast.error(friendlyError(error));
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field id="new-shop-name" label="Shop name">
        {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} autoFocus required />}
      </Field>
      <Field id="new-shop-type" label="Type">
        {(p) => (
          <NativeSelect {...p} value={type} onChange={(e) => setType(e.target.value as ShopType)}>
            {SHOP_TYPES.map((t) => (
              <option key={t} value={t}>
                {SHOP_TYPE_LABEL[t]}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>
      <Field id="new-shop-note" label="Area or note (optional)">
        {(p) => <Input {...p} value={note} onChange={(e) => setNote(e.target.value)} />}
      </Field>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Back
        </Button>
        <Button type="submit" loading={busy}>
          Add shop
        </Button>
      </DialogFooter>
    </form>
  );
}
