"use client";

import { AccountDialog, UsersList } from "@/components/admin/users";
import { PageHeader } from "@/components/ui/page-header";

export default function UsersPage() {
  return (
    <>
      <PageHeader
        title="Users"
        description="Everyone who can sign in. Managers / Wardens and Kitchen Staff add and edit purchases for the properties you tick; Admins can do everything."
        actions={<AccountDialog />}
      />
      <UsersList />
    </>
  );
}
