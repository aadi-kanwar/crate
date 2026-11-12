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

const STORAGE_KEY = "crate-property";

export type MemberProperty = { propertyId: Id<"properties">; name: string };

type Current = {
  /** The properties this person works for. */
  properties: MemberProperty[];
  /** The one they're working on now (the first, until they choose). Null if none is assigned. */
  current: MemberProperty | null;
  choose: (propertyId: Id<"properties">) => void;
};

const CurrentContext = createContext<Current | null>(null);

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * The property a manager or kitchen staff member is working on (new entries
 * default to it). Remembered on this device.
 */
export function MemberPropertyProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = useMe();
  const properties = useMemo(() => me?.organization?.properties ?? [], [me]);
  const [chosen, setChosen] = useState<string | null>(() =>
    typeof window === "undefined" ? null : readStored(),
  );
  const choose = useCallback((propertyId: Id<"properties">) => {
    setChosen(propertyId);
    try {
      localStorage.setItem(STORAGE_KEY, propertyId);
    } catch {
      // Private mode etc.: the choice lasts for this visit only.
    }
  }, []);
  const value = useMemo<Current>(
    () => ({
      properties,
      current:
        properties.find((p) => p.propertyId === chosen) ??
        properties[0] ??
        null,
      choose,
    }),
    [properties, chosen, choose],
  );
  return (
    <CurrentContext.Provider value={value}>{children}</CurrentContext.Provider>
  );
}

export function useMemberProperty(): Current {
  const value = useContext(CurrentContext);
  if (value === null)
    throw new Error(
      "useMemberProperty must be used inside MemberPropertyProvider",
    );
  return value;
}

/** Header switcher; hidden for people with a single property. */
export function MemberPropertyPicker({ className }: { className?: string }) {
  const { properties, current, choose } = useMemberProperty();
  if (properties.length <= 1) return null;
  return (
    <div className={cn("relative min-w-0", className)}>
      <label htmlFor="member-property" className="sr-only">
        Property
      </label>
      <NativeSelect
        id="member-property"
        className="h-10 min-h-10 max-w-44 truncate rounded-full py-0 pl-4 text-base font-medium"
        value={current?.propertyId ?? ""}
        onChange={(e) => choose(e.target.value as Id<"properties">)}
      >
        {properties.map((p) => (
          <option key={p.propertyId} value={p.propertyId}>
            {p.name}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}
