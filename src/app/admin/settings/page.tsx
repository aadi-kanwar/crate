"use client";

import { OrganizationSettings } from "@/components/admin/organization-settings";
import { AccountCard } from "@/components/app/account-card";
import { PageHeader } from "@/components/ui/page-header";

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        title="Settings"
        description="Your organisation and its properties, and your own account. People are managed under Users."
      />
      <OrganizationSettings />
      <section aria-labelledby="account" className="flex flex-col gap-2">
        <h2 id="account" className="font-serif text-2xl tracking-tight">
          Your account
        </h2>
        <AccountCard />
      </section>
    </>
  );
}
