/**
 * Categories with one level of sub-categories (e.g. Grocery › Pulses).
 * Pure helpers shared by the lists, history and shopping list.
 */
type Row = { _id: string; name: string; parentId?: string; sortOrder: number };

/** Top-level categories in order, each followed by its sub-categories in order. */
export function orderedCategories<T extends Row>(rows: readonly T[]): T[] {
  const bySort = (a: T, b: T) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
  const ids = new Set(rows.map((r) => r._id));
  const tops = rows.filter((r) => !r.parentId || !ids.has(r.parentId)).sort(bySort);
  const out: T[] = [];
  for (const top of tops) {
    out.push(top);
    out.push(...rows.filter((r) => r.parentId === top._id).sort(bySort));
  }
  return out;
}

/** "Grocery" or "Grocery › Pulses", by id. */
export function categoryLabels(rows: readonly Row[]): Map<string, string> {
  const byId = new Map(rows.map((r) => [r._id, r]));
  return new Map(
    rows.map((r) => {
      const parent = r.parentId ? byId.get(r.parentId) : undefined;
      return [r._id, parent ? `${parent.name} › ${r.name}` : r.name];
    }),
  );
}

/** A category and all its sub-categories (for "everything in Grocery"). */
export function withSubcategories(rows: readonly Row[], id: string): string[] {
  return [id, ...rows.filter((r) => r.parentId === id).map((r) => r._id)];
}

/** Position of each category in `orderedCategories` (for sorting lists by category). */
export function categoryRank(rows: readonly Row[]): Map<string, number> {
  return new Map(orderedCategories(rows).map((r, i) => [r._id, i]));
}

/**
 * Item counts where a main category includes everything in its
 * sub-categories: { total, inSubcategories } by category id.
 */
export function countsWithSubcategories(
  rows: readonly Row[],
  direct: ReadonlyMap<string, number>,
): Map<string, { total: number; inSubcategories: number }> {
  const out = new Map<string, { total: number; inSubcategories: number }>();
  for (const row of rows) {
    const own = direct.get(row._id) ?? 0;
    const inSubcategories = rows
      .filter((r) => r.parentId === row._id)
      .reduce((sum, r) => sum + (direct.get(r._id) ?? 0), 0);
    out.set(row._id, { total: own + inSubcategories, inSubcategories });
  }
  return out;
}
