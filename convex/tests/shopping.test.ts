import { describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { expectedUnitPrice, shopBills } from "../lib/shopping";
import {
  addProperty,
  advance,
  createAdmin,
  createItem,
  createMember,
  createShop,
  errorCode,
  firstCategory,
  HOUR,
  setupTest,
} from "./harness.test-utils";

describe("expected price", () => {
  const history = [
    { shopId: "dairy", variant: "Toned", unitPricePaise: 5_600 },
    { shopId: "kirana", variant: "Full cream", unitPricePaise: 7_000 },
    { shopId: "kirana", variant: "Toned", unitPricePaise: 5_800 },
  ];
  test("a typed price wins, then the last price at the planned shop, then anywhere", () => {
    expect(expectedUnitPrice({ shopId: "kirana", expectedUnitPricePaise: 5_000 }, history)).toEqual({ unitPricePaise: 5_000, source: "typed" });
    expect(expectedUnitPrice({ shopId: "kirana" }, history)).toEqual({ unitPricePaise: 7_000, source: "this_shop" });
    expect(expectedUnitPrice({ shopId: "kirana", variant: "Toned" }, history)).toEqual({ unitPricePaise: 5_800, source: "this_shop" });
    expect(expectedUnitPrice({ shopId: "mandi", variant: "Toned" }, history)).toEqual({ unitPricePaise: 5_600, source: "any_shop" });
    expect(expectedUnitPrice({}, history)).toEqual({ unitPricePaise: 5_600, source: "any_shop" });
  });
  test("never bought and nothing typed: no estimate", () => {
    expect(expectedUnitPrice({ shopId: "kirana" }, [])).toBeNull();
  });
});

describe("bills per shop", () => {
  test("estimates by planned shop; ticked-off amounts by the shop actually used", () => {
    const bills = shopBills([
      { shopId: "kirana", estimatePaise: 12_000 },
      { shopId: "kirana", estimatePaise: null },
      { shopId: "dairy", estimatePaise: 11_000, bought: { shopId: "kirana", totalPaise: 10_500 } },
      { estimatePaise: 3_000 },
    ]);
    expect(bills).toEqual([
      { shopId: "kirana", items: 2, estimatedPaise: 12_000, unpriced: 1, boughtItems: 1, boughtPaise: 10_500 },
      { shopId: "dairy", items: 1, estimatedPaise: 11_000, unpriced: 0, boughtItems: 0, boughtPaise: 0 },
      { shopId: null, items: 1, estimatedPaise: 3_000, unpriced: 0, boughtItems: 0, boughtPaise: 0 },
    ]);
  });
});

async function setup() {
  const t = await setupTest();
  const admin = await createAdmin(t);
  const south = await addProperty(t, admin, "South PG");
  const kirana = await createShop(t, admin, "Sharma Kirana");
  const dairy = await createShop(t, admin, "Gokul Dairy");
  const rice = await createItem(t, admin, { name: "Rice" });
  const milk = await createItem(t, admin, {
    name: "Milk",
    baseUnit: "litre",
    variants: ["Toned"],
    packSizes: [{ label: "500 ml packet", quantity: 0.5 }],
  });
  await admin.as.mutation(api.catalog.updateItem, {
    itemId: milk, name: "Milk", categoryId: await firstCategory(t, admin), baseUnit: "litre", aliases: [],
    packSizes: [{ label: "500 ml packet", quantity: 0.5 }], variants: ["Toned"], archived: false, verify: false, defaultShopId: dairy,
  });
  const member = await createMember(t, admin); // Main PG only
  const main = { kind: "property", propertyId: admin.propertyId } as const;
  return { t, admin, south, kirana, dairy, rice, milk, member, main };
}

describe("shopping lists", () => {
  test("List mode: the shop comes from the item's default shop; estimates use the last price there", async () => {
    const c = await setup();
    // An earlier purchase of milk at the dairy: ₹56/litre.
    await c.member.as.mutation(api.entries.create, {
      scope: c.main, shopId: c.dairy, lines: [{ itemId: c.milk, quantity: 2, totalPaise: 11_200 }], pricesConfirmed: true,
    });
    await c.member.as.mutation(api.shoppingList.add, { scope: c.main, itemId: c.milk, packLabel: "500 ml packet", packCount: 20 });
    await c.member.as.mutation(api.shoppingList.add, { scope: c.main, itemId: c.rice, quantity: 25, shopId: c.kirana, expectedUnitPricePaise: 5_200 });
    const list = await c.member.as.query(api.shoppingList.get, { scope: c.main });
    const milkRow = list.rows.find((r) => r.itemName === "Milk")!;
    expect(milkRow).toMatchObject({ shopName: "Gokul Dairy", quantity: 10, packCount: 20, estimateUnitPricePaise: 5_600, estimateSource: "this_shop", estimatePaise: 56_000 });
    expect(list.bills.map((b) => [b.shopName, b.estimatedPaise])).toEqual(
      expect.arrayContaining([["Gokul Dairy", 56_000], ["Sharma Kirana", 130_000]]),
    );
    expect(list.totals).toMatchObject({ items: 2, estimatedPaise: 186_000, unpriced: 0 });
    expect(await errorCode(c.member.as.mutation(api.shoppingList.add, { scope: c.main, itemId: c.rice, quantity: 5 }))).toBe("CONFLICT");
  });

  test("each property has its own list; the Shared list is one for everyone", async () => {
    const c = await setup();
    const south = { kind: "property", propertyId: c.south } as const;
    await c.admin.as.mutation(api.shoppingList.add, { scope: south, itemId: c.rice, quantity: 10 });
    expect((await c.member.as.query(api.shoppingList.get, { scope: c.main })).rows).toHaveLength(0);
    // A member of Main PG can't see or change South PG's list.
    expect(await errorCode(c.member.as.query(api.shoppingList.get, { scope: south }))).toBe("FORBIDDEN");
    expect(await errorCode(c.member.as.mutation(api.shoppingList.add, { scope: south, itemId: c.milk, quantity: 1 }))).toBe("FORBIDDEN");
    const southRow = (await c.admin.as.query(api.shoppingList.get, { scope: south })).rows[0].rowId;
    expect(await errorCode(c.member.as.mutation(api.shoppingList.remove, { rowId: southRow }))).toBe("NOT_FOUND");
    expect(await errorCode(c.member.as.mutation(api.shoppingList.tick, { rowId: southRow, quantity: 1, shopId: c.kirana, totalPaise: 100 }))).toBe("NOT_FOUND");
    // Shared: added by one person, seen by another property's manager.
    const southManager = await createMember(c.t, c.admin, { role: "manager", propertyIds: [c.south] });
    await c.member.as.mutation(api.shoppingList.add, { scope: { kind: "shared" }, itemId: c.rice, quantity: 50 });
    expect((await southManager.as.query(api.shoppingList.get, { scope: { kind: "shared" } })).rows.map((r) => r.itemName)).toEqual(["Rice"]);
  });

  test("Buy mode: tick with a changed quantity and shop, then Save purchases makes one entry per shop and keeps the list", async () => {
    const c = await setup();
    await c.member.as.mutation(api.shoppingList.add, { scope: c.main, itemId: c.milk, packLabel: "500 ml packet", packCount: 20 });
    await c.member.as.mutation(api.shoppingList.add, { scope: c.main, itemId: c.rice, quantity: 25, shopId: c.kirana });
    const rows = (await c.member.as.query(api.shoppingList.get, { scope: c.main })).rows;
    const milkRow = rows.find((r) => r.itemName === "Milk")!.rowId;
    const riceRow = rows.find((r) => r.itemName === "Rice")!.rowId;
    // Only 16 packets, and bought at the kirana instead of the dairy.
    await c.member.as.mutation(api.shoppingList.tick, { rowId: milkRow, variant: "Toned", packLabel: "500 ml packet", packCount: 16, shopId: c.kirana, totalPaise: 44_800 });
    await c.member.as.mutation(api.shoppingList.tick, { rowId: riceRow, quantity: 25, shopId: c.kirana, totalPaise: 130_000 });
    let list = await c.member.as.query(api.shoppingList.get, { scope: c.main });
    expect(list.totals).toMatchObject({ boughtItems: 2, boughtPaise: 174_800 });
    expect(list.rows.find((r) => r.rowId === milkRow)!.bought).toMatchObject({ quantity: 8, unitPricePaise: 5_600, shopName: "Sharma Kirana" });
    // The plan itself is unchanged.
    expect(list.rows.find((r) => r.rowId === milkRow)!).toMatchObject({ quantity: 10, shopName: "Gokul Dairy" });

    const saved = await c.member.as.mutation(api.shoppingList.savePurchases, { scope: c.main, pricesConfirmed: false });
    expect(saved).toHaveLength(1); // both bought at the kirana
    const entry = (await c.t.run((ctx) => ctx.db.get(saved[0].entryId)))!;
    expect(entry).toMatchObject({ shopId: c.kirana, propertyId: c.admin.propertyId, totalPaise: 174_800, lineCount: 2, createdBy: c.member.userId });
    const lines = await c.t.run((ctx) => ctx.db.query("entryLines").withIndex("by_entry", (q) => q.eq("entryId", entry._id)).collect());
    expect(lines.map((l) => [l.quantity, l.packLabel ?? null, l.packCount ?? null, l.variant ?? null])).toEqual(
      expect.arrayContaining([[8, "500 ml packet", 16, "Toned"], [25, null, null, null]]),
    );
    const audit = await c.t.run((ctx) => ctx.db.query("auditLog").withIndex("by_entity", (q) => q.eq("entityType", "entries").eq("entityId", entry._id)).collect());
    expect(audit.map((a) => a.action)).toEqual(["entry.created"]);
    // Ticks cleared, items kept for next time.
    list = await c.member.as.query(api.shoppingList.get, { scope: c.main });
    expect(list.rows).toHaveLength(2);
    expect(list.rows.every((r) => r.bought === null)).toBe(true);
    expect(await errorCode(c.member.as.mutation(api.shoppingList.savePurchases, { scope: c.main, pricesConfirmed: false }))).toBe("INVALID_INPUT");
  });

  test("Save purchases splits by shop, and an unusual price must be confirmed first", async () => {
    const c = await setup();
    for (let i = 0; i < 3; i += 1) {
      await c.member.as.mutation(api.entries.create, { scope: c.main, shopId: c.kirana, lines: [{ itemId: c.rice, quantity: 1, totalPaise: 5_000 }], pricesConfirmed: true });
      advance(HOUR);
    }
    await c.member.as.mutation(api.shoppingList.add, { scope: c.main, itemId: c.milk, quantity: 2 });
    await c.member.as.mutation(api.shoppingList.add, { scope: c.main, itemId: c.rice, quantity: 10, shopId: c.kirana });
    const rows = (await c.member.as.query(api.shoppingList.get, { scope: c.main })).rows;
    await c.member.as.mutation(api.shoppingList.tick, { rowId: rows.find((r) => r.itemName === "Milk")!.rowId, quantity: 2, shopId: c.dairy, totalPaise: 11_200 });
    // ₹5,000 for 10 kg = ₹500/kg, ten times the usual ₹50/kg.
    await c.member.as.mutation(api.shoppingList.tick, { rowId: rows.find((r) => r.itemName === "Rice")!.rowId, quantity: 10, shopId: c.kirana, totalPaise: 500_000 });
    expect(await errorCode(c.member.as.mutation(api.shoppingList.savePurchases, { scope: c.main, pricesConfirmed: false }))).toBe("PRICE_CHECK_NEEDED");
    // Nothing was saved and the ticks are still there.
    expect((await c.member.as.query(api.shoppingList.get, { scope: c.main })).totals.boughtItems).toBe(2);
    const saved = await c.member.as.mutation(api.shoppingList.savePurchases, { scope: c.main, pricesConfirmed: true });
    expect(saved.map((s) => s.totalPaise).sort((a, b) => a - b)).toEqual([11_200, 500_000]);
  });

  test("untick, change shop in Buy mode, and remove", async () => {
    const c = await setup();
    const rowId = await c.member.as.mutation(api.shoppingList.add, { scope: c.main, itemId: c.rice, quantity: 5, shopId: c.kirana });
    await c.member.as.mutation(api.shoppingList.update, { rowId, quantity: 5, shopId: c.dairy });
    await c.member.as.mutation(api.shoppingList.tick, { rowId, quantity: 4, shopId: c.dairy, totalPaise: 20_000 });
    await c.member.as.mutation(api.shoppingList.untick, { rowId });
    const row = (await c.member.as.query(api.shoppingList.get, { scope: c.main })).rows[0];
    expect(row).toMatchObject({ shopName: "Gokul Dairy", bought: null, quantity: 5 });
    await c.member.as.mutation(api.shoppingList.remove, { rowId });
    expect((await c.member.as.query(api.shoppingList.get, { scope: c.main })).rows).toHaveLength(0);
  });

  test("merging items and shops keeps lists pointing at the one kept", async () => {
    const c = await setup();
    const categoryId = await firstCategory(c.t, c.admin);
    const dupItem = await c.member.as.mutation(api.catalog.addItem, { name: "Chawal", categoryId, baseUnit: "kg" });
    const dupShop = await c.member.as.mutation(api.catalog.addShop, { name: "Sharma Store", type: "kirana" });
    await c.admin.as.mutation(api.catalog.updateItem, {
      itemId: c.rice, name: "Rice", categoryId, baseUnit: "kg", aliases: [], packSizes: [], variants: [], archived: false, verify: false, defaultShopId: dupShop,
    });
    const rowId = await c.member.as.mutation(api.shoppingList.add, { scope: c.main, itemId: dupItem, quantity: 5, shopId: dupShop });
    await c.member.as.mutation(api.shoppingList.tick, { rowId, quantity: 5, shopId: dupShop, totalPaise: 25_000 });
    await c.admin.as.mutation(api.catalog.mergeItem, { duplicateId: dupItem, keepId: c.rice });
    await c.admin.as.mutation(api.catalog.mergeShop, { duplicateId: dupShop, keepId: c.kirana });
    const row = (await c.t.run((ctx) => ctx.db.get(rowId as Id<"shoppingListItems">)))!;
    expect(row).toMatchObject({ itemId: c.rice, shopId: c.kirana });
    expect(row.bought?.shopId).toBe(c.kirana);
    expect((await c.t.run((ctx) => ctx.db.get(c.rice)))?.defaultShopId).toBe(c.kirana);
  });
});

describe("sub-categories and default shops", () => {
  test("sub-categories go one level deep, sort under their category, and history filters include them", async () => {
    const c = await setup();
    const grocery = await firstCategory(c.t, c.admin);
    const pulses = await c.admin.as.mutation(api.catalog.addCategory, { name: "Pulses", parentId: grocery });
    expect(await errorCode(c.admin.as.mutation(api.catalog.addCategory, { name: "Moong", parentId: pulses }))).toBe("INVALID_INPUT");
    await c.admin.as.mutation(api.catalog.addCategory, { name: "Pulses", parentId: (await c.member.as.query(api.catalog.forEntry, {})).categories.find((x) => x.name === "Dairy")!.categoryId }); // same name elsewhere is fine
    expect(await errorCode(c.admin.as.mutation(api.catalog.addCategory, { name: "pulses", parentId: grocery }))).toBe("CONFLICT");
    const dal = await c.admin.as.mutation(api.catalog.createItem, { name: "Toor dal", categoryId: pulses, baseUnit: "kg", aliases: [], packSizes: [], variants: [], defaultShopId: c.kirana });
    const lists = await c.admin.as.query(api.catalog.lists, {});
    expect(lists.categories.slice(0, 2).map((x) => x.label)).toEqual(["Grocery", "Grocery › Pulses"]);
    expect(lists.items.find((i) => i.itemId === dal)).toMatchObject({ categoryName: "Grocery › Pulses", defaultShopName: "Sharma Kirana" });
    await c.member.as.mutation(api.entries.create, { scope: c.main, shopId: c.kirana, lines: [{ itemId: dal, quantity: 2, totalPaise: 30_000 }], pricesConfirmed: true });
    const range = { fromDate: "2027-04-01", toDate: "2027-04-30" };
    const all = await c.admin.as.query(api.history.entriesLog, { scope: "all", categoryId: grocery, ...range });
    expect(all.totals.totalPaise).toBe(30_000);
    const only = await c.admin.as.query(api.history.entriesLog, { scope: "all", categoryId: pulses, ...range });
    expect(only.totals.totalPaise).toBe(30_000);
  });

  test("items added while entering can take a default shop", async () => {
    const c = await setup();
    const itemId = await c.member.as.mutation(api.catalog.addItem, { name: "Paneer", categoryId: await firstCategory(c.t, c.admin), baseUnit: "kg", defaultShopId: c.dairy });
    expect((await c.t.run((ctx) => ctx.db.get(itemId)))?.defaultShopId).toBe(c.dairy);
    const rowId = await c.member.as.mutation(api.shoppingList.add, { scope: c.main, itemId, quantity: 1 });
    expect((await c.t.run((ctx) => ctx.db.get(rowId)))?.shopId).toBe(c.dairy);
  });
});
