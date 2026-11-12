"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { destinationFor, useMe } from "@/components/app/session";
import { Spinner } from "@/components/ui/spinner";

/** Sends everyone to the right screen. */
export default function Home() {
  const me = useMe();
  const router = useRouter();
  useEffect(() => {
    if (me !== undefined) router.replace(destinationFor(me));
  }, [me, router]);
  return (
    <main className="flex min-h-dvh items-center justify-center text-foreground-secondary">
      <Spinner label="Loading" />
    </main>
  );
}
