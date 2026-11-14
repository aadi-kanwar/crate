"use client";

import type { FunctionReturnType } from "convex/server";
import { ArrowLeft, Gauge } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { BaseUnit } from "@convex/lib/validators";
import { BarChart, PriceChart } from "@/components/admin/charts";
import { DateRangeSelect, ScopeSelect, useDateRange, useHistoryScope } from "@/components/admin/history-filters";
import { Card, CardBody } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { FilterBar } from "@/components/ui/filter-bar";
import { Icon } from "@/components/ui/icon";
import { NativeSelect } from "@/components/ui/native-select";
import { LoadingState } from "@/components/ui/skeleton";
import { Stat } from "@/components/ui/stat";
import { EmptyState } from "@/components/ui/states";
import { SegmentedTabs } from "@/components/ui/tabs";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useQuery } from "@/lib/convex";
import { formatDate, formatDay, formatMonth, formatPaise, formatQuantity, formatUnitPrice, formatWhen } from "@/lib/format";
import { UNIT_LABEL } from "@/lib/labels";
import { cn } from "@/lib/utils";

type Page = NonNullable<FunctionReturnType<typeof api.history.item>>;

const oneDecimal = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });
const twoDecimals = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

/** "≈1.1 kg/day" or "1 cylinder lasts ≈9 days", whichever reads naturally. */
function usageText(rate: { perDay: number; daysPerUnit: number }, unit: BaseUnit) {
  const perDay = `≈${(rate.perDay >= 10 ? oneDecimal : twoDecimals).format(rate.perDay)} ${rate.perDay === 1 ? UNIT_LABEL[unit].one : UNIT_LABEL[unit].many}/day`;
  const lasts = `1 ${UNIT_LABEL[unit].one} lasts ≈${oneDecimal.format(rate.daysPerUnit)} days`;
  if (unit === "cylinder" || rate.perDay < 0.5) return { main: lasts, other: perDay };
  // "1 kg lasts ≈0.7 days" helps nobody: only offer it when it's at least a day.
  return { main: perDay, other: rate.daysPerUnit >= 1 ? lasts : null };
}

export default function ItemPage() {
  const { itemId } = useParams<{ itemId: string }>();
  const scope = useHistoryScope();
  const dates = useDateRange("last_6m");
  const data = useQuery(api.history.item, {
    itemId: itemId as Id<"items">,
    scope: scope.value,
    fromDate: dates.range.from,
    toDate: dates.range.to,
  });
  const [shown, setShown] = useState(data);
  if (data !== undefined && data !== shown) setShown(data);

  return (
    <>
      <Link href="/admin/items" className="inline-flex items-center gap-1 text-sm font-medium text-foreground-secondary hover:text-foreground">
        <Icon icon={ArrowLeft} className="size-4" />
        Items
      </Link>
      {shown === undefined ? (
        <LoadingState rows={6} />
      ) : shown === null ? (
        <EmptyState title="Item not found" description="It may have been merged into another item." />
      ) : (
        <>
          <header className="flex flex-col gap-1">
            <h1 className="font-serif text-3xl tracking-tight">{shown.item.name}</h1>
            <p className="text-sm text-foreground-secondary">
              {shown.item.categoryName} · counted in {UNIT_LABEL[shown.item.baseUnit].many}
              {shown.item.aliases.length > 0 ? ` · also “${shown.item.aliases.join("”, “")}”` : ""}
            </p>
          </header>
          <FilterBar>
            <ScopeSelect scope={scope} />
            <DateRangeSelect dates={dates} presets={["last_30", "last_3m", "last_6m", "last_12m", "custom"]} />
          </FilterBar>
          <div className={cn("flex flex-col gap-6 transition-opacity", data === undefined && "opacity-60")}>
            <Overview page={shown} />
            <Usage page={shown} />
            <Quantities page={shown} />
            <Prices page={shown} />
          </div>
        </>
      )}
    </>
  );
}

