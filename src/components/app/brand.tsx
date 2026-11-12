import Image from "next/image";
import livozaLogo from "../../../public/livoza-logo.png";
import { cn } from "@/lib/utils";

/** The app name with the Livoza logo: [Livoza logo] | Crate. */
export function Brand({ size = "md", className }: { size?: "md" | "lg"; className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center", size === "lg" ? "gap-3" : "gap-2", className)}>
      <Image
        src={livozaLogo}
        alt="Livoza"
        priority
        className={cn("w-auto", size === "lg" ? "h-14" : "h-9")}
      />
      <span
        className={cn(
          "border-l border-border font-serif leading-none text-primary-text",
          size === "lg" ? "pl-3 text-3xl" : "pl-2 text-2xl",
        )}
      >
        Crate
      </span>
    </span>
  );
}

/** A small uppercase section label with a leading dash, as on livoza.org ("— THE ROOMS"). */
export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("text-xs font-medium tracking-widest text-primary-text uppercase", className)}>
      — {children}
    </span>
  );
}
