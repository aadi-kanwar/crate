import { ChevronDown } from "lucide-react";
import * as React from "react";
import { Icon } from "./icon";
import { inputClasses } from "./input";
import { cn } from "@/lib/utils";

/** A styled native <select>: the phone's own picker on mobile, fully keyboard accessible. */
export function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className="relative">
      <select className={cn(inputClasses, "appearance-none pr-10", className)} {...props}>
        {children}
      </select>
      <Icon
        icon={ChevronDown}
        className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-foreground-secondary"
      />
    </div>
  );
}
