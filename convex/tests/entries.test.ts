import { describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  addProperty,
  advance,
  createAdmin,
  createItem,
  createMember,
  createShop,
  errorCode,
  HOUR,
  setupTest,
  type Admin,
  type T,
} from "./harness.test-utils";

async function setup() {
  const t = await setupTest();
  const admin = await createAdmin(t);
  const south = await addProperty(t, admin, "South PG");
  const shopId = await createShop(t, admin);
  const tomato = await createItem(t, admin, { name: "Tomato", aliases: ["tamatar"] });
  const milk = await createItem(t, admin, {
    name: "Milk",
    baseUnit: "litre",
    packSizes: [{ label: "500 ml packet", quantity: 0.5 }],
    variants: ["Toned", "Full cream"],
  });
  // Assigned to Main PG only.
  const member = await createMember(t, admin, { role: "kitchen_staff" });
  const manager = await createMember(t, admin, { role: "manager", propertyIds: [south] });
  return { t, admin, south, shopId, tomato, milk, member, manager };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

function entryArgs(
  c: Pick<Ctx, "shopId" | "tomato">,
  propertyId: Id<"properties"> | "shared",
  totalPaise = 12_000,
) {
  return {
    scope: propertyId === "shared" ? ({ kind: "shared" } as const) : ({ kind: "property", propertyId } as const),
    shopId: c.shopId,
    lines: [{ itemId: c.tomato, quantity: 3, totalPaise }],
    pricesConfirmed: false,
  };
}

const auditFor = (t: T, entryId: string) =>
  t.run((ctx) => ctx.db.query("auditLog").withIndex("by_entity", (q) => q.eq("entityType", "entries").eq("entityId", entryId)).collect());

const adminProperty = (admin: Admin) => admin.propertyId;

describe("creating entries", () => {
  test("stores lines with the computed unit price, pack conversion and denormalised fields", async () => {
    const c = await setup();
    const entryId = await c.member.as.mutation(api.entries.create, {
      scope: { kind: "property", propertyId: adminProperty(c.admin) },
      shopId: c.shopId,
      note: "Weekly veg",
      lines: [
        { itemId: c.tomato, quantity: 3, totalPaise: 12_000 },
        { itemId: c.milk, variant: "Toned", packLabel: "500 ml packet", packCount: 4, totalPaise: 11_200 },
      ],
      pricesConfirmed: false,
    });
    const entry = (await c.t.run((ctx) => ctx.db.get(entryId)))!;
    expect(entry).toMatchObject({ totalPaise: 23_200, lineCount: 2, scopeKey: c.admin.propertyId });
    expect(Math.abs(entry.loggedAt - Date.now())).toBeLessThan(1_000);
    const lines = await c.t.run((ctx) => ctx.db.query("entryLines").withIndex("by_entry", (q) => q.eq("entryId", entryId)).collect());
    expect(lines.map((l) => [l.quantity, l.unitPricePaise, l.packLabel, l.packCount, l.variant])).toEqual([
      [3, 4_000, undefined, undefined, undefined],
      [2, 5_600, "500 ml packet", 4, "Toned"],
    ]);
    expect(lines.every((l) => l.shopId === c.shopId && l.propertyId === c.admin.propertyId && l.loggedAt === entry.loggedAt)).toBe(true);
  });

  test("Shared entries belong to no property", async () => {
    const c = await setup();
    const entryId = await c.member.as.mutation(api.entries.create, entryArgs(c, "shared"));
    const entry = (await c.t.run((ctx) => ctx.db.get(entryId)))!;
    expect(entry.propertyId).toBeUndefined();
    expect(entry.scopeKey).toBe("shared");
  });

  test("an unusual price must be confirmed; once confirmed it is saved", async () => {
    const c = await setup();
    for (let i = 0; i < 5; i += 1)
      await c.member.as.mutation(api.entries.create, entryArgs(c, c.admin.propertyId));
    // ₹40/kg usually; ₹400/kg typed by mistake.
    const typo = entryArgs(c, c.admin.propertyId, 120_000);
    const checks = await c.member.as.query(api.entries.checkPrices, {
      lines: [{ itemId: c.tomato, unitPricePaise: 40_000 }],
    });
    expect(checks).toEqual([{ status: "high", medianPaise: 4_000 }]);
    expect(await errorCode(c.member.as.mutation(api.entries.create, typo))).toBe("PRICE_CHECK_NEEDED");
    await c.member.as.mutation(api.entries.create, { ...typo, pricesConfirmed: true });
  });
});

describe("managers and kitchen staff only reach their own properties", () => {
  test("can't write entries for a property they aren't assigned to", async () => {
    const c = await setup();
    expect(await errorCode(c.member.as.mutation(api.entries.create, entryArgs(c, c.south)))).toBe("FORBIDDEN");
    expect(await errorCode(c.manager.as.mutation(api.entries.create, entryArgs(c, c.admin.propertyId)))).toBe("FORBIDDEN");
  });

  test("can't read, edit or delete entries of other properties; can't move an entry there", async () => {
    const c = await setup();
    const southEntry = await c.manager.as.mutation(api.entries.create, entryArgs(c, c.south));
    const mainEntry = await c.member.as.mutation(api.entries.create, entryArgs(c, c.admin.propertyId));
    expect(await c.member.as.query(api.entries.get, { entryId: southEntry })).toBeNull();
    expect(
      await errorCode(c.member.as.mutation(api.entries.update, { ...entryArgs(c, c.admin.propertyId), entryId: southEntry })),
    ).toBe("NOT_FOUND");
    expect(await errorCode(c.member.as.mutation(api.entries.remove, { entryId: southEntry }))).toBe("NOT_FOUND");
    expect(
      await errorCode(c.member.as.mutation(api.entries.update, { ...entryArgs(c, c.south), entryId: mainEntry })),
    ).toBe("FORBIDDEN");
    const recent = await c.member.as.query(api.entries.recent, {});
    expect(recent.map((r) => r.entryId)).toEqual([mainEntry]);
  });

  test("see other people's entries for their property, and only their own Shared entries", async () => {
    const c = await setup();
    const colleague = await createMember(c.t, c.admin, { role: "manager" });
    const theirs = await colleague.as.mutation(api.entries.create, entryArgs(c, c.admin.propertyId));
    const theirShared = await colleague.as.mutation(api.entries.create, entryArgs(c, "shared"));
    const mine = await c.member.as.mutation(api.entries.create, entryArgs(c, "shared"));
    const recent = (await c.member.as.query(api.entries.recent, {})).map((r) => r.entryId);
    expect(recent).toContain(theirs);
    expect(recent).toContain(mine);
    expect(recent).not.toContain(theirShared);
    expect(await c.member.as.query(api.entries.get, { entryId: theirShared })).toBeNull();
  });

  test("lose access when unassigned from the property", async () => {
    const c = await setup();
    const entryId = await c.member.as.mutation(api.entries.create, entryArgs(c, c.admin.propertyId));
    await c.admin.as.mutation(api.accounts.update, {
      userId: c.member.userId,
      name: "Test Member",
      role: "kitchen_staff",
      assignedPropertyIds: [c.south],
    });
    expect(await c.member.as.query(api.entries.get, { entryId })).toBeNull();
  });
});

describe("the 24-hour rule", () => {
  test("managers and kitchen staff can edit and delete within 24 hours, not after; admins always can", async () => {
    const c = await setup();
    const entryId = await c.member.as.mutation(api.entries.create, entryArgs(c, c.admin.propertyId));
    advance(23 * HOUR);
    await c.member.as.mutation(api.entries.update, { ...entryArgs(c, c.admin.propertyId, 15_000), entryId });
    advance(2 * HOUR);
    expect((await c.member.as.query(api.entries.get, { entryId }))?.canEdit).toBe(false);
    expect(
      await errorCode(c.member.as.mutation(api.entries.update, { ...entryArgs(c, c.admin.propertyId, 9_000), entryId })),
    ).toBe("EDIT_WINDOW_CLOSED");
    expect(await errorCode(c.member.as.mutation(api.entries.remove, { entryId }))).toBe("EDIT_WINDOW_CLOSED");
    // Editing doesn't restart the clock.
    const entry = (await c.t.run((ctx) => ctx.db.get(entryId)))!;
    expect(entry.totalPaise).toBe(15_000);
    await c.admin.as.mutation(api.entries.update, { ...entryArgs(c, c.admin.propertyId, 9_000), entryId });
    await c.admin.as.mutation(api.entries.remove, { entryId });
  });

  test("deleting is a soft delete; the entry disappears for staff but the record stays", async () => {
    const c = await setup();
    const entryId = await c.member.as.mutation(api.entries.create, entryArgs(c, c.admin.propertyId));
    await c.member.as.mutation(api.entries.remove, { entryId });
    const entry = (await c.t.run((ctx) => ctx.db.get(entryId)))!;
    expect(entry.deletedAt).toBeDefined();
    expect(entry.deletedBy).toBe(c.member.userId);
    const lines = await c.t.run((ctx) => ctx.db.query("entryLines").withIndex("by_entry", (q) => q.eq("entryId", entryId)).collect());
    expect(lines.every((l) => l.deleted)).toBe(true);
    expect(await c.member.as.query(api.entries.recent, {})).toEqual([]);
    expect((await c.admin.as.query(api.entries.get, { entryId }))?.deleted).toBe(true);
  });
});

describe("the entry's date (loggedAt)", () => {
  test("is set by the server; managers and kitchen staff can't change it", async () => {
    const c = await setup();
    const entryId = await c.member.as.mutation(api.entries.create, entryArgs(c, c.admin.propertyId));
    const original = (await c.t.run((ctx) => ctx.db.get(entryId)))!.loggedAt;
    expect(Math.abs(original - Date.now())).toBeLessThan(1_000);
    for (const who of [c.member, c.manager]) {
      expect(
        await errorCode(
          who.as.mutation(api.entries.update, {
            ...entryArgs(c, c.admin.propertyId),
            entryId,
            loggedAt: original - 3 * 24 * HOUR,
          }),
        ),
      ).toBe("FORBIDDEN");
    }
    // Creating takes no date at all.
    await expect(
      c.member.as.mutation(api.entries.create, {
        ...entryArgs(c, c.admin.propertyId),
        loggedAt: 0,
      } as never),
    ).rejects.toThrow();
    expect((await c.t.run((ctx) => ctx.db.get(entryId)))!.loggedAt).toBe(original);
  });

  test("an admin can change it; lines follow and the change is audited", async () => {
    const c = await setup();
    const entryId = await c.member.as.mutation(api.entries.create, entryArgs(c, c.admin.propertyId));
    const newDate = Date.now() - 3 * 24 * HOUR;
    await c.admin.as.mutation(api.entries.update, { ...entryArgs(c, c.admin.propertyId), entryId, loggedAt: newDate });
    expect((await c.t.run((ctx) => ctx.db.get(entryId)))!.loggedAt).toBe(newDate);
    const lines = await c.t.run((ctx) => ctx.db.query("entryLines").withIndex("by_entry", (q) => q.eq("entryId", entryId)).collect());
    expect(lines.every((l) => l.loggedAt === newDate)).toBe(true);
    const updated = (await auditFor(c.t, entryId)).find((a) => a.action === "entry.updated")!;
    expect(updated.metadata).toMatchObject({ dateChanged: true, after: { loggedAt: newDate } });
    expect(
      await errorCode(
        c.admin.as.mutation(api.entries.update, { ...entryArgs(c, c.admin.propertyId), entryId, loggedAt: Date.now() + 24 * HOUR }),
      ),
    ).toBe("INVALID_DATE");
  });
});

describe("audit", () => {
  test("create, edit and delete each write an audit record with before/after values", async () => {
    const c = await setup();
    const entryId = await c.member.as.mutation(api.entries.create, entryArgs(c, c.admin.propertyId, 12_000));
    await c.member.as.mutation(api.entries.update, { ...entryArgs(c, c.admin.propertyId, 15_000), entryId });
    await c.member.as.mutation(api.entries.remove, { entryId });
    const audit = await auditFor(c.t, entryId);
    expect(audit.map((a) => [a.action, a.actorUserId])).toEqual([
      ["entry.created", c.member.userId],
      ["entry.updated", c.member.userId],
      ["entry.deleted", c.member.userId],
    ]);
    expect(audit[0].metadata).toMatchObject({ after: { totalPaise: 12_000, shop: "Sharma Kirana", lines: [{ item: "Tomato", quantity: 3 }] } });
    expect(audit[1].metadata).toMatchObject({ before: { totalPaise: 12_000 }, after: { totalPaise: 15_000 } });
    expect(audit[2].metadata).toMatchObject({ before: { totalPaise: 15_000 } });
  });

  test("master-list changes are audited too", async () => {
    const c = await setup();
    const itemId = await c.member.as.mutation(api.catalog.addItem, {
      name: "Bhindi",
      categoryId: (await c.t.run((ctx) => ctx.db.get(c.tomato)))!.categoryId,
      baseUnit: "kg",
    });
    const shopId = await c.member.as.mutation(api.catalog.addShop, { name: "Raju Mandi", type: "mandi" });
    const actions = (await c.t.run((ctx) => ctx.db.query("auditLog").collect())).map((a) => `${a.action}:${a.entityId}`);
    expect(actions).toContain(`item.created:${itemId}`);
    expect(actions).toContain(`shop.created:${shopId}`);
  });
});
