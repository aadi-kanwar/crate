"use client";

import { useAction, useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  Copy,
  KeyRound,
  Pencil,
  Power,
  ShieldCheck,
  UserPlus,
  UserRound,
  Wand2,
} from "lucide-react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  formatPhoneForDisplay,
  temporaryPassword as suggestPassword,
} from "@convex/lib/inputRules";
import type { Role } from "@convex/lib/validators";
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
import { StatusBadge } from "@/components/ui/status-badge";
import { toast } from "@/components/ui/toaster";
import { useQuery } from "@/lib/convex";
import { friendlyError } from "@/lib/errors";
import { ROLE_LABEL, ROLE_OPTIONS } from "@/lib/labels";
import { usePropertyScope } from "@/components/app/property-scope";

type Account = FunctionReturnType<typeof api.accounts.list>[number];

/** Users: everyone with a login, adding, editing, password resets, switching off. */
export function UsersList() {
  const accounts = useQuery(api.accounts.list, {});
  if (accounts === undefined) return <LoadingState rows={4} />;
  return (
    <Card>
      <ul className="divide-y divide-border" aria-label="Users">
        {accounts.map((a) => (
          <li
            key={a.userId}
            className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{a.name}</span>
                <StatusBadge
                  tone={a.role === "admin" ? "primary" : "neutral"}
                  icon={a.role === "admin" ? ShieldCheck : UserRound}
                >
                  {ROLE_LABEL[a.role]}
                </StatusBadge>
                {a.isYou ? (
                  <StatusBadge tone="info" icon={UserRound}>
                    You
                  </StatusBadge>
                ) : null}
                {a.disabled ? (
                  <StatusBadge tone="danger" icon={Power}>
                    Switched off
                  </StatusBadge>
                ) : null}
                {a.mustChangePassword && !a.disabled ? (
                  <StatusBadge tone="warning" icon={KeyRound}>
                    Temporary password
                  </StatusBadge>
                ) : null}
              </div>
              <span className="tabular text-sm text-foreground-secondary">
                {formatPhoneForDisplay(a.phone)}
                {a.role === "admin"
                  ? " · all properties"
                  : ` · ${a.propertyNames.join(", ") || "no property"}`}
              </span>
            </div>
            <div className="flex flex-nowrap gap-2">
              <AccountDialog account={a} />
              {a.isYou ? null : (
                <>
                  {a.disabled ? null : (
                    <ResetPasswordDialog userId={a.userId} name={a.name} />
                  )}
                  <DisableDialog account={a} />
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Shows a temporary password once, with Copy. */
function OneTimePassword({ password }: { password: string }) {
  return (
    <>
      <p className="rounded-md border border-border bg-subtle px-4 py-3 text-center font-mono text-2xl tracking-widest">
        {password}
      </p>
      <DialogFooter>
        <Button
          variant="secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(password);
              toast.success("Copied.");
            } catch {
              toast.error("Couldn't copy. Please write it down.");
            }
          }}
        >
          <Icon icon={Copy} />
          Copy
        </Button>
        <DialogClose asChild>
          <Button>Done</Button>
        </DialogClose>
      </DialogFooter>
    </>
  );
}

/** Add a user (no `account`) or edit one. */
export function AccountDialog({ account }: { account?: Account }) {
  const { properties } = usePropertyScope();
  const create = useAction(api.accounts.create);
  const update = useMutation(api.accounts.update);
  const editing = account !== undefined;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<Role>("kitchen_staff");
  const [assigned, setAssigned] = useState<Set<Id<"properties">>>(new Set());
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<string | null>(null);

  const reset = () => {
    setName(account?.name ?? "");
    setPhone("");
    setRole(account?.role ?? "kitchen_staff");
    setAssigned(
      new Set(
        account
          ? account.propertyIds
          : properties.length === 1
            ? [properties[0].propertyId]
            : [],
      ),
    );
    setPassword(suggestPassword());
    setCreated(null);
  };

  const toggle = (id: Id<"properties">) =>
    setAssigned((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) reset();
      }}
    >
      <DialogTrigger asChild>
        {editing ? (
          <Button variant="secondary">
            <Icon icon={Pencil} />
            Edit
          </Button>
        ) : (
          <Button className="self-start">
            <Icon icon={UserPlus} />
            Add user
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        title={
          created
            ? `${name.trim()} can now sign in`
            : editing
              ? `Edit ${account.name}`
              : "Add a user"
        }
        description={
          created
            ? "Give them this temporary password in person. They sign in with their mobile number and this password, then choose their own."
            : editing
              ? "Change their name, role or properties. Their password stays the same."
              : "They sign in with their mobile number and the temporary password below, then must choose their own."
        }
      >
        {created ? (
          <OneTimePassword password={created} />
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                const assignedPropertyIds = role === "admin" ? [] : [...assigned];
                if (editing) {
                  await update({
                    userId: account.userId,
                    name,
                    role,
                    assignedPropertyIds,
                  });
                  toast.success("Saved.");
                  setOpen(false);
                } else {
                  await create({
                    name,
                    phone,
                    role,
                    assignedPropertyIds,
                    temporaryPassword: password,
                  });
                  setCreated(password);
                }
              } catch (error) {
                toast.error(friendlyError(error));
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field id="user-name" label="Full name">
              {(p) => (
                <Input
                  {...p}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="off"
                  required
                />
              )}
            </Field>
            {editing ? null : (
              <Field
                id="user-phone"
                label="Mobile number"
                hint="Their login. India (+91) unless you type another code."
              >
                {(p) => (
                  <Input
                    {...p}
                    type="tel"
                    inputMode="tel"
                    placeholder="98765 43210"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                  />
                )}
              </Field>
            )}
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1.5 text-sm font-medium">Role</legend>
              {ROLE_OPTIONS.map((o) => (
                <label
                  key={o.value}
                  className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-border px-3 py-2 has-checked:border-primary has-checked:bg-primary-subtle"
                >
                  <input
                    type="radio"
                    name="role"
                    className="mt-0.5 size-5 shrink-0 accent-primary"
                    checked={role === o.value}
                    disabled={account?.isYou === true}
                    onChange={() => setRole(o.value)}
                  />
                  <span className="flex flex-col">
                    <span className="font-medium">{o.label}</span>
                    <span className="text-sm text-foreground-secondary">
                      {o.hint}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
            {role === "admin" ? null : (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1.5 text-sm font-medium">
                  Properties they work for
                </legend>
                {properties.map((p) => (
                  <label
                    key={p.propertyId}
                    className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border px-3 has-checked:border-primary has-checked:bg-primary-subtle"
                  >
                    <input
                      type="checkbox"
                      className="size-5 shrink-0 accent-primary"
                      checked={assigned.has(p.propertyId)}
                      onChange={() => toggle(p.propertyId)}
                    />
                    {p.name}
                  </label>
                ))}
              </fieldset>
            )}
            {editing ? null : (
              <Field
                id="user-password"
                label="Temporary password"
                hint="At least 8 characters. They must change it when they first sign in."
              >
                {(p) => (
                  <div className="flex gap-2">
                    <Input
                      {...p}
                      className="font-mono"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="off"
                      required
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon"
                      aria-label="Suggest another"
                      onClick={() => setPassword(suggestPassword())}
                    >
                      <Icon icon={Wand2} />
                    </Button>
                  </div>
                )}
              </Field>
            )}
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
              <Button type="submit" loading={busy}>
                {editing ? "Save" : "Add user"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({
  userId,
  name,
}: {
  userId: Id<"users">;
  name: string;
}) {
  const reset = useAction(api.accounts.resetPassword);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState<string | null>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setPassword(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary">
          <Icon icon={KeyRound} />
          Reset password
        </Button>
      </DialogTrigger>
      <DialogContent
        title={password ? `New password for ${name}` : `Reset ${name}'s password?`}
        description={
          password
            ? "Give them this temporary password in person. It's shown only once."
            : "They're signed out everywhere and get a temporary password, which they must change when they sign in."
        }
      >
        {password ? (
          <OneTimePassword password={password} />
        ) : (
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  setPassword((await reset({ userId })).temporaryPassword);
                } catch (error) {
                  toast.error(friendlyError(error));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Reset password
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DisableDialog({ account }: { account: Account }) {
  const setDisabled = useMutation(api.accounts.setDisabled);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const turningOff = !account.disabled;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" aria-label={turningOff ? `Switch off ${account.name}` : `Switch on ${account.name}`} className="px-3 sm:px-5">
          <Icon icon={Power} />
          {/* Icon only on phones, so the buttons stay on one line. */}
          <span className="hidden sm:inline">{turningOff ? "Switch off" : "Switch on"}</span>
        </Button>
      </DialogTrigger>
      <DialogContent
        title={
          turningOff ? `Switch off ${account.name}?` : `Switch ${account.name} back on?`
        }
        description={
          turningOff
            ? "They're signed out at once and can't sign in. Everything they entered stays."
            : "They can sign in again with their current password."
        }
      >
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button
            variant={turningOff ? "destructive" : "primary"}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await setDisabled({
                  userId: account.userId,
                  disabled: turningOff,
                });
                toast.success(turningOff ? "Switched off." : "Switched back on.");
                setOpen(false);
              } catch (error) {
                toast.error(friendlyError(error));
              } finally {
                setBusy(false);
              }
            }}
          >
            {turningOff ? "Switch off" : "Switch on"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
