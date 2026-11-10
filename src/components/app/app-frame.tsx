"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * The screen frame for signed-in screens: header at the top, bottom bar at
 * the bottom, and only the part in between scrolls. The page itself never
 * scrolls, so on phones the bars can't drift (address bar showing/hiding,
 * overscroll bounce, sideways panning) and nothing scrolls sideways.
 */
export function AppFrame({
  header,
  sidebar,
  nav,
  children,
}: {
  header: React.ReactNode;
  sidebar?: React.ReactNode;
  nav?: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const scroller = useRef<HTMLDivElement>(null);
  // A new screen starts at the top (the browser only does this for page scrolling).
  useEffect(() => {
    scroller.current?.scrollTo(0, 0);
  }, [pathname]);
  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-background print:static print:block print:overflow-visible">
      <div className="shrink-0">{header}</div>
      <div className="flex min-h-0 flex-1 print:block">
        {sidebar}
        <div
          ref={scroller}
          className={cn(
            "min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain",
            "print:overflow-visible",
          )}
        >
          {children}
        </div>
      </div>
      {nav ? <div className="shrink-0">{nav}</div> : null}
    </div>
  );
}
