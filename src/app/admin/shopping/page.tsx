"use client";

import { usePropertyScope } from "@/components/app/property-scope";
import { ShoppingList } from "@/components/list/shopping-list";
import { PageHeader } from "@/components/ui/page-header";

/** Admin: every property's shopping list, and the Shared list. */
export default function AdminShoppingPage() {
  const { properties, current } = usePropertyScope();
  const lists = [
    ...properties.map((p) => ({ key: p.propertyId as string, name: p.name, scope: { kind: "property" as const, propertyId: p.propertyId } })),
    { key: "shared", name: "Shared (whole organisation)", scope: { kind: "shared" as const } },
  ];
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <PageHeader
        title="Shopping list"
        description="One live list per property and one Shared list. Plan in List, tick off in Buy, then save the purchases."
      />
      <ShoppingList key={current?.propertyId ?? "all"} lists={lists} initialScope={current?.propertyId ?? properties[0]?.propertyId ?? "shared"} />
    </div>
  );
}
