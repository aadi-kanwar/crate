"use client";

import { MEMBER_NAV } from "@/components/nav/nav-items";
import { BottomNav } from "@/components/nav/app-nav";
import { AppFrame } from "./app-frame";
import { Brand } from "./brand";
import { MemberPropertyPicker } from "./member-property";
import { SignOutButton } from "./session";

/**
 * Frame for manager / kitchen staff screens (phone-first): app name and
 * property switcher on top, the bottom navigation on every screen size.
 * Without `nav` (e.g. while loading), a logout button sits in the header.
 */
export function MemberShell({
  nav = false,
  children,
}: {
  nav?: boolean;
  children: React.ReactNode;
}) {
  return (
    <AppFrame
      header={
        <header className="border-b border-border bg-surface">
          <div className="mx-auto flex h-14 max-w-lg items-center justify-between gap-3 px-4">
            <Brand />
            {nav ? <MemberPropertyPicker /> : <SignOutButton />}
          </div>
        </header>
      }
      nav={nav ? <BottomNav items={MEMBER_NAV} everywhere /> : null}
    >
      <main className="mx-auto flex min-h-full w-full max-w-lg flex-col gap-6 px-4 py-6">
        {children}
      </main>
    </AppFrame>
  );
}
