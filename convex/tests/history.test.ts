import { describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { bucketTotals, istStart, usageRate, weekStart } from "../lib/history";
import {
  addProperty,
  advance,
  createAdmin,
  createItem,
  createMember,
  createShop,
  errorCode,
  HOUR,
  setToday,
  setupTest,
} from "./harness.test-utils";

const DAY = 24 * HOUR;
/** Noon India time on a date. */
const at = (date: string) => istStart(date) + 12 * HOUR;

describe("usage rate", () => {
  test("one purchase: not enough data", () => {
    expect(usageRate([])).toBeNull();
    expect(usageRate([{ loggedAt: at("2027-04-01"), quantity: 5 }])).toBeNull();
  });

  test("earlier purchase ÷ days until the next one", () => {
    const rate = usageRate([
      { loggedAt: at("2027-04-01"), quantity: 10 },
      { loggedAt: at("2027-04-11"), quantity: 12 },
    ])!;
    expect(rate.perDay).toBeCloseTo(1); // 10 kg over 10 days
    expect(rate.intervals).toBe(1);
    expect(rate).toMatchObject({ fromDay: "2027-04-01", toDay: "2027-04-11" });
  });

  test("an LPG cylinder every 9 days lasts ≈9 days", () => {
    const rate = usageRate(["2027-04-01", "2027-04-10", "2027-04-19", "2027-04-28"].map((d) => ({ loggedAt: at(d), quantity: 1 })))!;
    expect(rate.daysPerUnit).toBeCloseTo(9);
  });

  test("averages the most recent gaps (total quantity ÷ total days)", () => {
    const purchases = [
      { loggedAt: at("2027-01-01"), quantity: 100 }, // old, outside the last 2 gaps
      { loggedAt: at("2027-03-01"), quantity: 10 },
      { loggedAt: at("2027-03-11"), quantity: 2 },
      { loggedAt: at("2027-03-13"), quantity: 7 },
    ];
    const rate = usageRate(purchases, 2)!;
    expect(rate.perDay).toBeCloseTo(12 / 12); // (10 + 2) kg over (10 + 2) days
    expect(rate.intervals).toBe(2);
  });

  test("purchases on the same day count as one", () => {
    const rate = usageRate([
      { loggedAt: at("2027-04-01"), quantity: 3 },
      { loggedAt: at("2027-04-01") + 3 * HOUR, quantity: 2 },
      { loggedAt: at("2027-04-06"), quantity: 1 },
    ])!;
    expect(rate.perDay).toBeCloseTo(1); // 5 kg over 5 days
    expect(usageRate([{ loggedAt: at("2027-04-01"), quantity: 3 }, { loggedAt: at("2027-04-01") + HOUR, quantity: 3 }])).toBeNull();
  });
});

describe("weekly and monthly totals", () => {
  test("weeks start on Monday (India time) and gaps show as zero", () => {
    expect(weekStart("2027-04-18")).toBe("2027-04-12"); // Sunday → Monday before
    expect(weekStart("2027-04-12")).toBe("2027-04-12");
    const lines = [
      { loggedAt: at("2027-04-13"), quantity: 2, totalPaise: 8_000 },
      { loggedAt: at("2027-04-18"), quantity: 1.5, totalPaise: 6_000 },
      { loggedAt: at("2027-04-28"), quantity: 1, totalPaise: 4_500 },
    ];
    expect(bucketTotals(lines, "week")).toEqual([
      { period: "2027-04-12", quantity: 3.5, totalPaise: 14_000, purchases: 2 },
      { period: "2027-04-19", quantity: 0, totalPaise: 0, purchases: 0 },
      { period: "2027-04-26", quantity: 1, totalPaise: 4_500, purchases: 1 },
    ]);
    expect(bucketTotals(lines, "month", { from: "2027-03-15", to: "2027-05-02" }).map((b) => [b.period, b.quantity])).toEqual([
      ["2027-03", 0],
      ["2027-04", 4.5],
      ["2027-05", 0],
    ]);
  });

  test("a purchase late at night counts on its India date", () => {
    // 11:30 PM on 30 April in India is still April (18:00 UTC).
    const late = Date.parse("2027-04-30T18:00:00Z");
    expect(bucketTotals([{ loggedAt: late, quantity: 1, totalPaise: 100 }], "month")[0].period).toBe("2027-04");
  });
});

async function setup() {
  const t = await setupTest("2027-04-01");
  const admin = await createAdmin(t);
  const south = await addProperty(t, admin, "South PG");
  const kirana = await createShop(t, admin, "Sharma Kirana");
  const dairy = await createShop(t, admin, "Gokul Dairy");
  const tomato = await createItem(t, admin, { name: "Tomato" });
  const milk = await createItem(t, admin, { name: "Milk", baseUnit: "litre", variants: ["Toned"] });
  const member = await createMember(t, admin, { propertyIds: [admin.propertyId, south] });
  const buy = (scope: Id<"properties"> | "shared", shopId: Id<"shops">, lines: { itemId: Id<"items">; quantity: number; totalPaise: number; variant?: string }[]) =>
    member.as.mutation(api.entries.create, {
      scope: scope === "shared" ? { kind: "shared" } : { kind: "property", propertyId: scope },
      shopId,
      lines,
      pricesConfirmed: true,
    });
  return { t, admin, south, kirana, dairy, tomato, milk, member, buy };
}

describe("entries log, item page and CSV", () => {
  test("filters by scope, item and person, with totals for the filtered lines", async () => {
    const c = await setup();
    await c.buy(c.admin.propertyId, c.kirana, [
      { itemId: c.tomato, quantity: 3, totalPaise: 12_000 },
      { itemId: c.milk, quantity: 2, totalPaise: 11_000 },
    ]);
    advance(2 * DAY);
    await c.buy(c.south, c.dairy, [{ itemId: c.milk, quantity: 4, totalPaise: 22_000, variant: "Toned" }]);
    advance(DAY);
    await c.buy("shared", c.kirana, [{ itemId: c.tomato, quantity: 10, totalPaise: 35_000 }]);
    const range = { fromDate: "2027-04-01", toDate: "2027-04-30" };

    const all = await c.admin.as.query(api.history.entriesLog, { scope: "all", ...range });
    expect(all.totals).toEqual({ entries: 3, lines: 4, totalPaise: 80_000 });

    const main = await c.admin.as.query(api.history.entriesLog, { scope: c.admin.propertyId, ...range });
    expect(main.totals).toEqual({ entries: 1, lines: 2, totalPaise: 23_000 });

    const shared = await c.admin.as.query(api.history.entriesLog, { scope: "shared", ...range });
    expect(shared.rows.map((r) => r.scopeName)).toEqual(["Shared"]);

    const milkOnly = await c.admin.as.query(api.history.entriesLog, { scope: "all", itemId: c.milk, ...range });
    expect(milkOnly.totals).toEqual({ entries: 2, lines: 2, totalPaise: 33_000 });
    expect(milkOnly.rows.map((r) => r.matchingPaise)).toEqual([22_000, 11_000]);

    const byOther = await c.admin.as.query(api.history.entriesLog, { scope: "all", enteredBy: c.admin.userId, ...range });
    expect(byOther.totals.entries).toBe(0);

    const april1 = await c.admin.as.query(api.history.entriesLog, { scope: "all", fromDate: "2027-04-01", toDate: "2027-04-01" });
    expect(april1.totals.entries).toBe(1);
  });

  test("deleted entries don't count", async () => {
    const c = await setup();
    const entryId = await c.buy(c.admin.propertyId, c.kirana, [{ itemId: c.tomato, quantity: 3, totalPaise: 12_000 }]);
    await c.member.as.mutation(api.entries.remove, { entryId });
    const log = await c.admin.as.query(api.history.entriesLog, { scope: "all", fromDate: "2027-04-01", toDate: "2027-04-30" });
    expect(log.totals.entries).toBe(0);
  });

  test("CSV has one row per line item and is audited", async () => {
    const c = await setup();
    await c.buy(c.admin.propertyId, c.kirana, [
      { itemId: c.tomato, quantity: 3, totalPaise: 12_000 },
      { itemId: c.milk, quantity: 2, totalPaise: 11_000, variant: "Toned" },
    ]);
    const { csv, rows } = await c.admin.as.mutation(api.history.exportCsv, { scope: "all", fromDate: "2027-04-01", toDate: "2027-04-30" });
    expect(rows).toBe(2);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toContain("Price per unit (Rs)");
    expect(lines.slice(1).map((l) => l.split(",").slice(2, 9))).toEqual([
      ["Main PG", "Sharma Kirana", "Kirana", "Grocery", "Tomato", "", "3"],
      ["Main PG", "Sharma Kirana", "Kirana", "Grocery", "Milk", "Toned", "2"],
    ]);
    expect(lines[1]).toContain(",120.00,40.00,");
    const audit = await c.t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(audit.some((a) => a.action === "report.exported")).toBe(true);
  });

  test("item page: per-scope usage, price history with shop and variant", async () => {
    const c = await setup();
    for (const [day, qty] of [[0, 3], [3, 3], [6, 6]] as const) {
      setToday(`2027-04-${String(1 + day).padStart(2, "0")}`);
      await c.buy(c.admin.propertyId, c.kirana, [{ itemId: c.tomato, quantity: qty, totalPaise: qty * 4_000 }]);
    }
    await c.buy("shared", c.kirana, [{ itemId: c.tomato, quantity: 10, totalPaise: 30_000 }]);
    const page = (await c.admin.as.query(api.history.item, { itemId: c.tomato, scope: "all", fromDate: "2027-04-01", toDate: "2027-04-30" }))!;
    expect(page.totals).toMatchObject({ purchases: 4, quantity: 22, totalPaise: 78_000 });
    expect(page.purchases[0]).toMatchObject({ shopName: "Sharma Kirana", unitPricePaise: 4_000, variant: null, scopeName: "Main PG" });
    const main = page.usage.find((u) => u.scopeName === "Main PG")!;
    expect(main.rate?.perDay).toBeCloseTo(1); // (3 + 3) kg over 6 days
    const shared = page.usage.find((u) => u.scopeName === "Shared")!;
    expect(shared.rate).toBeNull(); // one purchase: not enough data
    expect(page.monthly.map((m) => m.quantity)).toEqual([22]);
  });

  test("managers and kitchen staff can't call any history query", async () => {
    const c = await setup();
    const range = { fromDate: "2027-04-01", toDate: "2027-04-30" };
    for (const call of [
      c.member.as.query(api.history.entriesLog, { scope: c.admin.propertyId, ...range }),
      c.member.as.query(api.history.items, { scope: c.admin.propertyId }),
      c.member.as.query(api.history.item, { itemId: c.tomato, scope: c.admin.propertyId, ...range }),
      c.member.as.mutation(api.history.exportCsv, { scope: c.admin.propertyId, ...range }),
    ])
      expect(await errorCode(call)).toBe("FORBIDDEN");
  });

  test("bad scopes and ranges are refused", async () => {
    const c = await setup();
    expect(await errorCode(c.admin.as.query(api.history.entriesLog, { scope: "elsewhere", fromDate: "2027-04-01", toDate: "2027-04-30" }))).toBe("FORBIDDEN");
    expect(await errorCode(c.admin.as.query(api.history.entriesLog, { scope: "all", fromDate: "2027-05-01", toDate: "2027-04-30" }))).toBe("INVALID_DATE");
    expect(await errorCode(c.admin.as.query(api.history.entriesLog, { scope: "all", fromDate: "2025-01-01", toDate: "2027-04-30" }))).toBe("INVALID_DATE");
  });
});
