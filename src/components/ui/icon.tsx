import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Every icon in the app goes through here: one size, one stroke width. */
export function Icon({ icon: IconComponent, className }: { icon: LucideIcon; className?: string }) {
  return (
    <IconComponent aria-hidden="true" strokeWidth={1.75} className={cn("size-4.5 shrink-0", className)} />
  );
}
