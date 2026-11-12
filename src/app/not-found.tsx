import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-4">
      <EmptyState
        title="Page not found"
        description="That link doesn't lead anywhere in Dine."
        action={
          <Button asChild variant="secondary">
            <Link href="/">Go to my home screen</Link>
          </Button>
        }
      />
    </main>
  );
}
