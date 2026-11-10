"use client";

import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";

/** The entries log (built in a later phase). */
export default function EntriesPage() {
  return (
    <>
      <PageHeader title="Entries" />
      <EmptyState
        title="No entries yet"
        description="Purchases logged by your team will show here."
      />
    </>
  );
}
