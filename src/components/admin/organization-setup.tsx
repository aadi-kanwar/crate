"use client";

import { Building2 } from "lucide-react";
import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import { SignOutButton } from "@/components/app/session";
import { Brand } from "@/components/app/brand";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { friendlyError } from "@/lib/errors";

/** Shown to an admin until they name their organisation and its first property. */
export function OrganizationSetup() {
  const create = useMutation(api.organization.create);
  const [name, setName] = useState("");
  const [propertyName, setPropertyName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-6 px-4 py-10">
      <Brand />
      <Card>
        <CardBody className="flex flex-col gap-5">
          <div className="flex items-start gap-3">
            <Icon icon={Building2} className="mt-1 text-foreground-secondary" />
            <div className="flex flex-col gap-1">
              <h1 className="font-serif text-2xl tracking-tight">
                Set up your organisation
              </h1>
              <p className="text-sm text-foreground-secondary">
                Your organisation is your business. Purchases are logged for each
                property (PG) in it. You can add more properties later in Settings.
              </p>
            </div>
          </div>
          <form
            className="flex flex-col gap-4"
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              setError(null);
              try {
                await create({ name, propertyName });
              } catch (err) {
                setError(friendlyError(err));
                setBusy(false);
              }
            }}
          >
            <Field
              id="org-name"
              label="Organisation name"
              hint="For example, Livoza Stays"
            >
              {(props) => (
                <Input
                  {...props}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="organization"
                  required
                />
              )}
            </Field>
            <Field
              id="property-name"
              label="First property"
              hint="For example, Livoza Koramangala"
            >
              {(props) => (
                <Input
                  {...props}
                  value={propertyName}
                  onChange={(e) => setPropertyName(e.target.value)}
                  required
                />
              )}
            </Field>
            {error ? (
              <p className="text-sm text-danger-text" role="alert">
                {error}
              </p>
            ) : null}
            <Button type="submit" loading={busy}>
              Create organisation
            </Button>
          </form>
        </CardBody>
      </Card>
      <div className="flex justify-center">
        <SignOutButton variant="secondary" />
      </div>
    </main>
  );
}
