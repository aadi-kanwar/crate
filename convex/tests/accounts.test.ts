import { describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import {
  PASSWORD,
  addProperty,
  createAdmin,
  createMember,
  errorCode,
  nextPhone,
  setupTest,
} from "./harness.test-utils";

describe("the organisation", () => {
  test("starts with the five categories, in order", async () => {
    const t = await setupTest();
    const admin = await createAdmin(t);
    const categories = await t.run((ctx) =>
      ctx.db
        .query("categories")
        .withIndex("by_org_order", (q) =>
          q.eq("organizationId", admin.organizationId),
        )
        .collect(),
    );
    expect(categories.map((c) => c.name)).toEqual([
      "Grocery",
      "Fruits & Vegetables",
      "Dairy",
      "Kitchen Supplies",
      "Utility (LPG)",
    ]);
  });

  test("there is only ever one", async () => {
    const t = await setupTest();
    await createAdmin(t);
    expect(await errorCode(createAdmin(t, "Second", "Another Org"))).toBe(
      "CONFLICT",
    );
    expect(
      await t.run((ctx) => ctx.db.query("organizations").collect()),
    ).toHaveLength(1);
  });
});

describe("accounts", () => {
  test("managers and kitchen staff need at least one property of the organisation", async () => {
    const t = await setupTest();
    const admin = await createAdmin(t);
    const base = {
      name: "Asha Devi",
      role: "manager" as const,
      temporaryPassword: PASSWORD,
    };
    expect(
      await errorCode(
        admin.as.action(api.accounts.create, {
          ...base,
          phone: nextPhone(),
          assignedPropertyIds: [],
        }),
      ),
    ).toBe("INVALID_INPUT");
    // No half-made login is left behind.
    expect(
      (await t.run((ctx) => ctx.db.query("users").collect())).filter(
        (u) => u.role === undefined,
      ),
    ).toHaveLength(0);
  });

  test("a weak temporary password is refused", async () => {
    const t = await setupTest();
    const admin = await createAdmin(t);
    expect(
      await errorCode(
        admin.as.action(api.accounts.create, {
          name: "Asha Devi",
          phone: nextPhone(),
          role: "kitchen_staff",
          assignedPropertyIds: [admin.propertyId],
          temporaryPassword: "short",
        }),
      ),
    ).toBe("WEAK_PASSWORD");
  });

  test("can be assigned several properties, and see only those", async () => {
    const t = await setupTest();
    const admin = await createAdmin(t);
    const second = await addProperty(t, admin, "South PG");
    await addProperty(t, admin, "East PG");
    const member = await createMember(t, admin, {
      propertyIds: [admin.propertyId, second],
    });
    const me = await member.as.query(api.users.me, {});
    expect(me?.organization?.properties.map((p) => p.name)).toEqual([
      "Main PG",
      "South PG",
    ]);
    const adminMe = await admin.as.query(api.users.me, {});
    expect(adminMe?.organization?.properties).toHaveLength(3);
  });

  test("admin edits role and properties; it is audited with before and after", async () => {
    const t = await setupTest();
    const admin = await createAdmin(t);
    const second = await addProperty(t, admin, "South PG");
    const member = await createMember(t, admin);
    await admin.as.mutation(api.accounts.update, {
      userId: member.userId,
      name: "Renamed Person",
      role: "manager",
      assignedPropertyIds: [second],
    });
    const user = await t.run((ctx) => ctx.db.get(member.userId));
    expect(user).toMatchObject({
      name: "Renamed Person",
      role: "manager",
      propertyIds: [second],
    });
    const audit = (await t.run((ctx) => ctx.db.query("auditLog").collect()))
      .filter((a) => a.action === "account.updated")
      .at(-1);
    expect(audit?.metadata).toMatchObject({
      before: { role: "kitchen_staff", propertyIds: [admin.propertyId] },
      after: { role: "manager", propertyIds: [second] },
    });
  });

  test("you can't change your own role or switch yourself off; one admin always remains", async () => {
    const t = await setupTest();
    const admin = await createAdmin(t);
    expect(
      await errorCode(
        admin.as.mutation(api.accounts.update, {
          userId: admin.userId,
          name: "Test Admin",
          role: "manager",
          assignedPropertyIds: [admin.propertyId],
        }),
      ),
    ).toBe("CONFLICT");
    expect(
      await errorCode(
        admin.as.mutation(api.accounts.setDisabled, {
          userId: admin.userId,
          disabled: true,
        }),
      ),
    ).toBe("CONFLICT");
  });

  test("managers and kitchen staff can't use any account or organisation function", async () => {
    const t = await setupTest();
    const admin = await createAdmin(t);
    for (const role of ["manager", "kitchen_staff"] as const) {
      const member = await createMember(t, admin, { role });
      const calls = [
        member.as.query(api.accounts.list, {}),
        member.as.query(api.organization.get, {}),
        member.as.mutation(api.organization.addProperty, { name: "Mine" }),
        member.as.mutation(api.accounts.update, {
          userId: member.userId,
          name: "Me",
          role: "admin",
          assignedPropertyIds: [],
        }),
        member.as.mutation(api.accounts.setDisabled, {
          userId: admin.userId,
          disabled: true,
        }),
        member.as.action(api.accounts.resetPassword, { userId: admin.userId }),
        member.as.action(api.accounts.create, {
          name: "Sneaky",
          phone: nextPhone(),
          role: "admin",
          assignedPropertyIds: [],
          temporaryPassword: PASSWORD,
        }),
      ];
      for (const call of calls) expect(await errorCode(call)).toBe("FORBIDDEN");
    }
  });
});
