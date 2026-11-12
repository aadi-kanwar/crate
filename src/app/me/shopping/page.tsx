"use client";

import { useMemberProperty } from "@/components/app/member-property";
import { ShoppingList } from "@/components/list/shopping-list";

/** Managers / kitchen staff: the lists of their properties, and the Shared list. */
export default function MemberShoppingPage() {
  const { properties, current } = useMemberProperty();
  const lists = [
    ...properties.map((p) => ({ key: p.propertyId as string, name: p.name, scope: { kind: "property" as const, propertyId: p.propertyId } })),
    { key: "shared", name: "Shared (whole organisation)", scope: { kind: "shared" as const } },
  ];
  return (
    <>
      <h1 className="font-serif text-3xl tracking-tight">Shopping list</h1>
      <ShoppingList key={current?.propertyId ?? "none"} lists={lists} initialScope={current?.propertyId ?? "shared"} />
    </>
  );
}
