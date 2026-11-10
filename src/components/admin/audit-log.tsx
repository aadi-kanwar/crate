"use client";

import { usePaginatedQuery } from "convex/react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FilterBar } from "@/components/ui/filter-bar";
import { NativeSelect } from "@/components/ui/native-select";
import { LoadingState } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/states";
import { formatDateTime, formatPaise } from "@/lib/format";

const ACTION_LABEL: Record<string, string> = {
  "setup.first_admin_created": "First admin created",
  "user.password_changed": "Changed own password",
  "organization.created": "Organisation set up",
  "organization.renamed": "Organisation renamed",
  "property.added": "Property added",
  "property.renamed": "Property renamed",
  "account.created": "User added",
  "account.updated": "User changed",
  "account.password_reset": "Password reset",
  "account.deactivated": "User switched off",
  "account.reactivated": "User switched back on",
  "category.created": "Category added",
  "category.updated": "Category changed",
  "item.created": "Item added",
  "item.updated": "Item changed",
  "item.verified": "Item verified",
  "item.merged": "Items merged",
  "shop.created": "Shop added",
  "shop.updated": "Shop changed",
  "shop.verified": "Shop verified",
  "shop.merged": "Shops merged",
  "entry.created": "Entry added",
  "entry.updated": "Entry changed",
  "entry.deleted": "Entry deleted",
  "report.exported": "Download",
  "sso.signed_in": "Signed in from the Admin Hub",
  "sso.access_revoked": "Admin Hub access removed",
};

const TYPES = [
  { value: "", label: "Everything" },
  { value: "entries", label: "Entries" },
  { value: "items", label: "Items" },
  { value: "shops", label: "Shops" },
  { value: "categories", label: "Categories" },
  { value: "users", label: "Users" },
  { value: "properties", label: "Properties" },
];

type Meta = Record<string, unknown> | null;

/** A one-line summary of what changed. */
function summary(action: string, meta: Meta): string {
  if (!meta) return "";
  const before = meta.before as Record<string, unknown> | undefined;
  const after = meta.after as Record<string, unknown> | undefined;
  if (action.startsWith("entry.")) {
    const e = (after ?? before) as { shop?: string; scope?: string; totalPaise?: number; lines?: unknown[] } | undefined;
    if (!e) return "";
    const total =
      before && after && before.totalPaise !== after.totalPaise
        ? `${formatPaise(Number(before.totalPaise))} → ${formatPaise(Number(after.totalPaise))}`
        : formatPaise(Number(e.totalPaise ?? 0));
    const date = meta.dateChanged ? ` · date changed from ${formatDateTime(Number(before?.loggedAt))} to ${formatDateTime(Number(after?.loggedAt))}` : "";
    const count = e.lines?.length ?? 0;
    return `${e.shop} · ${e.scope} · ${count} ${count === 1 ? "item" : "items"} · ${total}${date}`;
  }
  if (action.endsWith(".merged")) {
    const merged = meta.merged as { name?: string } | undefined;
    const into = meta.into as { name?: string } | undefined;
    return `“${merged?.name}” into “${into?.name}”${meta.linesMoved !== undefined ? ` · ${meta.linesMoved} lines moved` : ""}`;
  }
  if (before && after) {
    const changed = Object.keys(after).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
    return changed.map((k) => `${k}: ${show(before[k])} → ${show(after[k])}`).join(" · ");
  }
  if (after) return show(after.name ?? "");
  if (typeof meta.name === "string") return meta.name;
  return "";
}

function show(value: unknown): string {
  if (Array.isArray(value)) return value.length === 0 ? "none" : value.map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v))).join(", ");
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Admin: every change, newest first. Can't be edited or deleted. */
export function AuditLog() {
  const [entityType, setEntityType] = useState("");
  const { results, status, loadMore } = usePaginatedQuery(
    api.audit.list,
    { entityType: entityType || undefined },
    { initialNumItems: 50 },
  );
  return (
    <div className="flex flex-col gap-4">
      <FilterBar>
        <NativeSelect aria-label="Show" value={entityType} onChange={(e) => setEntityType(e.target.value)} className="sm:w-56">
          {TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </NativeSelect>
      </FilterBar>
      {status === "LoadingFirstPage" ? (
        <LoadingState rows={6} />
      ) : results.length === 0 ? (
        <EmptyState title="Nothing here yet" />
      ) : (
        <Card>
          <ul className="divide-y divide-border" aria-label="Audit log">
            {results.map((row) => (
              <li key={row.auditId} className="flex flex-col gap-1 px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="font-medium">{ACTION_LABEL[row.action] ?? row.action}</span>
                  <span className="tabular text-xs text-foreground-secondary">{formatDateTime(row.createdAt)}</span>
                </div>
                <span className="text-sm text-foreground-secondary">
                  {row.actorName ?? "System"}
                  {summary(row.action, row.metadata) ? ` · ${summary(row.action, row.metadata)}` : ""}
                </span>
                {row.metadata ? (
                  <details className="text-xs text-foreground-secondary">
                    <summary className="cursor-pointer select-none">Full details</summary>
                    <pre className="mt-2 overflow-x-auto rounded-md bg-subtle p-3 font-mono whitespace-pre-wrap">{JSON.stringify(row.metadata, null, 2)}</pre>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {status === "CanLoadMore" ? (
        <Button variant="secondary" className="self-center" onClick={() => loadMore(50)}>
          Show older
        </Button>
      ) : status === "LoadingMore" ? (
        <LoadingState rows={1} />
      ) : null}
    </div>
  );
}
