"use client";

import { Eye, EyeOff } from "lucide-react";
import * as React from "react";
import { Icon } from "./icon";
import { Input } from "./input";
import { cn } from "@/lib/utils";

export function PasswordInput({ className, ...props }: Omit<React.ComponentProps<"input">, "type">) {
  const [visible, setVisible] = React.useState(false);
  return (
    <div className="relative">
      <Input type={visible ? "text" : "password"} className={cn("pr-12", className)} {...props} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-foreground-secondary hover:text-foreground"
      >
        <Icon icon={visible ? EyeOff : Eye} />
      </button>
    </div>
  );
}
