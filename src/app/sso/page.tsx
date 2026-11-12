"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { ArrowLeft, Clock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@convex/_generated/api";
import { Brand } from "@/components/app/brand";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/states";
import { useQuery } from "@/lib/convex";

/**
 * Admin Hub single sign-on. The hub sends master admins here with a one-time
 * ticket after "#ticket=" (the part after # never reaches any server log).
 * The ticket is removed from the address bar at once, then used to sign in.
 * Any failure shows the same message: the reason is never revealed.
 */
export default function SsoPage() {
  const { signIn } = useAuthActions();
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const ticket = new URLSearchParams(window.location.hash.slice(1)).get("ticket");
    window.history.replaceState(null, "", window.location.pathname);
    // A missing ticket goes through the same path as a bad one (same message).
    Promise.resolve(ticket ? signIn("hub-sso", { ticket }) : Promise.reject(new Error("no ticket")))
      .then(() => router.replace("/"))
      .catch(() => setFailed(true));
  }, [signIn, router]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center gap-6 px-4 py-6">
      <Brand size="lg" />
      {failed ? <Expired /> : <Spinner label="Signing you in from the Admin Hub" />}
    </main>
  );
}

function Expired() {
  const hubOrigin = useQuery(api.sso.hubOrigin, {});
  return (
    <EmptyState
      icon={Clock}
      title="This link has expired"
      description="Open it again from the Admin Hub."
      action={
        hubOrigin ? (
          <Button asChild variant="secondary">
            <a href={hubOrigin}>
              <Icon icon={ArrowLeft} />
              Back to the Admin Hub
            </a>
          </Button>
        ) : null
      }
    />
  );
}
