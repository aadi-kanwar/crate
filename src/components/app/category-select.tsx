"use client";

import { Field } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";

type Category = { categoryId: string; name: string; parentId: string | null; archived?: boolean };

/**
 * Two dropdowns: the main category, and its sub-category (shown only when the
 * chosen main category has sub-categories). `value` is the chosen category's
 * id: a main category, or one of its sub-categories.
 *
 * - filter: both start at "All"; choosing a main category alone means it and
 *   all its sub-categories.
 * - form: a main category is required; the sub-category is optional ("None").
 */
export function CategorySelect({
  categories,
  value,
  onChange,
  idPrefix,
  mode,
  className,
}: {
  categories: readonly Category[];
  value: string;
  onChange: (categoryId: string) => void;
  idPrefix: string;
  mode: "filter" | "form";
  className?: string;
}) {
  const chosen = categories.find((c) => c.categoryId === value);
  const mainId = chosen ? (chosen.parentId ?? chosen.categoryId) : "";
  const subId = chosen?.parentId ? chosen.categoryId : "";
  const mains = categories.filter((c) => c.parentId === null);
  const subs = categories.filter((c) => c.parentId !== null && c.parentId === mainId);
  return (
    <div className={className ?? "contents"}>
      <Field id={`${idPrefix}-category`} label="Category">
        {(p) => (
          <NativeSelect {...p} value={mainId} onChange={(e) => onChange(e.target.value)}>
            {mode === "filter" ? <option value="">All categories</option> : null}
            {mains.map((c) => (
              <option key={c.categoryId} value={c.categoryId}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>
      {subs.length > 0 ? (
        <Field id={`${idPrefix}-subcategory`} label="Sub-category">
          {(p) => (
            <NativeSelect {...p} value={subId} onChange={(e) => onChange(e.target.value || mainId)}>
              <option value="">{mode === "filter" ? "All sub-categories" : "None"}</option>
              {subs.map((c) => (
                <option key={c.categoryId} value={c.categoryId}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
      ) : null}
    </div>
  );
}
