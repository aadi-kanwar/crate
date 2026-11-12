"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import { matchesSearch } from "@convex/lib/purchases";
import { ScopeSelect, useHistoryScope } from "@/components/admin/history-filters";
import { CategorySelect } from "@/components/app/category-select";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/states";
import { useQuery } from "@/lib/convex";
import { formatQuantity, formatUnitPrice, formatWhen } from "@/lib/format";

/** Admin: every item, with its latest price and last 30 days; opens the item page. */
export default function ItemsPage() {
  const scope = useHistoryScope();
  const items = useQuery(api.history.items, { scope: scope.value });
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const categories = useQuery(api.catalog.lists, {})?.categories ?? [];
  const inCategory = (id: string) =>
    !categoryId || id === categoryId || categories.some((c) => c.categoryId === id && c.parentId === categoryId);
  const shown = (items ?? []).filter(
    (i) => (showArchived || !i.archived) && inCategory(i.categoryId) && matchesSearch(query, i.name, i.aliases),
  );
  return (
    <>
      <PageHeader title="Items" description="How much of each item is bought and used, and what it costs. Open an item for its history." />
      <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 xl:grid-cols-4" role="group" aria-label="Filters">
        <ScopeSelect scope={scope} />
        <CategorySelect categories={categories} value={categoryId} onChange={setCategoryId} idPrefix="history-items" mode="filter" />
        <Field id="history-items-search" label="Search">
          {(p) => <Input {...p} type="search" placeholder="Name or other name" value={query} onChange={(e) => setQuery(e.target.value)} />}
        </Field>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" className="size-5 accent-primary" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived
        </label>
      </div>
      {items === undefined ? (
        <LoadingState rows={6} />
      ) : shown.length === 0 ? (
        <EmptyState title="No items" description="Items appear here once they're added under Lists or while entering." />
      ) : (
        <Card>
          <ul className="divide-y divide-border" aria-label="Items">
            {shown.map((i) => (
              <li key={i.itemId}>
                <Link href={`/admin/items/${i.itemId}`} className="flex items-center gap-3 px-4 py-3 hover:bg-subtle">
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5 lg:flex-row lg:items-center lg:gap-4">
                    <div className="flex min-w-0 flex-col lg:w-56 lg:shrink-0">
                      <span className="truncate font-medium">{i.name}</span>
                      <span className="truncate text-sm text-foreground-secondary">{i.categoryName}</span>
                    </div>
                    <span className="tabular text-sm text-foreground-secondary lg:w-52 lg:shrink-0">
                      {i.lastUnitPricePaise !== null ? `${formatUnitPrice(i.lastUnitPricePaise, i.baseUnit)} last time` : "Not bought yet"}
                    </span>
                    <span className="tabular text-sm text-foreground-secondary">
                      {i.last30Quantity > 0 ? `${formatQuantity(i.last30Quantity, i.baseUnit)} in 30 days` : i.lastBoughtAt ? `Last bought ${formatWhen(i.lastBoughtAt)}` : ""}
                    </span>
                  </div>
                  <Icon icon={ChevronRight} className="shrink-0 text-foreground-muted" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
