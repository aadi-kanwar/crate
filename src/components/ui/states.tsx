"use client";

import { Inbox, Lock, RotateCw, TriangleAlert, type LucideIcon } from "lucide-react";
import { Button } from "./button";
import { Icon } from "./icon";
import { cn } from "@/lib/utils";

function StateFrame({
  icon,
  title,
  description,
  action,
  tone = "neutral",
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  tone?: "neutral" | "danger";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-md border border-dashed border-border-strong px-6 py-10 text-center",
        className,
      )}
    >
      <span
        className={cn(
          "flex size-10 items-center justify-center rounded-full",
          tone === "danger" ? "bg-danger-subtle text-danger-text" : "bg-subtle text-foreground-secondary",
        )}
      >
        <Icon icon={icon} />
      </span>
      <div className="flex max-w-sm flex-col gap-1">
        <p className="font-medium">{title}</p>
        {description ? <div className="text-sm text-foreground-secondary">{description}</div> : null}
      </div>
      {action}
    </div>
  );
}

export function EmptyState(props: {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  icon?: LucideIcon;
}) {
  return <StateFrame icon={props.icon ?? Inbox} {...props} />;
}

export function ErrorState({
  title = "Something went wrong",
  description = "This part of the page couldn't load.",
  onRetry,
}: {
  title?: string;
  description?: React.ReactNode;
  onRetry?: () => void;
}) {
  return (
    <StateFrame
      icon={TriangleAlert}
      tone="danger"
      title={title}
      description={description}
      action={
        onRetry ? (
          <Button variant="secondary" onClick={onRetry}>
            <Icon icon={RotateCw} />
            Try again
          </Button>
        ) : null
      }
    />
  );
}

export function NotAuthorizedState({ description }: { description?: React.ReactNode }) {
  return (
    <StateFrame
      icon={Lock}
      title="You don't have access to this page"
      description={description ?? "If you think you should, ask an admin."}
    />
  );
}
