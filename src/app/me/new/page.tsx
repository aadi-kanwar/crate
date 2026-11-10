"use client";

import { useRouter } from "next/navigation";
import { useMemberProperty } from "@/components/app/member-property";
import { EntryForm } from "@/components/entry/entry-form";

export default function NewEntryPage() {
  const router = useRouter();
  const { properties, current } = useMemberProperty();
  return (
    <>
      <h1 className="font-serif text-3xl tracking-tight">New entry</h1>
      <EntryForm
        // A fresh form for each property chosen at the top.
        key={current?.propertyId ?? "none"}
        properties={properties}
        defaultPropertyId={current?.propertyId ?? null}
        onDone={() => router.push("/me")}
        onCancel={() => router.push("/me")}
      />
    </>
  );
}
