import { describe, expect, test } from "vitest";
import {
  checkPrice,
  lineQuantity,
  matchesSearch,
  median,
  rupeesToPaise,
  similarItems,
  lineShares,
  splitProblem,
  choiceOptions,
  isAllowedChoice,
  unitPricePaise,
  withinEditWindow,
} from "../lib/purchases";

const PACKS = [
  { label: "500 ml packet", quantity: 0.5 },
  { label: "5 L tin", quantity: 5 },
  { label: "200 g packet", quantity: 0.2 },
];

describe("unit price", () => {
  test("is total ÷ quantity, in paise per base unit", () => {
    expect(unitPricePaise(12_000, 3)).toBe(4_000); // ₹120 for 3 kg = ₹40/kg
    expect(unitPricePaise(10_000, 0.75)).toBe(13_333); // rounded to the paisa
    expect(unitPricePaise(110_000, 1)).toBe(110_000); // one LPG cylinder
  });

  test("needs a quantity above zero", () => {
    expect(() => unitPricePaise(100, 0)).toThrow();
  });

  test("typed rupees become whole paise", () => {
    expect(rupeesToPaise("120")).toBe(12_000);
    expect(rupeesToPaise("1,250.5")).toBe(125_050);
    expect(rupeesToPaise("₹ 42.05")).toBe(4_205);
    expect(rupeesToPaise("12.345")).toBeNull();
    expect(rupeesToPaise("abc")).toBeNull();
  });
});

describe("pack sizes", () => {
  test("4 × 500 ml packet is 2 litres, keeping the pack count and label", () => {
    expect(lineQuantity({ packLabel: "500 ml packet", packCount: 4 }, PACKS)).toEqual({
      quantity: 2,
      packLabel: "500 ml packet",
      packCount: 4,
    });
  });

  test("no floating-point dust (3 × 200 g = 0.6 kg)", () => {
    expect(lineQuantity({ packLabel: "200 g packet", packCount: 3 }, PACKS)?.quantity).toBe(0.6);
  });

  test("a quantity can be entered directly", () => {
    expect(lineQuantity({ quantity: 2.5 }, PACKS)).toEqual({ quantity: 2.5 });
  });

  test("unknown packs, zero and negative quantities are refused", () => {
    expect(lineQuantity({ packLabel: "1 L bottle", packCount: 2 }, PACKS)).toBeNull();
    expect(lineQuantity({ packLabel: "5 L tin", packCount: 0 }, PACKS)).toBeNull();
    expect(lineQuantity({ quantity: 0 }, PACKS)).toBeNull();
    expect(lineQuantity({ quantity: -1 }, PACKS)).toBeNull();
    expect(lineQuantity({}, PACKS)).toBeNull();
  });

  test("the unit price of a pack line uses the converted quantity", () => {
    const line = lineQuantity({ packLabel: "500 ml packet", packCount: 4 }, PACKS)!;
    expect(unitPricePaise(11_200, line.quantity)).toBe(5_600); // ₹112 for 2 L = ₹56/L
  });
});

