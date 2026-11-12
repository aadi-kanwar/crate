"use client";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation } from "convex/react";
import { ChevronRight, GripVertical } from "lucide-react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Icon } from "@/components/ui/icon";
import { toast } from "@/components/ui/toaster";
import { friendlyError } from "@/lib/errors";
import { cn } from "@/lib/utils";

export type TreeCategory = {
  categoryId: Id<"categories">;
  name: string;
  parentId: Id<"categories"> | null;
  archived: boolean;
  itemCount: number;
  subcategoryItemCount: number;
};

/**
 * Lists → Categories: main categories with their sub-categories, which can be
 * folded away. Rows are reordered by pressing and holding the grip on the left
 * and dragging (mouse: just drag; keyboard: focus the grip, Space, arrows,
 * Space). Main categories move among main categories, sub-categories within
 * their own category.
 */
export function CategoryTree({
  categories,
  renderActions,
  renderFlags,
}: {
  categories: TreeCategory[];
  renderActions: (category: TreeCategory) => React.ReactNode;
  renderFlags: (category: TreeCategory) => React.ReactNode;
}) {
  const reorder = useMutation(api.catalog.reorderCategories);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // While a new order is being saved, show it straight away.
  const [pending, setPending] = useState<{ parentId: string; ids: string[] } | null>(null);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    // Phones: press and hold, so scrolling the page still works.
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const ordered = (parentId: string | null) => {
    const rows = categories.filter((c) => c.parentId === parentId);
    if (pending && pending.parentId === (parentId ?? "")) {
      return pending.ids.map((id) => rows.find((r) => r.categoryId === id)).filter((r): r is TreeCategory => r !== undefined);
    }
    return rows;
  };

  const onDragEnd = (parentId: Id<"categories"> | null) => async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = ordered(parentId).map((c) => c.categoryId as string);
    const next = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    setPending({ parentId: parentId ?? "", ids: next });
    try {
      await reorder({ parentId: parentId ?? undefined, orderedIds: next as Id<"categories">[] });
    } catch (error) {
      toast.error(friendlyError(error));
    } finally {
      setPending(null);
    }
  };

  const mains = ordered(null);
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd(null)}>
      <SortableContext items={mains.map((c) => c.categoryId)} strategy={verticalListSortingStrategy}>
        <ul className="divide-y divide-border" aria-label="Categories">
          {mains.map((main) => {
            const subs = ordered(main.categoryId);
            const open = expanded.has(main.categoryId);
            return (
              <SortableRow key={main.categoryId} id={main.categoryId} label={main.name}>
                {(grip) => (
                  <>
                    <Row
                      grip={grip}
                      category={main}
                      flags={renderFlags(main)}
                      actions={renderActions(main)}
                      toggle={
                        subs.length > 0 ? (
                          <button
                            type="button"
                            onClick={() =>
                              setExpanded((prev) => {
                                const next = new Set(prev);
                                if (next.has(main.categoryId)) next.delete(main.categoryId);
                                else next.add(main.categoryId);
                                return next;
                              })
                            }
                            aria-expanded={open}
                            aria-label={`${open ? "Hide" : "Show"} sub-categories of ${main.name}`}
                            className="flex size-9 shrink-0 items-center justify-center rounded-md text-foreground-secondary hover:bg-subtle"
                          >
                            <Icon icon={ChevronRight} className={cn("transition-transform", open && "rotate-90")} />
                          </button>
                        ) : (
                          <span className="size-9 shrink-0" aria-hidden />
                        )
                      }
                      detail={
                        <>
                          {main.itemCount} {main.itemCount === 1 ? "item" : "items"}
                          {main.subcategoryItemCount > 0 ? `, ${main.subcategoryItemCount} of them in sub-categories` : ""}
                          {subs.length > 0 ? ` · ${subs.length} ${subs.length === 1 ? "sub-category" : "sub-categories"}` : ""}
                        </>
                      }
                    />
                    {open && subs.length > 0 ? (
                      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd(main.categoryId)}>
                        <SortableContext items={subs.map((c) => c.categoryId)} strategy={verticalListSortingStrategy}>
                          <ul className="divide-y divide-border border-t border-border bg-subtle/40" aria-label={`Sub-categories of ${main.name}`}>
                            {subs.map((sub) => (
                              <SortableRow key={sub.categoryId} id={sub.categoryId} label={sub.name}>
                                {(subGrip) => (
                                  <Row
                                    grip={subGrip}
                                    indent
                                    category={sub}
                                    flags={renderFlags(sub)}
                                    actions={renderActions(sub)}
                                    detail={`${sub.itemCount} ${sub.itemCount === 1 ? "item" : "items"}`}
                                  />
                                )}
                              </SortableRow>
                            ))}
                          </ul>
                        </SortableContext>
                      </DndContext>
                    ) : null}
                  </>
                )}
              </SortableRow>
            );
          })}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

/** A list item that can be dragged by its grip only. */
function SortableRow({ id, label, children }: { id: string; label: string; children: (grip: React.ReactNode) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  const grip = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      aria-label={`Move ${label} (press and hold, then drag)`}
      className="flex size-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-foreground-muted hover:bg-subtle hover:text-foreground active:cursor-grabbing"
    >
      <Icon icon={GripVertical} />
    </button>
  );
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("relative bg-surface", isDragging && "z-10 rounded-md shadow-lg ring-1 ring-border")}
    >
      {children(grip)}
    </li>
  );
}

function Row({
  grip,
  toggle,
  category,
  flags,
  actions,
  detail,
  indent = false,
}: {
  grip: React.ReactNode;
  toggle?: React.ReactNode;
  category: TreeCategory;
  flags: React.ReactNode;
  actions: React.ReactNode;
  detail: React.ReactNode;
  indent?: boolean;
}) {
  return (
    // Sub-categories sit clearly to the right of their main category's name.
    <div className={cn("flex items-center gap-1 py-1.5 pr-3", indent ? "pl-10" : "pl-1")}>
      {grip}
      {indent ? <span className="w-9 shrink-0" aria-hidden /> : toggle}
      <div className="flex min-w-0 flex-1 flex-col py-1">
        <span className="flex flex-wrap items-center gap-2 font-medium">
          {category.name}
          {flags}
        </span>
        <span className="text-sm text-foreground-secondary">{detail}</span>
      </div>
      <div className="flex shrink-0 items-center">{actions}</div>
    </div>
  );
}
