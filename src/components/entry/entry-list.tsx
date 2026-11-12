"use client";

import type { FunctionReturnType } from "convex/server";
import { ChevronRight, Lock, Trash2 } from "lucide-react";
import Link from "next/link";
import type { api } from "@convex/_generated/api";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatPaise, formatWhen } from "@/lib/format";

export type EntryRow = FunctionReturnType<typeof api.entries.recent>[number] & {
  /** Entries log with an item / category / shop filter: the matching lines' amount. */
  matchingPaise?: number;
};

/** Entries as tappable rows: shop, scope, when, what, total; a lock once only an admin can change it. */
export function EntryList({
  entries,
  hrefFor,
  showScope = true,
  showLock = true,
}: {
  entries: EntryRow[];
  hrefFor: (entryId: string) => string;
  showScope?: boolean;
  showLock?: boolean;
}) {
  return (
    <Card>
      <ul className="divide-y divide-border" aria-label="Entries">
        {entries.map((e) => (
          <li key={e.entryId}>
            <Link href={hrefFor(e.entryId)} className="flex items-center gap-3 px-4 py-3 hover:bg-subtle">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate font-medium">{e.shopName}</span>
                  <span className="tabular shrink-0 text-right font-medium">
                    {e.matchingPaise !== undefined && e.matchingPaise !== e.totalPaise ? (
                      <>
                        {formatPaise(e.matchingPaise)}
                        <span className="block text-xs font-normal text-foreground-secondary">of {formatPaise(e.totalPaise)}</span>
                      </>
                    ) : (
                      formatPaise(e.totalPaise)
                    )}
                  </span>
                </div>
                <span className="truncate text-sm text-foreground-secondary">
                  {e.itemNames.join(", ")}
                  {e.lineCount > e.itemNames.length ? ` +${e.lineCount - e.itemNames.length} more` : ""}
                </span>
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-foreground-secondary">
                  <span>{formatWhen(e.loggedAt)}</span>
                  {showScope ? <span>· {e.scopeName}</span> : null}
                  {e.createdByName ? <span>· {e.createdByName}</span> : null}
                  {e.deleted ? (
                    <StatusBadge tone="danger" icon={Trash2}>
                      Deleted
                    </StatusBadge>
                  ) : showLock && e.locked ? (
                    <StatusBadge tone="neutral" icon={Lock}>
                      Locked
                    </StatusBadge>
                  ) : null}
                </span>
              </div>
              <Icon icon={ChevronRight} className="shrink-0 text-foreground-muted" />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
