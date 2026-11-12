"use client";

import { AccountCard } from "@/components/app/account-card";
import { SignOutButton } from "@/components/app/session";

export default function MemberAccountPage() {
  return (
    <>
      <h1 className="font-serif text-3xl tracking-tight">Your account</h1>
      <AccountCard />
      <SignOutButton variant="secondary" />
    </>
  );
}
