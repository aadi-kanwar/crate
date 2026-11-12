"use client";

import { SquarePlus } from "lucide-react";
import Link from "next/link";
import { api } from "@convex/_generated/api";
import { Eyebrow } from "@/components/app/brand";
import { useMemberProperty } from "@/components/app/member-property";
import { useMe } from "@/components/app/session";
import { EntryList } from "@/components/entry/entry-list";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { LoadingState } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/states";
import { useQuery } from "@/lib/convex";
import { formatDay, todayIn } from "@/lib/format";

/** Home for managers and kitchen staff: New entry, and recent entries for their properties. */
export default function MemberHome() {
  const me = useMe();
  const { current, properties } = useMemberProperty();
  const entries = useQuery(api.entries.recent, { limit: 40 });
  const firstName = (me?.name ?? "").split(" ")[0];
  return (
    <>
      <div className="flex flex-col gap-1">
        <Eyebrow>{formatDay(todayIn(), "EEEE d MMMM")}</Eyebrow>
        <h1 className="font-serif text-3xl tracking-tight">
          Hello, <em className="text-primary-soft">{firstName}.</em>
        </h1>
        <p className="text-sm text-foreground-secondary">{current?.name}</p>
      </div>
      <Button asChild width="full" className="min-h-16 text-lg">
        <Link href="/me/new">
          <Icon icon={SquarePlus} />
          New entry
        </Link>
      </Button>
      <section aria-labelledby="recent" className="flex flex-col gap-2">
        <h2 id="recent" className="font-serif text-2xl tracking-tight">
          Recent entries
        </h2>
        {entries === undefined ? (
          <LoadingState rows={3} />
        ) : entries.length === 0 ? (
          <EmptyState title="No entries yet" description="Purchases logged for your properties will show here." />
        ) : (
          <EntryList entries={entries} hrefFor={(id) => `/me/entries/${id}`} showScope={properties.length > 1 || entries.some((e) => e.scopeKey === "shared")} />
        )}
        <p className="text-xs text-foreground-secondary">Entries can be changed for 24 hours. After that they&apos;re locked and only an admin can change them.</p>
      </section>
    </>
  );
}
