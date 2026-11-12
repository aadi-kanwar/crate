import { AlertTriangle, CheckCircle2, Info, XCircle, type LucideIcon } from "lucide-react";
import { Icon } from "./icon";
import { cn } from "@/lib/utils";

const tones: Record<string, { classes: string; icon: LucideIcon }> = {
  info: { classes: "border-info-border bg-info-subtle text-info", icon: Info },
  success: { classes: "border-success-border bg-success-subtle text-success", icon: CheckCircle2 },
  warning: { classes: "border-warning-border bg-warning-subtle text-warning", icon: AlertTriangle },
  danger: { classes: "border-danger-border bg-danger-subtle text-danger-text", icon: XCircle },
};

export function Banner({
  tone = "info",
  title,
  children,
  className,
  action,
}: {
  tone?: "info" | "success" | "warning" | "danger";
  title?: string;
  children?: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}) {
  const { classes, icon } = tones[tone];
  return (
    <div
      role={tone === "danger" || tone === "warning" ? "alert" : "status"}
      className={cn("flex items-start gap-3 rounded-md border px-4 py-3 text-sm", classes, className)}
    >
      <Icon icon={icon} className="mt-0.5" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div>{children}</div> : null}
      </div>
      {action}
    </div>
  );
}
