"use client";

import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Archive, ArrowDown, ArrowUp, BadgeCheck, CircleHelp, GitMerge, Pencil, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { matchesSearch } from "@convex/lib/purchases";
import { BASE_UNITS, SHOP_TYPES, type BaseUnit, type ShopType } from "@convex/lib/validators";
import { CategorySelect } from "@/components/app/category-select";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { FilterBar, SearchInput } from "@/components/ui/filter-bar";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { LoadingState } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { SegmentedTabs } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toaster";
import { useQuery } from "@/lib/convex";
import { friendlyError } from "@/lib/errors";
import { formatDateTime, parseDecimal } from "@/lib/format";
import { SHOP_TYPE_LABEL, UNIT_LABEL } from "@/lib/labels";
import { cn } from "@/lib/utils";

type Lists = FunctionReturnType<typeof api.catalog.lists>;
type Item = Lists["items"][number];
type Shop = Lists["shops"][number];
type Tab = "review" | "items" | "shops" | "categories";

/** Admin: items, shops and categories, and the queue of new ones to check. */
export function MasterLists() {
  const lists = useQuery(api.catalog.lists, {});
  const [tab, setTab] = useState<Tab>("review");
  if (lists === undefined) return <LoadingState rows={5} />;
  const toReview = lists.items.filter((i) => !i.verified).length + lists.shops.filter((s) => !s.verified).length;
  return (
    <div className="flex flex-col gap-4">
      <SegmentedTabs<Tab>
        label="Lists"
        idPrefix="lists"
        value={tab}
        onChange={setTab}
        items={[
          { value: "review", label: "To check", count: toReview },
          { value: "items", label: "Items", count: lists.items.length },
          { value: "shops", label: "Shops", count: lists.shops.length },
          { value: "categories", label: "Categories" },
        ]}
      />
      <div id="lists-panel" role="tabpanel" className="flex flex-col gap-4">
        {tab === "review" ? <ReviewQueue lists={lists} /> : null}
        {tab === "items" ? <ItemsTab lists={lists} /> : null}
        {tab === "shops" ? <ShopsTab lists={lists} /> : null}
        {tab === "categories" ? <CategoriesTab lists={lists} /> : null}
      </div>
    </div>
  );
}

function Flags({ verified, archived }: { verified: boolean; archived: boolean }) {
  return (
    <>
      {verified ? null : (
        <StatusBadge tone="warning" icon={CircleHelp}>
          To check
        </StatusBadge>
      )}
      {archived ? (
        <StatusBadge tone="neutral" icon={Archive}>
          Archived
        </StatusBadge>
      ) : null}
    </>
  );
}

// ---- Review queue -----------------------------------------------------------

function ReviewQueue({ lists }: { lists: Lists }) {
  const items = lists.items.filter((i) => !i.verified);
  const shops = lists.shops.filter((s) => !s.verified);
  if (items.length === 0 && shops.length === 0)
    return <EmptyState icon={BadgeCheck} title="Nothing to check" description="Items and shops added during entries appear here for you to verify, fix or merge." />;
  return (
    <>
      <p className="text-sm text-foreground-secondary">
        Added by your team while entering. <strong>Verify</strong> if it&apos;s right, <strong>Edit</strong> to fix it, or{" "}
        <strong>Merge</strong> it into the item or shop it duplicates.
      </p>
      {items.length > 0 ? (
        <section className="flex flex-col gap-2" aria-labelledby="review-items">
          <h2 id="review-items" className="font-serif text-2xl tracking-tight">
            New items
          </h2>
          <ItemRows items={items} lists={lists} review />
        </section>
      ) : null}
      {shops.length > 0 ? (
        <section className="flex flex-col gap-2" aria-labelledby="review-shops">
          <h2 id="review-shops" className="font-serif text-2xl tracking-tight">
            New shops
          </h2>
          <ShopRows shops={shops} lists={lists} review />
        </section>
      ) : null}
    </>
  );
}

// ---- Items ------------------------------------------------------------------

