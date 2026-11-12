import { describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import {
  createAdmin,
  createItem,
  createMember,
  createShop,
  errorCode,
  firstCategory,
  setupTest,
} from "./harness.test-utils";

async function setup() {
  const t = await setupTest();
  const admin = await createAdmin(t);
  const member = await createMember(t, admin);
  const categoryId = await firstCategory(t, admin);
  return { t, admin, member, categoryId };
}

describe("adding items and shops while entering", () => {
  test("by a manager or kitchen staff member: unverified; by an admin: verified", async () => {
    const { t, admin, member, categoryId } = await setup();
    const mine = await member.as.mutation(api.catalog.addItem, { name: "Bhindi", categoryId, baseUnit: "kg", aliases: ["okra"] });
    const adminItem = await admin.as.mutation(api.catalog.addItem, { name: "Onion", categoryId, baseUnit: "kg" });
    const shop = await member.as.mutation(api.catalog.addShop, { name: "Raju Mandi", type: "mandi" });
    expect((await t.run((ctx) => ctx.db.get(mine)))?.status).toBe("unverified");
    expect((await t.run((ctx) => ctx.db.get(adminItem)))?.status).toBe("verified");
    expect((await t.run((ctx) => ctx.db.get(shop)))?.status).toBe("unverified");
    expect(await errorCode(member.as.mutation(api.catalog.addItem, { name: " bhindi ", categoryId, baseUnit: "kg" }))).toBe("CONFLICT");
  });

  test("archived items and shops disappear from entry search", async () => {
    const { t, admin, member, categoryId } = await setup();
    const itemId = await createItem(t, admin, { name: "Paneer" });
    const shopId = await createShop(t, admin, "Old Dairy");
    await admin.as.mutation(api.catalog.updateItem, {
      itemId, name: "Paneer", categoryId, baseUnit: "kg", aliases: [], packSizes: [], variants: [], archived: true, verify: false,
    });
    await admin.as.mutation(api.catalog.updateShop, { shopId, name: "Old Dairy", type: "dairy", archived: true, verify: false });
    const lists = await member.as.query(api.catalog.forEntry, {});
    expect(lists.items.map((i) => i.name)).not.toContain("Paneer");
    expect(lists.shops.map((s) => s.name)).not.toContain("Old Dairy");
  });

  test("managers and kitchen staff can't use the admin list functions", async () => {
    const { t, member, categoryId } = await setup();
    const itemId = await member.as.mutation(api.catalog.addItem, { name: "Bhindi", categoryId, baseUnit: "kg" });
    const calls = [
      member.as.query(api.catalog.lists, {}),
      member.as.mutation(api.catalog.addCategory, { name: "Snacks" }),
      member.as.mutation(api.catalog.updateItem, {
        itemId, name: "Bhindi", categoryId, baseUnit: "kg", aliases: [], packSizes: [], variants: [], archived: false, verify: true,
      }),
      member.as.mutation(api.catalog.mergeItem, { duplicateId: itemId, keepId: itemId }),
      member.as.query(api.audit.list, { paginationOpts: { numItems: 10, cursor: null } }),
    ];
    for (const call of calls) expect(await errorCode(call)).toBe("FORBIDDEN");
    expect((await t.run((ctx) => ctx.db.get(itemId)))?.status).toBe("unverified");
  });
});

describe("merging", () => {
  test("an unverified item merged into an existing one moves every line, then is deleted", async () => {
    const { t, admin, member } = await setup();
    const shopId = await createShop(t, admin);
    const tomato = await createItem(t, admin, { name: "Tomato", aliases: ["tamatar"] });
    const otherCategory = await t.run(async (ctx) =>
      (await ctx.db.query("categories").collect()).find((c) => c.name === "Fruits & Vegetables")!._id,
    );
    await admin.as.mutation(api.catalog.updateItem, {
      itemId: tomato, name: "Tomato", categoryId: otherCategory, baseUnit: "kg", aliases: ["tamatar"], packSizes: [], variants: [], archived: false, verify: false,
    });
    const categoryId = await firstCategory(t, admin);
    const duplicate = await member.as.mutation(api.catalog.addItem, { name: "Tamaatar", categoryId, baseUnit: "kg", aliases: ["tomatoes"] });
    const entryId = await member.as.mutation(api.entries.create, {
      scope: { kind: "property", propertyId: admin.propertyId },
      shopId,
      lines: [{ itemId: duplicate, quantity: 2, totalPaise: 8_000 }, { itemId: tomato, quantity: 1, totalPaise: 4_000 }],
      pricesConfirmed: true,
    });
    const result = await admin.as.mutation(api.catalog.mergeItem, { duplicateId: duplicate, keepId: tomato });
    expect(result.linesMoved).toBe(1);
    expect(await t.run((ctx) => ctx.db.get(duplicate))).toBeNull();
    const lines = await t.run((ctx) => ctx.db.query("entryLines").withIndex("by_entry", (q) => q.eq("entryId", entryId)).collect());
    expect(lines.map((l) => l.itemId)).toEqual([tomato, tomato]);
    expect(lines.every((l) => l.categoryId === otherCategory)).toBe(true);
    const kept = (await t.run((ctx) => ctx.db.get(tomato)))!;
    expect(kept.aliases).toEqual(["tamatar", "Tamaatar", "tomatoes"]);
    const audit = (await t.run((ctx) => ctx.db.query("auditLog").collect())).find((a) => a.action === "item.merged")!;
    expect(audit.metadata).toMatchObject({ merged: { name: "Tamaatar" }, into: { name: "Tomato" }, linesMoved: 1 });
  });

  test("items with different units can't be merged", async () => {
    const { t, admin } = await setup();
    const kg = await createItem(t, admin, { name: "Sugar" });
    const piece = await createItem(t, admin, { name: "Sugar sachet", baseUnit: "piece" });
    expect(await errorCode(admin.as.mutation(api.catalog.mergeItem, { duplicateId: piece, keepId: kg }))).toBe("CONFLICT");
  });

  test("an unverified shop merged into an existing one moves its entries and lines", async () => {
    const { t, admin, member } = await setup();
    const keep = await createShop(t, admin, "Sharma Kirana");
    const duplicate = await member.as.mutation(api.catalog.addShop, { name: "Sharma Store", type: "kirana" });
    const itemId = await createItem(t, admin);
    const entryId = await member.as.mutation(api.entries.create, {
      scope: { kind: "property", propertyId: admin.propertyId },
      shopId: duplicate,
      lines: [{ itemId, quantity: 1, totalPaise: 4_000 }],
      pricesConfirmed: true,
    });
    expect(await admin.as.mutation(api.catalog.mergeShop, { duplicateId: duplicate, keepId: keep })).toEqual({
      entriesMoved: 1,
      linesMoved: 1,
    });
    expect((await t.run((ctx) => ctx.db.get(entryId)))?.shopId).toBe(keep);
    const lines = await t.run((ctx) => ctx.db.query("entryLines").withIndex("by_entry", (q) => q.eq("entryId", entryId)).collect());
    expect(lines.map((l) => l.shopId)).toEqual([keep]);
    expect(await t.run((ctx) => ctx.db.get(duplicate))).toBeNull();
    expect((await t.run((ctx) => ctx.db.query("auditLog").collect())).some((a) => a.action === "shop.merged")).toBe(true);
  });

  test("an item's unit can't change once it has been bought", async () => {
    const { t, admin, member } = await setup();
    const shopId = await createShop(t, admin);
    const itemId = await createItem(t, admin);
    await member.as.mutation(api.entries.create, {
      scope: { kind: "property", propertyId: admin.propertyId },
      shopId,
      lines: [{ itemId, quantity: 1, totalPaise: 4_000 }],
      pricesConfirmed: true,
    });
    const categoryId = await firstCategory(t, admin);
    expect(
      await errorCode(
        admin.as.mutation(api.catalog.updateItem, {
          itemId, name: "Tomato", categoryId, baseUnit: "piece", aliases: [], packSizes: [], variants: [], archived: false, verify: false,
        }),
      ),
    ).toBe("CONFLICT");
  });
});
