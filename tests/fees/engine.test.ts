import { describe, expect, it } from "vitest";
import { pct, roundCents, toCents, formatRate } from "@/fees/money";
import { solvePrice } from "@/fees/solve";
import type { CalculatorDef, Inputs, Market } from "@/fees/types";
import { assemble } from "@/fees/money";
import { M } from "@/fees/markets";
import { parseAmount } from "@/components/calculator/util";
import { ladderPrices } from "@/components/calculator/PriceLadder";

describe("money", () => {
  it("rounds half away from zero without binary noise", () => {
    expect(roundCents(1.005 * 100)).toBe(101);
    expect(roundCents(162.5)).toBe(163);
    expect(roundCents(-162.5)).toBe(-163);
    expect(pct(2500, 6.5)).toBe(163);
    expect(toCents("24.99")).toBe(2499);
    expect(toCents(-3)).toBe(0);
    expect(formatRate(6.5)).toBe("6.5%");
    expect(formatRate(0.48)).toBe("0.48%");
  });

  it("parses what people type", () => {
    expect(parseAmount("1,234.50")).toBe(1234.5);
    expect(parseAmount("12,50")).toBe(12.5);
    expect(parseAmount("1.234,50")).toBe(1234.5);
    expect(parseAmount("$28")).toBe(28);
    expect(parseAmount("")).toBeNull();
  });

  it("ladder prices are sorted, positive and include the current price", () => {
    const p = ladderPrices(2800);
    expect(p).toContain(2800);
    expect([...p].sort((a, b) => a - b)).toEqual(p);
    expect(p.every((x) => x > 0)).toBe(true);
  });
});

/** A Poshmark-like platform: flat $3 under $20, 20% from $20 — payout DROPS at the threshold. */
const flat: CalculatorDef = {
  slug: "test",
  name: "Test",
  path: "/t",
  category: "marketplaces",
  priceNoun: "price",
  sellerNoun: "seller",
  blurb: "",
  markets: [M.us],
  defaultMarket: "us",
  priceField: "price",
  fields: [{ id: "price", kind: "money", label: "Price", section: "sale" }],
  defaults: () => ({ price: 10 }),
  calculate: (inputs: Inputs, market: Market) => {
    const p = toCents(inputs.price);
    const fee = p < 2000 ? 300 : pct(p, 20);
    return assemble({ market, buyerPays: p, saleAmount: p, fees: [{ id: "f", label: "Fee", amount: fee, kind: "platform" }] });
  },
  breakpoints: () => [2000],
  verifiedAt: "2026-10-23",
  sources: [],
  changes: [],
  schedule: () => [],
};

describe("reverse solver", () => {
  it("finds the minimum price across a payout drop at a threshold", () => {
    // Keep $16.50: below $20 → p − 3 ≥ 16.50 → p = 19.50
    expect(solvePrice(flat, { price: 0 }, M.us, "payout", 1650).price).toBe(1950);
    // Keep $16.80: still reachable below the threshold at $19.80
    expect(solvePrice(flat, { price: 0 }, M.us, "payout", 1680).price).toBe(1980);
    // Keep $17.00: below $20 max is $16.99, at $20+ need 0.8p ≥ 17 → p = 21.25
    expect(solvePrice(flat, { price: 0 }, M.us, "payout", 1700).price).toBe(2125);
  });
});
