"use client";

import { useMutation } from "convex/react";
import { Download } from "lucide-react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { DateRangeSelect, ScopeSelect, useDateRange, useHistoryScope } from "@/components/admin/history-filters";
import { EntryList } from "@/components/entry/entry-list";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FilterBar } from "@/components/ui/filter-bar";
import { Icon } from "@/components/ui/icon";
import { NativeSelect } from "@/components/ui/native-select";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState } from "@/components/ui/skeleton";
import { Stat } from "@/components/ui/stat";
import { EmptyState } from "@/components/ui/states";
import { toast } from "@/components/ui/toaster";
import { useQuery } from "@/lib/convex";
import { friendlyError } from "@/lib/errors";
import { formatDate, formatPaise } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Admin: every entry, filtered, with totals and a spreadsheet download. */
export default function EntriesLogPage() {
  const scope = useHistoryScope();
  const dates = useDateRange("this_month");
  const [categoryId, setCategoryId] = useState("");
  const [shopId, setShopId] = useState("");
  const [itemId, setItemId] = useState("");
  const [enteredBy, setEnteredBy] = useState("");
  const lists = useQuery(api.catalog.lists, {});
  const people = useQuery(api.accounts.list, {});
  const filters = {
    scope: scope.value,
    fromDate: dates.range.from,
    toDate: dates.range.to,
    categoryId: (categoryId || undefined) as Id<"categories"> | undefined,
    shopId: (shopId || undefined) as Id<"shops"> | undefined,
    itemId: (itemId || undefined) as Id<"items"> | undefined,
    enteredBy: (enteredBy || undefined) as Id<"users"> | undefined,
  };
  const log = useQuery(api.history.entriesLog, filters);
  // Keep the last result on screen (dimmed) while a new filter loads.
  const [shown, setShown] = useState(log);
  if (log !== undefined && log !== shown) setShown(log);
  const loading = log === undefined;
  const exportCsv = useMutation(api.history.exportCsv);
  const [downloading, setDownloading] = useState(false);
  const partial = Boolean(categoryId || shopId || itemId);

  return (
    <>
      <PageHeader
        title="Entries"
        description={`${scope.name} · ${formatDate(dates.range.from)} to ${formatDate(dates.range.to)}`}
        actions={
          <Button
            variant="secondary"
            loading={downloading}
            onClick={async () => {
              setDownloading(true);
              try {
                const { csv, filename, rows } = await exportCsv(filters);
                const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
                const a = document.createElement("a");
                a.href = url;
                a.download = filename;
                a.click();
                URL.revokeObjectURL(url);
                toast.success(`Downloaded ${rows} ${rows === 1 ? "row" : "rows"}.`);
              } catch (error) {
                toast.error(friendlyError(error));
              } finally {
                setDownloading(false);
              }
            }}
          >
            <Icon icon={Download} />
            Download CSV
          </Button>
        }
      />
      <FilterBar>
        <ScopeSelect scope={scope} />
        <DateRangeSelect dates={dates} presets={["this_month", "last_30", "last_3m", "last_12m", "custom"]} />
        <Field id="category" label="Category">
          {(p) => (
            <NativeSelect {...p} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">All</option>
              {lists?.categories.map((c) => (
                <option key={c.categoryId} value={c.categoryId}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Field id="shop" label="Shop">
          {(p) => (
            <NativeSelect {...p} value={shopId} onChange={(e) => setShopId(e.target.value)}>
              <option value="">All</option>
              {lists?.shops.map((s) => (
                <option key={s.shopId} value={s.shopId}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Field id="item" label="Item">
          {(p) => (
            <NativeSelect {...p} value={itemId} onChange={(e) => setItemId(e.target.value)}>
              <option value="">All</option>
              {lists?.items.map((i) => (
                <option key={i.itemId} value={i.itemId}>
                  {i.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Field id="entered-by" label="Entered by">
          {(p) => (
            <NativeSelect {...p} value={enteredBy} onChange={(e) => setEnteredBy(e.target.value)}>
              <option value="">Anyone</option>
              {people?.map((u) => (
                <option key={u.userId} value={u.userId}>
                  {u.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
      </FilterBar>

      {shown === undefined ? (
        <LoadingState rows={5} />
      ) : (
        <div className={cn("flex flex-col gap-4 transition-opacity", loading && "opacity-60")}>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat label="Entries" value={shown.totals.entries.toLocaleString("en-IN")} />
            <Stat label={partial ? "Matching items bought" : "Items bought"} value={shown.totals.lines.toLocaleString("en-IN")} />
            <Stat label={partial ? "Spent on matching items" : "Total spent"} value={formatPaise(shown.totals.totalPaise)} emphasis />
          </dl>
          {shown.truncated ? (
            <Banner tone="info">Showing the latest 300 entries. The totals and the download include all {shown.totals.entries}.</Banner>
          ) : null}
          {shown.rows.length === 0 ? (
            <EmptyState title="No entries match" description="Try a longer date range or fewer filters." />
          ) : (
            <EntryList entries={shown.rows} hrefFor={(id) => `/admin/entries/${id}`} showLock={false} />
          )}
        </div>
      )}
    </>
  );
}
