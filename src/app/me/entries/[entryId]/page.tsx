"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import type { Id } from "@convex/_generated/dataModel";
import { useMemberProperty } from "@/components/app/member-property";
import { EntryDetail } from "@/components/entry/entry-detail";
import { Icon } from "@/components/ui/icon";

export default function MemberEntryPage() {
  const { entryId } = useParams<{ entryId: string }>();
  const router = useRouter();
  const { properties } = useMemberProperty();
  return (
    <>
      <Link href="/me" className="inline-flex items-center gap-1 text-sm font-medium text-foreground-secondary hover:text-foreground">
        <Icon icon={ArrowLeft} className="size-4" />
        Home
      </Link>
      <EntryDetail entryId={entryId as Id<"entries">} properties={properties} onDeleted={() => router.push("/me")} />
    </>
  );
}
