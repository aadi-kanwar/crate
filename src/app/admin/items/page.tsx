"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import { matchesSearch } from "@convex/lib/purchases";
import { ScopeSelect, useHistoryScope } from "@/components/admin/history-filters";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { FilterBar, SearchInput } from "@/components/ui/filter-bar";
import { Icon } from "@/components/ui/icon";
import { NativeSelect } from "@/components/ui/native-select";
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
  const categories = [...new Map((items ?? []).map((i) => [i.categoryId, i.categoryName])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const shown = (items ?? []).filter(
    (i) => (showArchived || !i.archived) && (!categoryId || i.categoryId === categoryId) && matchesSearch(query, i.name, i.aliases),
  );
  return (
    <>
      <PageHeader title="Items" description="How much of each item is bought and used, and what it costs. Open an item for its history." />
      <FilterBar>
        <ScopeSelect scope={scope} />
        <Field id="item-category" label="Category">
          {(p) => (
            <NativeSelect {...p} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">All</option>
              {categories.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <SearchInput label="Search items" placeholder="Name or other name" value={query} onChange={(e) => setQuery(e.target.value)} />
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" className="size-5 accent-primary" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived
        </label>
      </FilterBar>
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
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-4">
                    <div className="flex min-w-0 flex-col sm:w-64">
                      <span className="truncate font-medium">{i.name}</span>
                      <span className="truncate text-sm text-foreground-secondary">{i.categoryName}</span>
                    </div>
                    <span className="tabular text-sm text-foreground-secondary sm:w-48">
                      {i.lastUnitPricePaise !== null ? `${formatUnitPrice(i.lastUnitPricePaise, i.baseUnit)} last time` : "Not bought yet"}
                    </span>
                    <span className="tabular text-sm text-foreground-secondary sm:w-56">
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
