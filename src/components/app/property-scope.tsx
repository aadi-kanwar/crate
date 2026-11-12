"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { Id } from "@convex/_generated/dataModel";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import { useMe } from "./session";

const STORAGE_KEY = "crate-admin-property";

export type OrgProperty = { propertyId: Id<"properties">; name: string };

type Scope = {
  /** Every property of the admin's organisation. */
  properties: OrgProperty[];
  /** The property chosen, or null for "All properties". Always set when there's only one. */
  current: OrgProperty | null;
  choose: (propertyId: Id<"properties"> | null) => void;
  /** The argument every admin query takes. */
  arg: { propertyId?: Id<"properties"> };
  /** The property's name, for rows that show it (only needed with more than one property). */
  nameOf: (propertyId: Id<"properties">) => string;
};

const ScopeContext = createContext<Scope | null>(null);

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Holds which property the admin screens show. Kept on this device between visits. */
export function PropertyScopeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = useMe();
  const properties = useMemo(() => me?.organization?.properties ?? [], [me]);
  const [chosen, setChosen] = useState<string | null | undefined>(() =>
    typeof window === "undefined" ? undefined : readStored(),
  );
  const choose = useCallback((propertyId: Id<"properties"> | null) => {
    setChosen(propertyId);
    try {
      if (propertyId === null) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, propertyId);
    } catch {
      // Private mode etc.: the choice lasts for this visit only.
    }
  }, []);
  const value = useMemo<Scope>(() => {
    const current =
      properties.length === 1
        ? properties[0]
        : (properties.find((p) => p.propertyId === chosen) ?? null);
    const names = new Map(
      properties.map((p) => [p.propertyId as string, p.name]),
    );
    return {
      properties,
      current,
      choose,
      arg: current ? { propertyId: current.propertyId } : {},
      nameOf: (propertyId) => names.get(propertyId) ?? "",
    };
  }, [properties, chosen, choose]);
  return (
    <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>
  );
}

export function usePropertyScope(): Scope {
  const scope = useContext(ScopeContext);
  if (scope === null)
    throw new Error(
      "usePropertyScope must be used inside PropertyScopeProvider",
    );
  return scope;
}

/** True when rows should name their property ("All properties" with more than one). */
export function useShowProperty(): boolean {
  const { properties, current } = usePropertyScope();
  return current === null && properties.length > 1;
}

/** The header's property switcher. Hidden with a single property. */
export function PropertyPicker({ className }: { className?: string }) {
  const { properties, current, choose } = usePropertyScope();
  if (properties.length <= 1) return null;
  return (
    <div className={cn("relative min-w-0", className)}>
      <label htmlFor="property-picker" className="sr-only">
        Property
      </label>
      <NativeSelect
        id="property-picker"
        className="h-10 min-h-10 max-w-44 truncate rounded-full py-0 pl-4 text-base font-medium sm:max-w-56 md:text-sm"
        value={current?.propertyId ?? ""}
        onChange={(e) =>
          choose(
            e.target.value === "" ? null : (e.target.value as Id<"properties">),
          )
        }
      >
        <option value="">All properties</option>
        {properties.map((p) => (
          <option key={p.propertyId} value={p.propertyId}>
            {p.name}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}
