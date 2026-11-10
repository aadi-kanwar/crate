"use client";

import { MasterLists } from "@/components/admin/lists";
import { PageHeader } from "@/components/ui/page-header";

export default function ListsPage() {
  return (
    <>
      <PageHeader title="Lists" description="Items, shops and categories, shared by every property. New ones added during entries wait under “To check”." />
      <MasterLists />
    </>
  );
}
