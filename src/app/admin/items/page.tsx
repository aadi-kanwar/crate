"use client";

import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";

/** Item history pages (built in the next phase). */
export default function ItemsPage() {
  return (
    <>
      <PageHeader title="Items" />
      <EmptyState title="Coming next" description="How much of each item is bought and used, and its price history." />
    </>
  );
}
