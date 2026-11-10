"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { OrganizationSetup } from "@/components/admin/organization-setup";
import { AppFrame } from "@/components/app/app-frame";
import { Brand } from "@/components/app/brand";
import {
  PropertyPicker,
  PropertyScopeProvider,
} from "@/components/app/property-scope";
import {
  destinationFor,
  SignOutButton,
  useMe,
  AdminHubLink,
} from "@/components/app/session";
import { ADMIN_NAV } from "@/components/nav/nav-items";
import { AppSidebar, BottomNav } from "@/components/nav/app-nav";
import { LoadingState } from "@/components/ui/skeleton";
import { NotAuthorizedState } from "@/components/ui/states";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = useMe();
  const router = useRouter();
  useEffect(() => {
    if (me === null) router.replace("/signin");
    else if (me?.mustChangePassword) router.replace(destinationFor(me));
  }, [me, router]);

  if (me === undefined || me === null || me.mustChangePassword) {
    return (
      <div className="mx-auto max-w-5xl p-4">
        <LoadingState />
      </div>
    );
  }
  if (me.role !== "admin") {
    return (
      <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-4 px-4">
        <NotAuthorizedState description="This area is for admins only." />
        <div className="flex justify-center">
          <SignOutButton variant="secondary" />
        </div>
      </main>
    );
  }

  if (me.organization === null) return <OrganizationSetup />;

  return (
    <PropertyScopeProvider>
      <AppFrame
        header={
          <header className="border-b border-border bg-surface print:hidden">
            <div className="flex h-14 items-center justify-between gap-3 px-4">
              <div className="flex min-w-0 items-center gap-3">
                <Brand />
                <span className="hidden truncate border-l border-border pl-3 text-xs text-foreground-secondary lg:block">
                  {me.organization.name} · {me.name} (Admin)
                </span>
              </div>
              <div className="flex min-w-0 items-center gap-2">
                <AdminHubLink />
                <PropertyPicker />
                {/* On phones, Log out is in the bottom bar's More menu. */}
                <span className="hidden md:block">
                  <SignOutButton />
                </span>
              </div>
            </div>
          </header>
        }
        sidebar={<AppSidebar items={ADMIN_NAV} />}
        nav={
          <BottomNav
            items={ADMIN_NAV.filter((item) => item.mobile !== false)}
            more={{
              items: ADMIN_NAV.filter((item) => item.mobile === false),
              footer: <SignOutButton variant="ghost" full />,
            }}
          />
        }
      >
        <main className="px-4 pt-6 pb-10 md:px-8 print:p-0">
          <div className="mx-auto flex max-w-5xl flex-col gap-6">
            {children}
          </div>
        </main>
      </AppFrame>
    </PropertyScopeProvider>
  );
}
