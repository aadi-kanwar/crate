import { LoaderCircle } from "lucide-react";
import { Icon } from "./icon";
import { cn } from "@/lib/utils";

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <span role={label ? "status" : undefined} className="inline-flex items-center gap-2">
      <Icon icon={LoaderCircle} className={cn("animate-spin", className)} />
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}
