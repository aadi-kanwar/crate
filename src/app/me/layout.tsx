"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { MemberPropertyProvider } from "@/components/app/member-property";
import { MemberShell } from "@/components/app/member-shell";
import { destinationFor, SignOutButton, useMe } from "@/components/app/session";
import { LoadingState } from "@/components/ui/skeleton";
import { NotAuthorizedState } from "@/components/ui/states";

/** Manager / Warden and Kitchen Staff screens. Admins have their own (/admin). */
export default function MemberLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = useMe();
  const router = useRouter();
  useEffect(() => {
    if (me === null) router.replace("/signin");
    else if (me && (me.mustChangePassword || me.role === "admin"))
      router.replace(destinationFor(me));
  }, [me, router]);
  if (
    me === undefined ||
    me === null ||
    me.mustChangePassword ||
    me.role === "admin"
  ) {
    return (
      <MemberShell>
        <LoadingState rows={3} />
      </MemberShell>
    );
  }
  if (
    (me.role !== "manager" && me.role !== "kitchen_staff") ||
    !me.organization ||
    me.organization.properties.length === 0
  ) {
    return (
      <MemberShell>
        <NotAuthorizedState description="Your account isn't linked to a property yet. Please ask an admin." />
        <div className="flex justify-center">
          <SignOutButton variant="secondary" />
        </div>
      </MemberShell>
    );
  }
  return (
    <MemberPropertyProvider>
      <MemberShell nav>{children}</MemberShell>
    </MemberPropertyProvider>
  );
}