describe("price sanity check", () => {
  const history = [4_000, 4_200, 3_800, 4_100, 3_900]; // median ₹40

  test("median", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  test("more than twice the median is questioned", () => {
    expect(checkPrice(8_001, history)).toEqual({ status: "high", medianPaise: 4_000 });
    expect(checkPrice(40_000, history).status).toBe("high"); // ₹400 typed for ₹40
  });

  test("less than half the median is questioned", () => {
    expect(checkPrice(1_999, history)).toEqual({ status: "low", medianPaise: 4_000 });
    expect(checkPrice(400, history).status).toBe("low");
  });

  test("anything between half and twice is fine, including exactly 2× and 0.5×", () => {
    for (const price of [2_000, 3_000, 4_000, 6_000, 8_000])
      expect(checkPrice(price, history).status, String(price)).toBe("ok");
  });

  test("only the last 5 purchases count", () => {
    const olderExpensive = [...history, 100_000, 100_000, 100_000, 100_000, 100_000, 100_000];
    expect(checkPrice(4_000, olderExpensive).status).toBe("ok");
  });

  test("with no earlier purchase there is nothing to compare", () => {
    expect(checkPrice(123_456, []).status).toBe("ok");
  });
});

describe("24-hour edit window", () => {
  const H = 3_600_000;
  test("open for 24 hours after logging, then closed", () => {
    expect(withinEditWindow(0, 23 * H)).toBe(true);
    expect(withinEditWindow(0, 24 * H)).toBe(true);
    expect(withinEditWindow(0, 24 * H + 1)).toBe(false);
  });
});

describe("search", () => {
  test("matches the name or any alias, by the start of a word", () => {
    expect(matchesSearch("tam", "Tomato", ["tamatar", "टमाटर"])).toBe(true);
    expect(matchesSearch("टमा", "Tomato", ["tamatar", "टमाटर"])).toBe(true);
    expect(matchesSearch("toned milk", "Milk", ["toned milk"])).toBe(true);
    expect(matchesSearch("onion", "Tomato", ["tamatar"])).toBe(false);
  });
});


describe("similar item names", () => {
  const items = [
    { name: "Tomato", aliases: ["tamatar", "टमाटर"] },
    { name: "Toor dal", aliases: ["arhar dal"] },
    { name: "Moong dal", aliases: [] },
    { name: "Milk", aliases: ["doodh"] },
    { name: "Potato", aliases: ["aloo"] },
  ];
  const names = (typed: string) => similarItems(typed, items).map((i) => i.name);

  test("finds the same thing written differently", () => {
    expect(names("tomato")).toContain("Tomato");
    expect(names("Tamaatar")).toEqual(["Tomato"]); // one letter off an other name
    expect(names("toor  daal")).toContain("Toor dal");
    expect(names("Dal")).toEqual(expect.arrayContaining(["Toor dal", "Moong dal"]));
    expect(names("doodh")).toEqual(["Milk"]);
    expect(names("Arhar")).toEqual(["Toor dal"]);
  });

  test("ignores unrelated names and very short input", () => {
    expect(names("Onion")).toEqual([]);
    expect(names("a")).toEqual([]);
  });
});

describe("splitting a Shared line between properties", () => {
  test("parts must be positive, once per property, and add up", () => {
    expect(splitProblem([{ propertyId: "a", quantity: 6 }, { propertyId: "b", quantity: 4 }], 10)).toBeNull();
    expect(splitProblem([{ propertyId: "a", quantity: 6 }, { propertyId: "b", quantity: 3 }], 10)).toMatch(/adds up to 9/);
    expect(splitProblem([{ propertyId: "a", quantity: 6 }, { propertyId: "a", quantity: 4 }], 10)).toMatch(/only once/);
    expect(splitProblem([{ propertyId: "a", quantity: 0.1 }, { propertyId: "b", quantity: 0.2 }], 0.3)).toBeNull();
  });
  test("each property's share of the amount follows its quantity and adds up to the paisa", () => {
    const shares = lineShares({ scopeKey: "shared", quantity: 3, totalPaise: 10_000, split: [{ propertyId: "a", quantity: 1 }, { propertyId: "b", quantity: 2 }] });
    expect(shares).toEqual([{ scopeKey: "a", quantity: 1, totalPaise: 3_333 }, { scopeKey: "b", quantity: 2, totalPaise: 6_667 }]);
    expect(lineShares({ scopeKey: "shared", quantity: 3, totalPaise: 10_000 })).toEqual([{ scopeKey: "shared", quantity: 3, totalPaise: 10_000 }]);
  });
  test("variants and brands always offer None and Loose", () => {
    expect(choiceOptions(["Toned", "loose"])).toEqual(["", "Loose", "Toned"]);
    expect(isAllowedChoice("Loose", [])).toBe(true);
    expect(isAllowedChoice("Amul", ["Amul"])).toBe(true);
    expect(isAllowedChoice("Other", ["Amul"])).toBe(false);
    expect(isAllowedChoice(undefined, [])).toBe(true);
  });
});
