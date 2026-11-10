"use client";

import { useMutation } from "convex/react";
import { Building2, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { LoadingState } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toaster";
import { useQuery } from "@/lib/convex";
import { friendlyError } from "@/lib/errors";

/** A one-field dialog: rename the organisation, add a property, rename a property. */
function NameDialog({
  trigger,
  title,
  label,
  initial,
  submitLabel,
  onSubmit,
}: {
  trigger: React.ReactNode;
  title: string;
  label: string;
  initial: string;
  submitLabel: string;
  onSubmit: (name: string) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setName(initial);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={title}>
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await onSubmit(name);
              toast.success("Saved.");
              setOpen(false);
            } catch (error) {
              toast.error(friendlyError(error));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field id="name-dialog" label={label}>
            {(p) => (
              <Input
                {...p}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            )}
          </Field>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button type="submit" loading={busy}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Settings → Organisation: its name and properties (as in MealSync). */
export function OrganizationSettings() {
  const org = useQuery(api.organization.get, {});
  const rename = useMutation(api.organization.rename);
  const addProperty = useMutation(api.organization.addProperty);
  const renameProperty = useMutation(api.organization.renameProperty);
  return (
    <section aria-labelledby="organisation" className="flex flex-col gap-2">
      <h2 id="organisation" className="font-serif text-2xl tracking-tight">
        Organisation
      </h2>
      <p className="text-sm text-foreground-secondary">
        Purchases are logged per property. Choose a property at the top of
        the screen to see only its purchases, or All properties.
      </p>
      {org === undefined ? (
        <LoadingState rows={2} />
      ) : (
        <Card>
          <div className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Icon icon={Building2} className="text-foreground-secondary" />
              <span className="font-semibold">{org.name}</span>
            </div>
            <NameDialog
              trigger={
                <Button variant="secondary">
                  <Icon icon={Pencil} />
                  Rename
                </Button>
              }
              title="Rename organisation"
              label="Organisation name"
              initial={org.name}
              submitLabel="Save"
              onSubmit={(name) => rename({ name })}
            />
          </div>
          <ul className="divide-y divide-border" aria-label="Properties">
            {org.properties.map((p) => (
              <li
                key={p.propertyId}
                className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex flex-col">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-sm text-foreground-secondary">
                    {p.assignedPeople}{" "}
                    {p.assignedPeople === 1 ? "person" : "people"} assigned
                  </span>
                </div>
                <NameDialog
                  trigger={
                    <Button variant="ghost">
                      <Icon icon={Pencil} />
                      Rename
                    </Button>
                  }
                  title="Rename property"
                  label="Property name"
                  initial={p.name}
                  submitLabel="Save"
                  onSubmit={(name) =>
                    renameProperty({
                      targetPropertyId: p.propertyId as Id<"properties">,
                      name,
                    })
                  }
                />
              </li>
            ))}
          </ul>
          <div className="border-t border-border px-4 py-3">
            <NameDialog
              trigger={
                <Button variant="secondary">
                  <Icon icon={Plus} />
                  Add property
                </Button>
              }
              title="Add a property"
              label="Property name"
              initial=""
              submitLabel="Add property"
              onSubmit={(name) => addProperty({ name })}
            />
          </div>
        </Card>
      )}
    </section>
  );
}
