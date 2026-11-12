import { Search } from "lucide-react";
import { Icon } from "./icon";
import { Input } from "./input";
import { cn } from "@/lib/utils";

export function FilterBar({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      role="group"
      aria-label="Filters"
      className={cn("flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end", className)}
    >
      {children}
    </div>
  );
}

export function SearchInput({
  label,
  ...props
}: Omit<React.ComponentProps<"input">, "type"> & { label: string }) {
  return (
    <div className="relative min-w-0 sm:w-72">
      <Icon
        icon={Search}
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-foreground-muted"
      />
      <Input type="search" aria-label={label} className="pl-10" {...props} />
    </div>
  );
}
