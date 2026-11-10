"use client";

import { X } from "lucide-react";
import { Dialog as RadixDialog } from "radix-ui";
import * as React from "react";
import { Icon } from "./icon";
import { cn } from "@/lib/utils";

export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;
export const DialogClose = RadixDialog.Close;

export function DialogContent({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 z-40 bg-inverse/40" />
      <RadixDialog.Content
        className={cn(
          "fixed inset-x-4 top-1/2 z-50 mx-auto flex max-h-[85vh] max-w-md -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-md border border-border bg-surface p-5 shadow-lg",
          className,
        )}
        // Without a description Radix warns; we always pass one or opt out explicitly.
        {...(description ? {} : { "aria-describedby": undefined })}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <RadixDialog.Title className="text-lg font-semibold">{title}</RadixDialog.Title>
            {description ? (
              <RadixDialog.Description className="text-sm text-foreground-secondary">
                {description}
              </RadixDialog.Description>
            ) : null}
          </div>
          <RadixDialog.Close
            aria-label="Close"
            className="-mt-2 -mr-2 flex size-11 shrink-0 items-center justify-center rounded-md text-foreground-secondary hover:bg-subtle"
          >
            <Icon icon={X} />
          </RadixDialog.Close>
        </div>
        {children}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}

export function DialogFooter({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{children}</div>;
}
