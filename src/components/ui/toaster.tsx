"use client";

import { Toaster as Sonner } from "sonner";

export { toast } from "sonner";

export function Toaster() {
  return (
    <Sonner
      position="top-center"
      toastOptions={{
        classNames: {
          toast:
            "rounded-md! border! border-border! bg-surface! text-foreground! shadow-lg! font-sans! text-sm!",
          description: "text-foreground-secondary!",
          success: "[&_[data-icon]]:text-success!",
          error: "[&_[data-icon]]:text-danger!",
        },
      }}
    />
  );
}
