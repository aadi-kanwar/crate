"use client";

import { useMutation } from "convex/react";
import { Lock, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { LoadingState } from "@/components/ui/skeleton";
import { DetailList } from "@/components/ui/stat";
import { EmptyState } from "@/components/ui/states";
import { toast } from "@/components/ui/toaster";
import { useQuery } from "@/lib/convex";
import { friendlyError, parseAppError } from "@/lib/errors";
import { formatDateTime, formatPaise, formatQuantity, formatUnitPrice, formatWhen } from "@/lib/format";
import { EntryForm } from "./entry-form";

/**
 * One entry: details and lines, with Edit and Delete while allowed
 * (managers / kitchen staff: 24 hours; admins: always, including the date).
 */
export function EntryDetail({
  entryId,
  properties,
  onDeleted,
}: {
  entryId: Id<"entries">;
  properties: { propertyId: Id<"properties">; name: string }[];
  onDeleted: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const entry = useQuery(api.entries.get, { entryId });
  if (entry === undefined) return <LoadingState rows={4} />;
  if (entry === null)
    return <EmptyState title="Entry not found" description="It may have been deleted, or it&apos;s for a property you don&apos;t work for." />;

  if (editing)
    return (
      <EntryForm
        properties={properties}
        defaultPropertyId={entry.scope.kind === "property" ? entry.scope.propertyId : (properties[0]?.propertyId ?? null)}
        initial={{
          entryId: entry.entryId,
          scope: entry.scope,
          shopId: entry.shopId,
          shopName: entry.shopName,
          note: entry.note,
          loggedAt: entry.loggedAt,
          lines: entry.lines,
        }}
        allowDate={entry.canChangeDate}
        onDone={() => setEditing(false)}
        onCancel={() => setEditing(false)}
      />
    );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="font-serif text-3xl tracking-tight">{entry.shopName}</h1>
        <p className="text-sm text-foreground-secondary">
          {entry.scopeName} · {formatWhen(entry.loggedAt)}
        </p>
      </div>
      {entry.deleted ? (
        <Banner tone="danger" title="Deleted">
          This entry was deleted. It no longer counts anywhere; it&apos;s kept for the record.
        </Banner>
      ) : !entry.canEdit ? (
        <Banner tone="info" title="Locked">
          It&apos;s more than 24 hours old, so only an admin can change it now.
        </Banner>
      ) : entry.editableUntil ? (
        <p className="text-sm text-foreground-secondary">You can change or delete it until {formatWhen(entry.editableUntil)}.</p>
      ) : null}
      <Card>
        <ul className="divide-y divide-border" aria-label="Items">
          {entry.lines.map((l, i) => (
            <li key={i} className="flex flex-col gap-0.5 px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0">
                  <span className="font-medium">{l.itemName}</span>
                  {l.variant ? <span className="text-foreground-secondary"> · {l.variant}</span> : null}
                </span>
                <span className="tabular font-medium">{formatPaise(l.totalPaise)}</span>
              </div>
              <span className="tabular text-sm text-foreground-secondary">
                {l.packLabel ? `${l.packCount} × ${l.packLabel} = ` : ""}
                {formatQuantity(l.quantity, l.baseUnit)} · {formatUnitPrice(l.unitPricePaise, l.baseUnit)}
              </span>
            </li>
          ))}
        </ul>
        <div className="flex items-baseline justify-between border-t border-border px-4 py-3 font-semibold">
          <span>Total</span>
          <span className="tabular">{formatPaise(entry.totalPaise)}</span>
        </div>
      </Card>
      <Card>
        <CardBody>
          <DetailList
            rows={[
              ...(entry.note ? [{ label: "Note", value: entry.note }] : []),
              { label: "Logged", value: formatDateTime(entry.loggedAt) },
              { label: "Entered by", value: entry.createdByName ?? "—" },
              ...(entry.updatedAt
                ? [{ label: "Last changed", value: `${formatDateTime(entry.updatedAt)} by ${entry.updatedByName ?? "—"}` }]
                : []),
            ]}
          />
        </CardBody>
      </Card>
      {entry.canEdit ? (
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <DeleteEntry entryId={entry.entryId} onDeleted={onDeleted} />
          <Button className="min-h-12" onClick={() => setEditing(true)}>
            <Icon icon={Pencil} />
            Edit
          </Button>
        </div>
      ) : entry.deleted ? null : (
        <p className="flex items-center gap-2 text-sm text-foreground-secondary">
          <Icon icon={Lock} className="size-4" /> Ask an admin if something needs fixing.
        </p>
      )}
    </div>
  );
}

function DeleteEntry({ entryId, onDeleted }: { entryId: Id<"entries">; onDeleted: () => void }) {
  const remove = useMutation(api.entries.remove);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost">
          <Icon icon={Trash2} />
          Delete
        </Button>
      </DialogTrigger>
      <DialogContent title="Delete this entry?" description="It stops counting everywhere. An admin can still see it in the records.">
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button
            variant="destructive"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await remove({ entryId });
                toast.success("Entry deleted.");
                setOpen(false);
                onDeleted();
              } catch (error) {
                toast.error(friendlyError(error));
                if (parseAppError(error)?.code !== "EDIT_WINDOW_CLOSED") setBusy(false);
                else setOpen(false);
              }
            }}
          >
            Delete entry
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
