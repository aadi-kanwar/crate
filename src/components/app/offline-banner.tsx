"use client";

import { useConvexConnectionState } from "convex/react";
import { useEffect, useState } from "react";
import { Banner } from "@/components/ui/banner";

/** Shows a banner when the browser is offline or the live connection drops. */
export function OfflineBanner() {
  const connection = useConvexConnectionState();
  const [online, setOnline] = useState(true);
  const [graceOver, setGraceOver] = useState(false);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    // Don't flash the banner while the first connection is being made.
    const timer = window.setTimeout(() => setGraceOver(true), 4000);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      window.clearTimeout(timer);
    };
  }, []);

  const disconnected = graceOver && !connection.isWebSocketConnected;
  if (online && !disconnected) return null;
  return (
    <div className="fixed inset-x-0 top-0 z-50 p-2">
      <Banner tone="warning" title="You’re offline">
        Changes can&apos;t be saved until the connection is back. We&apos;ll reconnect automatically.
      </Banner>
    </div>
  );
}
