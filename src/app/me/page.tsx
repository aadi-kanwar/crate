"use client";

import { SquarePlus } from "lucide-react";
import { Eyebrow } from "@/components/app/brand";
import { useMemberProperty } from "@/components/app/member-property";
import { useMe } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { EmptyState } from "@/components/ui/states";
import { formatDay, todayIn } from "@/lib/format";

/** Home for managers and kitchen staff. Entries arrive in the next phase. */
export default function MemberHome() {
  const me = useMe();
  const { current } = useMemberProperty();
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
      <Button width="full" className="min-h-14 text-base" disabled>
        <Icon icon={SquarePlus} />
        New entry
      </Button>
      <EmptyState
        title="No entries yet"
        description="Purchases you log will show here."
      />
    </>
  );
}
