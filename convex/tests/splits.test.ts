import { describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import {
  addProperty,
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
  const admin = await createAdmin(t); // Main PG
  const south = await addProperty(t, admin, "South PG");
  const shopId = await createShop(t, admin);
  const categoryId = await firstCategory(t, admin);
  const rice = await createItem(t, admin, { name: "Rice" });
  await admin.as.mutation(api.catalog.updateItem, {
    itemId: rice, name: "Rice", categoryId, baseUnit: "kg", aliases: [], packSizes: [], variants: ["Sona Masoori"], archived: false, verify: false, brands: ["India Gate"],
  });
  const member = await createMember(t, admin, { propertyIds: [admin.propertyId] });
  const range = { fromDate: "2027-04-01", toDate: "2027-04-30" };
  return { t, admin, south, shopId, categoryId, rice, member, range };
}

describe("brands, None and Loose", () => {
  test("an item's own brands, Loose, or none are accepted; anything else isn't", async () => {
    const c = await setup();
    const line = (brand?: string, variant?: string) => ({
      scope: { kind: "property", propertyId: c.admin.propertyId } as const,
      shopId: c.shopId,
      lines: [{ itemId: c.rice, brand, variant, quantity: 5, totalPaise: 25_000 }],
      pricesConfirmed: true,
    });
    await c.member.as.mutation(api.entries.create, line("India Gate", "Sona Masoori"));
    await c.member.as.mutation(api.entries.create, line("Loose", "Loose"));
    await c.member.as.mutation(api.entries.create, line(undefined, undefined));
    expect(await errorCode(c.member.as.mutation(api.entries.create, line("Daawat")))).toBe("INVALID_INPUT");
    const lines = await c.t.run((ctx) => ctx.db.query("entryLines").collect());
    expect(lines.map((l) => [l.brand ?? null, l.variant ?? null])).toEqual([["India Gate", "Sona Masoori"], ["Loose", "Loose"], [null, null]]);
  });

  test("brands are kept when the Verify button saves the item without them", async () => {
    const c = await setup();
    await c.admin.as.mutation(api.catalog.updateItem, {
      itemId: c.rice, name: "Rice", categoryId: c.categoryId, baseUnit: "kg", aliases: [], packSizes: [], variants: [], archived: false, verify: true,
    });
    expect((await c.t.run((ctx) => ctx.db.get(c.rice)))?.brands).toEqual(["India Gate"]);
  });
});

describe("packet unit and safe delete", () => {
  test("an item can be counted in packets with its packet size", async () => {
    const c = await setup();
    const biscuits = await c.member.as.mutation(api.catalog.addItem, {
      name: "Biscuits", categoryId: c.categoryId, baseUnit: "packet", packetSize: { amount: 200, unit: "g" },
    });
    expect(await c.t.run((ctx) => ctx.db.get(biscuits))).toMatchObject({ baseUnit: "packet", packetSize: { amount: 200, unit: "g" } });
    // Packet size only applies to packet items.
    const salt = await c.member.as.mutation(api.catalog.addItem, { name: "Salt", categoryId: c.categoryId, baseUnit: "kg", packetSize: { amount: 1, unit: "kg" } });
    expect((await c.t.run((ctx) => ctx.db.get(salt)))?.packetSize).toBeUndefined();
  });

  test("an item never bought can be deleted (and leaves shopping lists); a bought one can't", async () => {
    const c = await setup();
    const unused = await createItem(c.t, c.admin, { name: "Saffron" });
    await c.member.as.mutation(api.shoppingList.add, { scope: { kind: "property", propertyId: c.admin.propertyId }, itemId: unused, quantity: 1 });
    await c.admin.as.mutation(api.catalog.deleteItem, { itemId: unused });
    expect(await c.t.run((ctx) => ctx.db.get(unused))).toBeNull();
    expect(await c.t.run((ctx) => ctx.db.query("shoppingListItems").collect())).toHaveLength(0);
    await c.member.as.mutation(api.entries.create, {
      scope: { kind: "property", propertyId: c.admin.propertyId }, shopId: c.shopId, lines: [{ itemId: c.rice, quantity: 1, totalPaise: 5_000 }], pricesConfirmed: true,
    });
    expect(await errorCode(c.admin.as.mutation(api.catalog.deleteItem, { itemId: c.rice }))).toBe("CONFLICT");
    expect(await errorCode(c.member.as.mutation(api.catalog.deleteItem, { itemId: c.rice }))).toBe("FORBIDDEN");
    expect((await c.t.run((ctx) => ctx.db.query("auditLog").collect())).some((a) => a.action === "item.deleted")).toBe(true);
  });
});

describe("splitting Shared purchases between properties", () => {
  test("parts must add up, and only Shared purchases can be split", async () => {
    const c = await setup();
    const shared = (split: { propertyId: typeof c.south; quantity: number }[]) => ({
      scope: { kind: "shared" } as const,
      shopId: c.shopId,
      lines: [{ itemId: c.rice, quantity: 10, totalPaise: 50_000, split }],
      pricesConfirmed: true,
    });
    expect(await errorCode(c.member.as.mutation(api.entries.create, shared([{ propertyId: c.admin.propertyId, quantity: 6 }, { propertyId: c.south, quantity: 3 }])))).toBe("INVALID_INPUT");
    // A member may split into a property they don't work for: it's the organisation's purchase.
    await c.member.as.mutation(api.entries.create, shared([{ propertyId: c.admin.propertyId, quantity: 6 }, { propertyId: c.south, quantity: 4 }]));
    expect(
      await errorCode(
        c.member.as.mutation(api.entries.create, {
          scope: { kind: "property", propertyId: c.admin.propertyId },
          shopId: c.shopId,
          lines: [{ itemId: c.rice, quantity: 10, totalPaise: 50_000, split: [{ propertyId: c.south, quantity: 10 }] }],
          pricesConfirmed: true,
        }),
      ),
    ).toBe("INVALID_INPUT");
  });

  test("each property's numbers include its share; Shared keeps only what wasn't split; All is unchanged", async () => {
    const c = await setup();
    await c.member.as.mutation(api.entries.create, {
      scope: { kind: "shared" },
      shopId: c.shopId,
      lines: [{ itemId: c.rice, quantity: 10, totalPaise: 50_000, split: [{ propertyId: c.admin.propertyId, quantity: 6 }, { propertyId: c.south, quantity: 4 }] }],
      pricesConfirmed: true,
    });
    await c.member.as.mutation(api.entries.create, {
      scope: { kind: "shared" }, shopId: c.shopId, lines: [{ itemId: c.rice, quantity: 2, totalPaise: 10_000 }], pricesConfirmed: true,
    });
    const log = (scope: string) => c.admin.as.query(api.history.entriesLog, { scope, ...c.range });
    expect((await log(c.admin.propertyId)).totals.totalPaise).toBe(30_000);
    expect((await log(c.south)).totals.totalPaise).toBe(20_000);
    expect((await log("shared")).totals.totalPaise).toBe(10_000);
    expect((await log("all")).totals.totalPaise).toBe(60_000);
    const page = (await c.admin.as.query(api.history.item, { itemId: c.rice, scope: c.south, ...c.range }))!;
    expect(page.totals).toMatchObject({ quantity: 4, totalPaise: 20_000 });
    const csv = await c.admin.as.mutation(api.history.exportCsv, { scope: "all", ...c.range });
    expect(csv.csv).toContain("Main PG 6; South PG 4");
  });

  test("a Shared shopping list can be split, and saving keeps the split", async () => {
    const c = await setup();
    const shared = { kind: "shared" } as const;
    const rowId = await c.member.as.mutation(api.shoppingList.add, {
      scope: shared, itemId: c.rice, quantity: 10, split: [{ propertyId: c.admin.propertyId, quantity: 5 }, { propertyId: c.south, quantity: 5 }],
    });
    expect(await errorCode(c.member.as.mutation(api.shoppingList.tick, {
      rowId, quantity: 8, shopId: c.shopId, totalPaise: 40_000, split: [{ propertyId: c.admin.propertyId, quantity: 5 }, { propertyId: c.south, quantity: 5 }],
    }))).toBe("INVALID_INPUT");
    await c.member.as.mutation(api.shoppingList.tick, {
      rowId, quantity: 8, shopId: c.shopId, totalPaise: 40_000, split: [{ propertyId: c.admin.propertyId, quantity: 5 }, { propertyId: c.south, quantity: 3 }],
    });
    await c.member.as.mutation(api.shoppingList.savePurchases, { scope: shared, pricesConfirmed: true });
    const line = (await c.t.run((ctx) => ctx.db.query("entryLines").collect()))[0];
    expect(line.split).toEqual([{ propertyId: c.admin.propertyId, quantity: 5 }, { propertyId: c.south, quantity: 3 }]);
    // A property list can't be split.
    expect(await errorCode(c.member.as.mutation(api.shoppingList.add, {
      scope: { kind: "property", propertyId: c.admin.propertyId }, itemId: c.rice, quantity: 1, split: [{ propertyId: c.admin.propertyId, quantity: 1 }],
    }))).toBe("INVALID_INPUT");
  });
});
