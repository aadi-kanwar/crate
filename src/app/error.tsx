"use client";

import { ErrorState, NotAuthorizedState } from "@/components/ui/states";
import { friendlyError, parseAppError } from "@/lib/errors";

export default function RouteError({ error, reset }: { error: Error; reset: () => void }) {
  const appError = parseAppError(error);
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-4">
      {appError?.code === "FORBIDDEN" ? (
        <NotAuthorizedState />
      ) : (
        <ErrorState description={friendlyError(error)} onRetry={reset} />
      )}
    </main>
  );
}
