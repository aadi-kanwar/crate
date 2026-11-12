"use client";

import { useMemberProperty } from "@/components/app/member-property";
import { ShoppingList } from "@/components/list/shopping-list";

/** Managers / kitchen staff: the lists of their properties, and the Shared list. */
export default function MemberShoppingPage() {
  const { current } = useMemberProperty();
  // The property comes from the picker at the top of the screen; here it's that property or Shared.
  const lists = [
    ...(current ? [{ key: current.propertyId as string, name: current.name, scope: { kind: "property" as const, propertyId: current.propertyId } }] : []),
    { key: "shared", name: "Shared", scope: { kind: "shared" as const } },
  ];
  return (
    <>
      <h1 className="font-serif text-3xl tracking-tight">Shopping list</h1>
      <ShoppingList key={current?.propertyId ?? "none"} lists={lists} initialScope={current?.propertyId ?? "shared"} />
    </>
  );
}