function ItemsTab({ lists }: { lists: Lists }) {
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const items = lists.items.filter(
    (i) =>
      (showArchived || !i.archived) &&
      (categoryId === "" ||
        i.categoryId === categoryId ||
        lists.categories.some((c) => c.categoryId === i.categoryId && c.parentId === categoryId)) &&
      matchesSearch(query, i.name, i.aliases),
  );
  return (
    <>
      <FilterBar>
        <SearchInput label="Search items" placeholder="Name or other name" value={query} onChange={(e) => setQuery(e.target.value)} />
        <CategorySelect categories={lists.categories} value={categoryId} onChange={setCategoryId} idPrefix="items-filter" mode="filter" />
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" className="size-5 accent-primary" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived
        </label>
        <div className="sm:ml-auto">
          <ItemDialog lists={lists} />
        </div>
      </FilterBar>
      {items.length === 0 ? <EmptyState title="No items" description="Add items here, or your team adds them while entering." /> : <ItemRows items={items} lists={lists} />}
    </>
  );
}

function ItemRows({ items, lists, review = false }: { items: Item[]; lists: Lists; review?: boolean }) {
  return (
    <Card>
      <ul className="divide-y divide-border" aria-label="Items">
        {items.map((item) => (
          <li key={item.itemId} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{item.name}</span>
                <Flags verified={item.verified} archived={item.archived} />
              </div>
              <span className="text-sm text-foreground-secondary">
                {item.categoryName} · per {UNIT_LABEL[item.baseUnit].one} · {item.lineCount} {item.lineCount === 1 ? "purchase" : "purchases"}
                {item.aliases.length > 0 ? ` · also “${item.aliases.join("”, “")}”` : ""}
                {item.defaultShopName ? ` · usually from ${item.defaultShopName}` : ""}
              </span>
              {review ? (
                <span className="text-xs text-foreground-secondary">
                  Added by {item.createdByName || "—"}, {formatDateTime(item.createdAt)}
                </span>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {item.verified ? null : <VerifyItem item={item} />}
              <ItemDialog lists={lists} item={item} />
              <MergeDialog
                kind="item"
                name={item.name}
                options={lists.items
                  .filter((o) => o.itemId !== item.itemId && !o.archived && o.baseUnit === item.baseUnit)
                  .map((o) => ({ id: o.itemId, name: o.name, hint: `${o.categoryName} · ${o.lineCount} purchases`, aliases: o.aliases }))}
                moving={`${item.lineCount} ${item.lineCount === 1 ? "purchase" : "purchases"}`}
                duplicateId={item.itemId}
              />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function VerifyItem({ item }: { item: Item }) {
  const update = useMutation(api.catalog.updateItem);
  const [busy, setBusy] = useState(false);
  return (
    <Button
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await update({
            itemId: item.itemId,
            name: item.name,
            categoryId: item.categoryId,
            baseUnit: item.baseUnit,
            aliases: item.aliases,
            packSizes: item.packSizes,
            variants: item.variants,
            defaultShopId: item.defaultShopId ?? undefined,
            archived: item.archived,
            verify: true,
          });
          toast.success(`${item.name} verified.`);
        } catch (error) {
          toast.error(friendlyError(error));
        } finally {
          setBusy(false);
        }
      }}
    >
      <Icon icon={BadgeCheck} />
      Verify
    </Button>
  );
}

const splitList = (text: string) => text.split(",").map((s) => s.trim()).filter(Boolean);

/** Add an item (no `item`) or edit one. */
function ItemDialog({ lists, item }: { lists: Lists; item?: Item }) {
  const createItem = useMutation(api.catalog.createItem);
  const updateItem = useMutation(api.catalog.updateItem);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState<Id<"categories">>(lists.categories[0]?.categoryId);
  const [baseUnit, setBaseUnit] = useState<BaseUnit>("kg");
  const [aliases, setAliases] = useState("");
  const [variants, setVariants] = useState("");
  const [packs, setPacks] = useState<{ label: string; quantity: string }[]>([]);
  const [archived, setArchived] = useState(false);
  const [defaultShopId, setDefaultShopId] = useState("");
  const [busy, setBusy] = useState(false);
  const liveShops = lists.shops.filter((sh) => !sh.archived || sh.shopId === item?.defaultShopId);
  const liveCategories = lists.categories.filter((c) => !c.archived || c.categoryId === item?.categoryId);
  const reset = () => {
    setName(item?.name ?? "");
    setCategoryId(item?.categoryId ?? liveCategories[0]?.categoryId);
    setBaseUnit(item?.baseUnit ?? "kg");
    setAliases(item?.aliases.join(", ") ?? "");
    setVariants(item?.variants.join(", ") ?? "");
    setPacks(item?.packSizes.map((p) => ({ label: p.label, quantity: String(p.quantity) })) ?? []);
    setArchived(item?.archived ?? false);
    setDefaultShopId(item?.defaultShopId ?? "");
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) reset();
      }}
    >
      <DialogTrigger asChild>
        {item ? (
          <Button variant="secondary">
            <Icon icon={Pencil} />
            Edit
          </Button>
        ) : (
          <Button>
            <Icon icon={Plus} />
            Add item
          </Button>
        )}
      </DialogTrigger>
      <DialogContent title={item ? `Edit ${item.name}` : "Add an item"} className="max-w-lg">
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const packSizes = [];
            for (const p of packs) {
              if (!p.label.trim()) continue;
              const quantity = parseDecimal(p.quantity);
              if (quantity === null || quantity <= 0) {
                toast.error(`Give "${p.label}" a quantity in ${UNIT_LABEL[baseUnit].many}.`);
                return;
              }
              packSizes.push({ label: p.label, quantity });
            }
            setBusy(true);
            try {
              const fields = {
                name,
                categoryId,
                baseUnit,
                aliases: splitList(aliases),
                variants: splitList(variants),
                packSizes,
                defaultShopId: (defaultShopId || undefined) as Id<"shops"> | undefined,
              };
              if (item) await updateItem({ ...fields, itemId: item.itemId, archived, verify: false });
              else await createItem(fields);
              toast.success("Saved.");
              setOpen(false);
            } catch (error) {
              toast.error(friendlyError(error));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field id="item-name" label="Name">
            {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} required />}
          </Field>
          <CategorySelect
            categories={liveCategories}
            value={categoryId}
            onChange={(id) => setCategoryId(id as Id<"categories">)}
            idPrefix="item"
            mode="form"
            className="grid grid-cols-2 gap-3"
          />
          <div className="grid grid-cols-2 gap-3">
            <Field id="item-unit" label="Counted in" hint={item && item.lineCount > 0 ? "Fixed once bought." : undefined}>
              {(p) => (
                <NativeSelect
                  {...p}
                  value={baseUnit}
                  disabled={item !== undefined && item.lineCount > 0}
                  onChange={(e) => setBaseUnit(e.target.value as BaseUnit)}
                >
                  {BASE_UNITS.map((u) => (
                    <option key={u} value={u}>
                      {UNIT_LABEL[u].one}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
          </div>
          <Field id="item-shop" label="Default shop" hint="Where it's usually bought. Shopping lists start with this shop.">
            {(p) => (
              <NativeSelect {...p} value={defaultShopId} onChange={(e) => setDefaultShopId(e.target.value)}>
                <option value="">None</option>
                {liveShops.map((sh) => (
                  <option key={sh.shopId} value={sh.shopId}>
                    {sh.name}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field id="item-aliases" label="Other names" hint="Separate with commas, any language: tamatar, टमाटर">
            {(p) => <Input {...p} value={aliases} onChange={(e) => setAliases(e.target.value)} />}
          </Field>
          <Field id="item-variants" label="Variants" hint="Optional, separated by commas: Aashirvaad, Loose, Toned">
            {(p) => <Input {...p} value={variants} onChange={(e) => setVariants(e.target.value)} />}
          </Field>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-sm font-medium">Pack sizes</legend>
            <p className="text-sm text-foreground-muted">
              Optional. How it&apos;s sold, and how many {UNIT_LABEL[baseUnit].many} that is, e.g. “500 ml packet” = 0.5 litre.
            </p>
            {packs.map((pack, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  aria-label={`Pack ${i + 1} name`}
                  placeholder="e.g. 5 kg bag"
                  value={pack.label}
                  onChange={(e) => setPacks(packs.map((p, j) => (j === i ? { ...p, label: e.target.value } : p)))}
                />
                <Input
                  aria-label={`Pack ${i + 1} quantity in ${UNIT_LABEL[baseUnit].many}`}
                  placeholder="5"
                  inputMode="decimal"
                  className="tabular w-24 shrink-0"
                  value={pack.quantity}
                  onChange={(e) => setPacks(packs.map((p, j) => (j === i ? { ...p, quantity: e.target.value } : p)))}
                />
                <span className="w-14 shrink-0 text-sm text-foreground-secondary">{UNIT_LABEL[baseUnit].many}</span>
                <Button type="button" variant="ghost" size="icon" aria-label={`Remove pack ${i + 1}`} onClick={() => setPacks(packs.filter((_, j) => j !== i))}>
                  <Icon icon={X} />
                </Button>
              </div>
            ))}
            <Button type="button" variant="ghost" className="self-start" onClick={() => setPacks([...packs, { label: "", quantity: "" }])}>
              <Icon icon={Plus} />
              Add pack size
            </Button>
          </fieldset>
          {item ? (
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input type="checkbox" className="size-5 accent-primary" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
              Archived (hidden when entering; history kept)
            </label>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button type="submit" loading={busy}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---- Merge ------------------------------------------------------------------

function MergeDialog({
  kind,
  name,
  options,
  moving,
  duplicateId,
}: {
  kind: "item" | "shop";
  name: string;
  options: { id: string; name: string; hint: string; aliases?: string[] }[];
  moving: string;
  duplicateId: string;
}) {
  const mergeItem = useMutation(api.catalog.mergeItem);
  const mergeShop = useMutation(api.catalog.mergeShop);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [keepId, setKeepId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const results = useMemo(() => options.filter((o) => matchesSearch(query, o.name, o.aliases)).slice(0, 40), [options, query]);
  const keep = options.find((o) => o.id === keepId);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setQuery("");
          setKeepId(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" disabled={options.length === 0}>
          <Icon icon={GitMerge} />
          Merge
        </Button>
      </DialogTrigger>
      <DialogContent
        title={`Merge “${name}” into…`}
        description={`Choose the ${kind} to keep. Its ${moving} move to it, “${name}” is added to its other names, and “${name}” is removed. This can't be undone.`}
      >
        {keep ? (
          <>
            <p className="rounded-md border border-warning-border bg-warning-subtle px-4 py-3 text-sm text-warning">
              Merge <strong>“{name}”</strong> into <strong>“{keep.name}”</strong>?
            </p>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setKeepId(null)}>
                Back
              </Button>
              <Button
                variant="destructive"
                loading={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    if (kind === "item") await mergeItem({ duplicateId: duplicateId as Id<"items">, keepId: keep.id as Id<"items"> });
                    else await mergeShop({ duplicateId: duplicateId as Id<"shops">, keepId: keep.id as Id<"shops"> });
                    toast.success(`Merged into ${keep.name}.`);
                    setOpen(false);
                  } catch (error) {
                    toast.error(friendlyError(error));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Merge
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <SearchInput label={`Search ${kind}s`} value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
            <ul className="-mx-2 flex max-h-80 flex-col overflow-y-auto">
              {results.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => setKeepId(o.id)}
                    className="flex min-h-12 w-full flex-col items-start justify-center rounded-md px-3 py-2 text-left hover:bg-subtle"
                  >
                    <span className="font-medium">{o.name}</span>
                    <span className="text-sm text-foreground-secondary">{o.hint}</span>
                  </button>
                </li>
              ))}
              {results.length === 0 ? <li className="px-3 py-2 text-sm text-foreground-secondary">Nothing matches.</li> : null}
            </ul>
            {kind === "item" ? <p className="text-xs text-foreground-muted">Only items counted in the same unit are listed.</p> : null}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---- Shops ------------------------------------------------------------------

function ShopsTab({ lists }: { lists: Lists }) {
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const shops = lists.shops.filter((s) => (showArchived || !s.archived) && matchesSearch(query, s.name, s.note ? [s.note] : []));
  return (
    <>
      <FilterBar>
        <SearchInput label="Search shops" value={query} onChange={(e) => setQuery(e.target.value)} />
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" className="size-5 accent-primary" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived
        </label>
        <div className="sm:ml-auto">
          <ShopDialog />
        </div>
      </FilterBar>
      {shops.length === 0 ? <EmptyState title="No shops" /> : <ShopRows shops={shops} lists={lists} />}
    </>
  );
}

function ShopRows({ shops, lists, review = false }: { shops: Shop[]; lists: Lists; review?: boolean }) {
  return (
    <Card>
      <ul className="divide-y divide-border" aria-label="Shops">
        {shops.map((shop) => (
          <li key={shop.shopId} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{shop.name}</span>
                <Flags verified={shop.verified} archived={shop.archived} />
              </div>
              <span className="text-sm text-foreground-secondary">
                {SHOP_TYPE_LABEL[shop.type]}
                {shop.note ? ` · ${shop.note}` : ""} · {shop.entryCount} {shop.entryCount === 1 ? "entry" : "entries"}
              </span>
              {review ? (
                <span className="text-xs text-foreground-secondary">
                  Added by {shop.createdByName || "—"}, {formatDateTime(shop.createdAt)}
                </span>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {shop.verified ? null : <ShopDialog shop={shop} verifyOnly />}
              <ShopDialog shop={shop} />
              <MergeDialog
                kind="shop"
                name={shop.name}
                options={lists.shops
                  .filter((o) => o.shopId !== shop.shopId && !o.archived)
                  .map((o) => ({ id: o.shopId, name: o.name, hint: `${SHOP_TYPE_LABEL[o.type]} · ${o.entryCount} entries` }))}
                moving={`${shop.entryCount} ${shop.entryCount === 1 ? "entry" : "entries"}`}
                duplicateId={shop.shopId}
              />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Add a shop, edit one, or (verifyOnly) just verify it as it is. */
function ShopDialog({ shop, verifyOnly = false }: { shop?: Shop; verifyOnly?: boolean }) {
  const createShop = useMutation(api.catalog.createShop);
  const updateShop = useMutation(api.catalog.updateShop);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<ShopType>("kirana");
  const [note, setNote] = useState("");
  const [archived, setArchived] = useState(false);
  const [busy, setBusy] = useState(false);

  if (verifyOnly && shop)
    return (
      <Button
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await updateShop({ shopId: shop.shopId, name: shop.name, type: shop.type, note: shop.note ?? undefined, archived: shop.archived, verify: true });
            toast.success(`${shop.name} verified.`);
          } catch (error) {
            toast.error(friendlyError(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Icon icon={BadgeCheck} />
        Verify
      </Button>
    );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setName(shop?.name ?? "");
          setType(shop?.type ?? "kirana");
          setNote(shop?.note ?? "");
          setArchived(shop?.archived ?? false);
        }
      }}
    >
      <DialogTrigger asChild>
        {shop ? (
          <Button variant="secondary">
            <Icon icon={Pencil} />
            Edit
          </Button>
        ) : (
          <Button>
            <Icon icon={Plus} />
            Add shop
          </Button>
        )}
      </DialogTrigger>
      <DialogContent title={shop ? `Edit ${shop.name}` : "Add a shop"}>
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              if (shop) await updateShop({ shopId: shop.shopId, name, type, note: note || undefined, archived, verify: false });
              else await createShop({ name, type, note: note || undefined });
              toast.success("Saved.");
              setOpen(false);
            } catch (error) {
              toast.error(friendlyError(error));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field id="shop-name" label="Name">
            {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} required />}
          </Field>
          <Field id="shop-type" label="Type">
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
          <Field id="shop-note" label="Area or note (optional)">
            {(p) => <Input {...p} value={note} onChange={(e) => setNote(e.target.value)} />}
          </Field>
          {shop ? (
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input type="checkbox" className="size-5 accent-primary" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
              Archived (hidden when entering; history kept)
            </label>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button type="submit" loading={busy}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---- Categories -------------------------------------------------------------

function CategoriesTab({ lists }: { lists: Lists }) {
  const add = useMutation(api.catalog.addCategory);
  const move = useMutation(api.catalog.moveCategory);
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
    } catch (error) {
      toast.error(friendlyError(error));
    }
  };
  const tops = lists.categories.filter((c) => c.parentId === null);
  return (
    <>
      <p className="text-sm text-foreground-secondary">
        A category can have sub-categories (e.g. Grocery › Pulses). Filtering by a category includes its sub-categories.
      </p>
      <Card>
        <ul className="divide-y divide-border" aria-label="Categories">
          {lists.categories.map((c) => {
            const siblings = lists.categories.filter((x) => x.parentId === c.parentId);
            const position = siblings.findIndex((x) => x.categoryId === c.categoryId);
            return (
              <li key={c.categoryId} className={cn("flex items-center justify-between gap-2 py-2 pr-4", c.parentId ? "pl-10" : "pl-4")}>
                <div className="flex min-w-0 flex-col">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {c.parentId ? <span className="text-foreground-muted" aria-hidden>↳</span> : null}
                    {c.name}
                    <Flags verified archived={c.archived} />
                  </span>
                  <span className="text-sm text-foreground-secondary">
                    {c.parentId ? "Sub-category · " : ""}
                    {c.itemCount} {c.itemCount === 1 ? "item" : "items"}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Move ${c.name} up`}
                    disabled={position === 0}
                    onClick={() => run(() => move({ categoryId: c.categoryId, direction: "up" }))}
                  >
                    <Icon icon={ArrowUp} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Move ${c.name} down`}
                    disabled={position === siblings.length - 1}
                    onClick={() => run(() => move({ categoryId: c.categoryId, direction: "down" }))}
                  >
                    <Icon icon={ArrowDown} />
                  </Button>
                  <CategoryDialog category={c} />
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          await run(async () => {
            await add({ name, parentId: (parentId || undefined) as Id<"categories"> | undefined });
            setName("");
          });
          setBusy(false);
        }}
      >
        <Input aria-label="New category" placeholder={parentId ? "New sub-category" : "New category"} value={name} onChange={(e) => setName(e.target.value)} required />
        <NativeSelect aria-label="Where" value={parentId} onChange={(e) => setParentId(e.target.value)} className="sm:w-64">
          <option value="">As a main category</option>
          {tops.map((c) => (
            <option key={c.categoryId} value={c.categoryId}>
              Under {c.name}
            </option>
          ))}
        </NativeSelect>
        <Button type="submit" loading={busy}>
          <Icon icon={Plus} />
          Add
        </Button>
      </form>
    </>
  );
}

function CategoryDialog({ category }: { category: Lists["categories"][number] }) {
  const update = useMutation(api.catalog.updateCategory);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(category.name);
  const [archived, setArchived] = useState(category.archived);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setName(category.name);
          setArchived(category.archived);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Edit ${category.name}`}>
          <Icon icon={Pencil} />
        </Button>
      </DialogTrigger>
      <DialogContent title={`Edit ${category.name}`}>
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await update({ categoryId: category.categoryId, name, archived });
              toast.success("Saved.");
              setOpen(false);
            } catch (error) {
              toast.error(friendlyError(error));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field id="category-name" label="Name">
            {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} required />}
          </Field>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" className="size-5 accent-primary" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
            Archived (not offered for new items; existing items keep it)
          </label>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button type="submit" loading={busy}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
