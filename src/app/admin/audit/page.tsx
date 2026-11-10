"use client";

import { AuditLog } from "@/components/admin/audit-log";
import { PageHeader } from "@/components/ui/page-header";

export default function AuditPage() {
  return (
    <>
      <PageHeader title="Audit log" description="Every entry, list and user change, with who did it and what it was before. It can't be edited or deleted." />
      <AuditLog />
    </>
  );
}
