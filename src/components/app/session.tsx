"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { ArrowLeft, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { toast } from "@/components/ui/toaster";
import { friendlyError } from "@/lib/errors";
import { useQuery } from "@/lib/convex";

export type Me = NonNullable<FunctionReturnType<typeof api.users.me>>;

/** undefined while loading, null when signed out. */
export function useMe() {
  return useQuery(api.users.me, {});
}

/** Which screen a person belongs on. The backend enforces the same rules. */
export function destinationFor(me: Me | null): string {
  if (me === null) return "/signin";
  if (me.mustChangePassword) return "/change-password";
  if (me.role === "admin") return "/admin";
  if (me.role === "manager" || me.role === "kitchen_staff") return "/me";
  return "/signin";
}

export function SignOutButton({ variant = "ghost", full = false }: { variant?: "ghost" | "secondary"; full?: boolean }) {
  const { signOut } = useAuthActions();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant={variant}
      width={full ? "full" : "auto"}
      className={full ? "justify-start" : undefined}
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await signOut();
          router.replace("/signin");
        } catch (error) {
          toast.error(friendlyError(error));
          setBusy(false);
        }
      }}
    >
      {busy ? null : <Icon icon={LogOut} />}
      Log out
    </Button>
  );
}

/** "← Admin Hub": shown only to master admins who arrived from the Admin Hub. */
export function AdminHubLink() {
  const me = useMe();
  if (!me?.hubLink) return null;
  return (
    <a
      href={me.hubLink}
      className="inline-flex shrink-0 items-center gap-1 rounded-sm text-xs font-medium text-foreground-secondary hover:text-foreground"
    >
      <Icon icon={ArrowLeft} className="size-3.5" />
      Admin Hub
    </a>
  );
}