function Overview({ page }: { page: Page }) {
  const unit = page.item.baseUnit;
  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label="Bought" value={twoDecimals.format(page.totals.quantity)} hint={page.totals.quantity === 1 ? UNIT_LABEL[unit].one : UNIT_LABEL[unit].many} />
      <Stat label="Spent" value={formatPaise(page.totals.totalPaise)} emphasis />
      <Stat
        label="Average price"
        value={page.totals.averageUnitPricePaise !== null ? formatPaise(page.totals.averageUnitPricePaise) : "—"}
        hint={`per ${UNIT_LABEL[unit].one}`}
      />
      <Stat label="Purchases" value={page.totals.purchases} />
    </dl>
  );
}

function Usage({ page }: { page: Page }) {
  const unit = page.item.baseUnit;
  return (
    <section aria-labelledby="usage" className="flex flex-col gap-2">
      <h2 id="usage" className="font-serif text-2xl tracking-tight">
        Approximate usage
      </h2>
      <p className="text-sm text-foreground-secondary">
        From the time between purchases: what was bought is taken to last until the next purchase. Averages the latest 5 gaps, separately for each property and Shared.
      </p>
      {page.usage.length === 0 ? (
        <EmptyState icon={Gauge} title="Not enough data" description="Not bought here yet." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {page.usage.map((u) => (
            <Card key={u.scopeKey}>
              <CardBody className="flex flex-col gap-1">
                <span className="text-xs font-medium text-foreground-secondary">{u.scopeName}</span>
                {u.rate ? (
                  <>
                    <span className="text-xl font-semibold">{usageText(u.rate, unit).main}</span>
                    <span className="text-sm text-foreground-secondary">
                      {usageText(u.rate, unit).other ? `${usageText(u.rate, unit).other} · ` : ""}from {u.rate.intervals} {u.rate.intervals === 1 ? "gap" : "gaps"}, {formatDate(u.rate.fromDay)} to {formatDate(u.rate.toDay)}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-xl font-semibold">Not enough data</span>
                    <span className="text-sm text-foreground-secondary">Needs purchases on at least two different days ({u.purchases} so far).</span>
                  </>
                )}
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

function Quantities({ page }: { page: Page }) {
  const [by, setBy] = useState<"week" | "month">("week");
  const unit = page.item.baseUnit;
  const buckets = by === "week" ? page.weekly : page.monthly;
  const periodName = (period: string) => (by === "week" ? `Week of ${formatDay(period, "d MMM")}` : formatMonth(period));
  return (
    <section aria-labelledby="quantities" className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <h2 id="quantities" className="font-serif text-2xl tracking-tight">
          {UNIT_LABEL[unit].many[0].toUpperCase() + UNIT_LABEL[unit].many.slice(1)} bought per {by}
        </h2>
        <SegmentedTabs<"week" | "month">
          label="Group by"
          idPrefix="buckets"
          className="sm:w-64"
          value={by}
          onChange={setBy}
          items={[
            { value: "week", label: "Per week" },
            { value: "month", label: "Per month" },
          ]}
        />
      </div>
      <Card>
        <CardBody id="buckets-panel" role="tabpanel">
          {page.totals.purchases === 0 ? (
            <EmptyState title="No purchases in this period" />
          ) : (
            <BarChart
              ariaLabel={`${page.item.name}: ${UNIT_LABEL[unit].many} bought per ${by}`}
              label={(v) => formatQuantity(v, unit)}
              wholeNumbers={unit === "cylinder" || unit === "piece" || unit === "dozen"}
              data={buckets.map((b) => ({
                key: b.period,
                value: b.quantity,
                axisLabel: by === "week" ? formatDay(b.period, "d MMM") : formatDay(`${b.period}-01`, "MMM yy"),
                tip: [`${formatQuantity(b.quantity, unit)} · ${formatPaise(b.totalPaise)}`, periodName(b.period)],
              }))}
            />
          )}
        </CardBody>
      </Card>
      <details className="text-sm">
        <summary className="cursor-pointer font-medium text-foreground-secondary">Show as a table</summary>
        <Card className="mt-2">
          <Table>
            <THead>
              <TR>
                <TH>{by === "week" ? "Week" : "Month"}</TH>
                <TH className="text-right">Bought</TH>
                <TH className="text-right">Spent</TH>
                <TH className="text-right">Purchases</TH>
              </TR>
            </THead>
            <TBody>
              {[...buckets].reverse().map((b) => (
                <TR key={b.period}>
                  <TD>{periodName(b.period)}</TD>
                  <TD className="tabular text-right">{formatQuantity(b.quantity, unit)}</TD>
                  <TD className="tabular text-right">{formatPaise(b.totalPaise)}</TD>
                  <TD className="tabular text-right">{b.purchases}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      </details>
    </section>
  );
}

function Prices({ page }: { page: Page }) {
  const unit = page.item.baseUnit;
  const [variant, setVariant] = useState("");
  const [shopId, setShopId] = useState("");
  const variants = [...new Set(page.purchases.map((p) => p.variant ?? ""))].sort();
  const shops = [...new Map(page.purchases.map((p) => [p.shopId, p.shopName])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const points = useMemo(
    () =>
      page.purchases.filter(
        (p) => (variant === "" || (p.variant ?? "-") === variant) && (shopId === "" || p.shopId === shopId),
      ),
    [page.purchases, variant, shopId],
  );
  return (
    <section aria-labelledby="prices" className="flex flex-col gap-3">
      <h2 id="prices" className="font-serif text-2xl tracking-tight">
        Price per {UNIT_LABEL[unit].one}
      </h2>
      <FilterBar>
        {variants.length > 1 || variants[0] !== "" ? (
          <Field id="price-variant" label="Variant">
            {(p) => (
              <NativeSelect {...p} value={variant} onChange={(e) => setVariant(e.target.value)}>
                <option value="">All variants</option>
                {variants.map((v) => (
                  <option key={v || "-"} value={v || "-"}>
                    {v || "No variant"}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
        ) : null}
        <Field id="price-shop" label="Shop">
          {(p) => (
            <NativeSelect {...p} value={shopId} onChange={(e) => setShopId(e.target.value)}>
              <option value="">All shops</option>
              {shops.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
      </FilterBar>
      <Card>
        <CardBody>
          {points.length === 0 ? (
            <EmptyState title="No purchases match" />
          ) : (
            <PriceChart
              ariaLabel={`${page.item.name}: price per ${UNIT_LABEL[unit].one} over time`}
              xLabel={(t) => formatWhen(t).split(",").slice(0, -1).join(",") || formatWhen(t)}
              points={points.map((p, i) => ({
                key: `${p.entryId}-${i}`,
                time: p.loggedAt,
                value: p.unitPricePaise / 100,
                tip: [formatUnitPrice(p.unitPricePaise, unit), `${formatWhen(p.loggedAt)} · ${p.shopName}${p.variant ? ` · ${p.variant}` : ""}${p.brand ? ` · ${p.brand}` : ""}`],
              }))}
            />
          )}
        </CardBody>
      </Card>
      <Card>
        <Table>
          <THead>
            <TR>
              <TH>When</TH>
              <TH>Shop</TH>
              <TH className="hidden sm:table-cell">For</TH>
              <TH className="text-right">Bought</TH>
              <TH className="text-right">Price</TH>
            </TR>
          </THead>
          <TBody>
            {[...points].reverse().map((p, i) => (
              <TR key={`${p.entryId}-${i}`}>
                <TD>
                  <Link href={`/admin/entries/${p.entryId}`} className="underline-offset-2 hover:underline">
                    {formatWhen(p.loggedAt)}
                  </Link>
                </TD>
                <TD>
                  {p.shopName}
                  {p.variant || p.brand ? (
                    <span className="block text-xs text-foreground-secondary">{[p.variant, p.brand].filter(Boolean).join(" · ")}</span>
                  ) : null}
                </TD>
                <TD className="hidden sm:table-cell">{p.scopeName}</TD>
                <TD className="tabular text-right">
                  {formatQuantity(p.quantity, unit)}
                  <span className="block text-xs text-foreground-secondary">{formatPaise(p.totalPaise)}</span>
                </TD>
                <TD className="tabular text-right font-medium">{formatUnitPrice(p.unitPricePaise, unit)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
    </section>
  );
}
