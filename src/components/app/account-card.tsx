"use client";

import { KeyRound } from "lucide-react";
import Link from "next/link";
import { formatPhoneForDisplay } from "@convex/lib/inputRules";
import { useMe } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { LoadingState } from "@/components/ui/skeleton";
import { DetailList } from "@/components/ui/stat";
import { ROLE_LABEL } from "@/lib/labels";

/** Your own account: name, login, role, properties, and Change my password. */
export function AccountCard() {
  const me = useMe();
  return (
    <Card>
      <CardBody className="flex flex-col gap-4">
        {me ? (
          <DetailList
            rows={[
              { label: "Name", value: me.name ?? "—" },
              {
                label: "Mobile (login)",
                value: me.phone ? formatPhoneForDisplay(me.phone) : "—",
              },
              { label: "Role", value: me.role ? ROLE_LABEL[me.role] : "—" },
              ...(me.role !== "admin" && me.organization
                ? [
                    {
                      label: "Properties",
                      value: me.organization.properties
                        .map((p) => p.name)
                        .join(", "),
                    },
                  ]
                : []),
            ]}
          />
        ) : (
          <LoadingState rows={1} />
        )}
        <Button asChild variant="secondary" className="self-start">
          <Link href="/change-password">
            <Icon icon={KeyRound} />
            Change my password
          </Link>
        </Button>
      </CardBody>
    </Card>
  );
}
