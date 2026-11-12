"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import type { Id } from "@convex/_generated/dataModel";
import { usePropertyScope } from "@/components/app/property-scope";
import { EntryDetail } from "@/components/entry/entry-detail";
import { Icon } from "@/components/ui/icon";

/** Admin: one entry, with full edit (including its date) and delete at any time. */
export default function AdminEntryPage() {
  const { entryId } = useParams<{ entryId: string }>();
  const router = useRouter();
  const { properties } = usePropertyScope();
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <Link href="/admin" className="inline-flex items-center gap-1 text-sm font-medium text-foreground-secondary hover:text-foreground">
        <Icon icon={ArrowLeft} className="size-4" />
        Entries
      </Link>
      <EntryDetail entryId={entryId as Id<"entries">} properties={properties} onDeleted={() => router.push("/admin")} />
    </div>
  );
}
