import type { LucideIcon } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import { Icon } from "./icon";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "border-border bg-subtle text-foreground-secondary",
        primary: "border-primary-subtle-border bg-primary-subtle text-primary-text",
        success: "border-success-border bg-success-subtle text-success",
        warning: "border-warning-border bg-warning-subtle text-warning",
        danger: "border-danger-border bg-danger-subtle text-danger-text",
        info: "border-info-border bg-info-subtle text-info",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

/** Status is always icon + text, never colour alone. */
export function StatusBadge({
  tone,
  icon,
  children,
  className,
}: VariantProps<typeof badgeVariants> & {
  icon: LucideIcon;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn(badgeVariants({ tone }), className)}>
      <Icon icon={icon} className="size-3.5" />
      {children}
    </span>
  );
}
