"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  applyThemeChoice,
  readThemeChoice,
  subscribeToThemeChoice,
  type ThemeChoice,
} from "@/lib/theme";

const NEXT: Record<ThemeChoice, ThemeChoice> = {
  system: "light",
  light: "dark",
  dark: "system",
};
const LABEL: Record<ThemeChoice, string> = {
  system: "Same as device",
  light: "Light",
  dark: "Dark",
};
const ICON = { system: Monitor, light: Sun, dark: Moon } as const;

/** Light / dark / same as device. Each tap moves to the next. */
export function ThemeToggle({ full = false }: { full?: boolean }) {
  const choice = useSyncExternalStore(
    subscribeToThemeChoice,
    readThemeChoice,
    () => "system" as const,
  );
  const change = () => applyThemeChoice(NEXT[choice]);
  if (full) {
    return (
      <Button
        variant="ghost"
        width="full"
        className="justify-start"
        onClick={change}
      >
        <Icon icon={ICON[choice]} />
        Theme: {LABEL[choice]}
      </Button>
    );
  }
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={change}
      aria-label={`Theme: ${LABEL[choice]}. Change theme`}
      title={`Theme: ${LABEL[choice]}`}
    >
      <Icon icon={ICON[choice]} />
    </Button>
  );
}
