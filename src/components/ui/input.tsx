import * as React from "react";
import { cn } from "@/lib/utils";

export const inputClasses =
  "h-11 w-full min-w-0 rounded-md border border-border-strong bg-surface px-3 text-base text-foreground transition-colors placeholder:text-foreground-muted hover:border-disabled disabled:cursor-not-allowed disabled:bg-subtle disabled:text-foreground-muted aria-invalid:border-danger";

export function Input({ className, type = "text", ...props }: React.ComponentProps<"input">) {
  return <input type={type} className={cn(inputClasses, className)} {...props} />;
}
