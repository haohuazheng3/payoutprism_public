import { describe, expect, it } from "vitest";
import offerup, { CATEGORIES, PREMIUM_MONTHLY, PROMOTE_PLUS_MONTHLY, PROMOTE_PLUS_YEARLY } from "@/fees/platforms/offerup";
import { solvePrice } from "@/fees/solve";
import { M } from "@/fees/markets";
import type { Inputs } from "@/fees/types";
import { checkContract, line, run } from "./helpers";

describe("offerup", () => {
  it("meets the module contract", () => {
    expect(checkContract(offerup)).toEqual([]);
  });

  it("official prices are the ones on OfferUp's help pages", () => {
    expect(PROMOTE_PLUS_MONTHLY).toBe(1999); // "$19.99 per month"
    expect(PROMOTE_PLUS_YEARLY).toBe(9999); // "$99.99 per year (58% savings)"
    expect(PREMIUM_MONTHLY).toBe(799); // "$7.99 per month"
    // OfferUp's "58% savings": 1 − 99.99 / (12 × 19.99) = 58.3%
    expect(Math.round((1 - PROMOTE_PLUS_YEARLY / (12 * PROMOTE_PLUS_MONTHLY)) * 100)).toBe(58);
    expect(Object.fromEntries(CATEGORIES.map((c) => [c.value, c.free]))).toEqual({
      other: 200,
      cars: 1,
      motorcycles: 1,
      appliances: 15,
      phones: 15,
      furniture: 25,
      jewelry: 25,
      tools: 25,
    });
  });

  it("research Ex1: $100 local cash sale, no paid features → no fees, keep $100", () => {
    const r = run(offerup, "us", { price: 100 });
    expect(line(r, "selling")).toBe(0);
    expect(line(r, "listing")).toBe(0);
    expect(r.totalFees).toBe(0);
    expect(r.buyerFees).toEqual([]);
    expect(r.buyerPays).toBe(10000);
    expect(r.payout).toBe(10000);
    expect(r.effectiveRate).toBe(0);
  });

  it("default case shows the zero selling fee and the free listing allowance", () => {
    const r = run(offerup, "us");
    expect(r.saleAmount).toBe(10000);
    expect(r.payout).toBe(10000);
    expect(r.fees.map((l) => l.id)).toEqual(["selling", "listing"]);
    expect(r.fees.find((l) => l.id === "listing")!.detail).toContain("200 free listings a month");
    expect(r.notes[0]).toContain("12.9%");
  });

  it("research Ex2: $250 sale with a month of Promote Plus (one sale) → keep $230.01", () => {
    const r = run(offerup, "us", { price: 250, promotion: "plus-monthly", salesPerMonth: 1 });
    expect(line(r, "promotion")).toBe(1999);
    expect(r.payout).toBe(23001);
  });

  it("Promote Plus is spread across the month's sales, rounded to the cent", () => {
    expect(line(run(offerup, "us", { promotion: "plus-monthly", salesPerMonth: 4 }), "promotion")).toBe(500); // 19.99 / 4 = 4.9975
    expect(line(run(offerup, "us", { promotion: "plus-monthly", salesPerMonth: 2 }), "promotion")).toBe(1000); // 9.995 → 10.00
    expect(line(run(offerup, "us", { promotion: "plus-yearly", salesPerMonth: 1 }), "promotion")).toBe(833); // 99.99 / 12 = 8.3325
    expect(line(run(offerup, "us", { promotion: "plus-yearly", salesPerMonth: 2 }), "promotion")).toBe(417); // 4.16625
    expect(line(run(offerup, "us", { promotion: "plus-yearly", salesPerMonth: 4 }), "promotion")).toBe(208); // 2.083125
    const r = run(offerup, "us", { price: 150, promotion: "plus-yearly", salesPerMonth: 2 });
    expect(r.payout).toBe(15000 - 417);
  });

  it("sales per month is at least 1 and a whole number", () => {
    expect(line(run(offerup, "us", { promotion: "plus-monthly", salesPerMonth: 0 }), "promotion")).toBe(1999);
    expect(line(run(offerup, "us", { promotion: "plus-monthly", salesPerMonth: 2.4 }), "promotion")).toBe(1000);
  });

  it("one-off promotion uses what the seller paid", () => {
    const r = run(offerup, "us", { price: 60, promotion: "single", promoCost: 7.98 });
    expect(line(r, "promotion")).toBe(798);
    expect(r.payout).toBe(6000 - 798);
    // Before anything is typed the line stays visible at $0 and prompts for the amount.
    const empty = run(offerup, "us", { promotion: "single" });
    expect(line(empty, "promotion")).toBe(0);
    expect(empty.fees.find((l) => l.id === "promotion")!.detail).toMatch(/Enter/);
  });

  it("paid listing over the free limit, with the category's allowance in the detail", () => {
    const r = run(offerup, "us", { price: 400, category: "phones", listingFee: 5 });
    expect(line(r, "listing")).toBe(500);
    expect(r.fees.find((l) => l.id === "listing")!.label).toBe("Paid listing");
    expect(r.fees.find((l) => l.id === "listing")!.detail).toContain("15 free listings a month in Cell Phones & Accessories");
    const car = run(offerup, "us", { price: 8000, category: "cars" });
    expect(line(car, "listing")).toBe(0);
    expect(car.fees.find((l) => l.id === "listing")!.detail).toBe("Free · 1 free listing a month in Cars & Trucks");
  });

  it("OfferUp Premium is shared across the month's sales", () => {
    const r = run(offerup, "us", { premium: true, salesPerMonth: 2 });
    expect(line(r, "premium")).toBe(400); // 7.99 / 2 = 3.995
    const both = run(offerup, "us", { premium: true, promotion: "plus-monthly", salesPerMonth: 4 });
    expect(line(both, "premium")).toBe(200); // 1.9975
    expect(both.totalFees).toBe(700);
  });

  it("payment app fee: percent of the price plus a fixed amount, only when an app is chosen", () => {
    const r = run(offerup, "us", { price: 100, payMethod: "app", appRate: 2.5, appFixed: 0.3 });
    expect(line(r, "app")).toBe(280);
    expect(r.payout).toBe(9720);
    expect(run(offerup, "us", { appRate: 2.5 }).fees.some((l) => l.id === "app")).toBe(false);
    expect(line(run(offerup, "us", { price: 33.33, payMethod: "app", appRate: 1.5 }), "app")).toBe(50); // 0.49995 → 0.50
  });

  it("profit counts the seller's own costs", () => {
    const r = run(offerup, "us", { price: 100, itemCost: 40, otherCost: 5, promotion: "plus-monthly", salesPerMonth: 4 });
    expect(r.payout).toBe(9500);
    expect(r.profit).toBe(9500 - 4500);
    expect(r.costs.find((l) => l.id === "otherCost")!.label).toBe("Gas, cleaning & other costs");
  });

  it("a promotion bigger than the sale is flagged", () => {
    const r = run(offerup, "us", { price: 10, promotion: "plus-monthly", salesPerMonth: 1 });
    expect(r.payout).toBe(1000 - 1999);
    expect(r.warnings.length).toBe(1);
  });

  it("compare maps to a local sale with no shipping", () => {
    const inputs = { ...offerup.defaults(M.us), ...offerup.compare!.map({ price: 50, shipping: 8, itemCost: 20, shippingCost: 7 }) } as Inputs;
    const r = offerup.calculate(inputs, M.us);
    expect(r.buyerPays).toBe(5000);
    expect(r.totalFees).toBe(0);
    expect(r.profit).toBe(3000);
  });

  it("schedule and change log record the end of shipping and the old 12.9% fee", () => {
    expect(offerup.changes.map((c) => c.date)).toEqual(["2025-10-21", "2025-09-23"]);
    expect(offerup.changes.every((c) => !c.upcoming)).toBe(true);
    const row = offerup.schedule(M.us).find((r) => r.fee === "Shipping service fee")!;
    expect(row.amount).toContain("12.9%");
    expect(row.amount).toContain("$1.99");
  });

  it("reverse mode: the price that keeps $100 after monthly Promote Plus", () => {
    const m = M.us;
    const inputs = { ...offerup.defaults(m), promotion: "plus-monthly", salesPerMonth: 1 };
    const s = solvePrice(offerup, inputs, m, "payout", 10000);
    expect(s.price).toBe(11999);
    expect(s.result!.payout).toBeGreaterThanOrEqual(10000);
    expect(offerup.calculate({ ...inputs, price: (s.price! - 1) / 100 }, m).payout).toBeLessThan(10000);
  });

  it("reverse mode with a payment-app percentage finds the lowest cent", () => {
    const m = M.us;
    const inputs = { ...offerup.defaults(m), payMethod: "app", appRate: 2.99, appFixed: 0 };
    const s = solvePrice(offerup, inputs, m, "payout", 5000);
    expect(s.price).not.toBeNull();
    expect(s.result!.payout).toBeGreaterThanOrEqual(5000);
    expect(offerup.calculate({ ...inputs, price: (s.price! - 1) / 100 }, m).payout).toBeLessThan(5000);
  });

  it("hand-computed cases: odd splits, a PayPal-style percentage plus fixed fee, stacked subscriptions", () => {
    // $19.99 / 3 = $6.6633 → $6.66; $100 − $6.66 = $93.34
    const three = run(offerup, "us", { price: 100, promotion: "plus-monthly", salesPerMonth: 3 });
    expect(line(three, "promotion")).toBe(666);
    expect(three.payout).toBe(9334);
    // $99.99 / 12 / 3 = $2.7775 → $2.78
    expect(line(run(offerup, "us", { promotion: "plus-yearly", salesPerMonth: 3 }), "promotion")).toBe(278);
    // 2.99% × $100 = $2.99, + $0.49 = $3.48 → keep $96.52
    const app = run(offerup, "us", { price: 100, payMethod: "app", appRate: 2.99, appFixed: 0.49 });
    expect(line(app, "app")).toBe(348);
    expect(app.payout).toBe(9652);
    // 1.9% × $33.33 = $0.633 → $0.63, + $0.10 = $0.73 → keep $32.60
    expect(run(offerup, "us", { price: 33.33, payMethod: "app", appRate: 1.9, appFixed: 0.1 }).payout).toBe(3260);
    // Premium $7.99 / 5 = $1.598 → $1.60; yearly Promote Plus $99.99 / 60 = $1.6665 → $1.67; $80 − $3.27 = $76.73
    const both = run(offerup, "us", { price: 80, premium: true, promotion: "plus-yearly", salesPerMonth: 5 });
    expect(both.totalFees).toBe(327);
    expect(both.payout).toBe(7673);
    // A paid Cars & Trucks listing, entered by the seller
    expect(run(offerup, "us", { price: 5000, category: "cars", listingFee: 7.99 }).payout).toBe(499201);
    // One cent sells for one cent
    expect(run(offerup, "us", { price: 0.01 }).payout).toBe(1);
  });

  it("no breakpoints: the formula never changes shape", () => {
    expect(offerup.breakpoints!(offerup.defaults(M.us), M.us)).toEqual([]);
  });

  it("reverse mode: PayPal-style 2.99% + $0.49 to keep $50.00 needs $52.05", () => {
    // $52.05 − round(1.556) $1.56 − $0.49 = $50.00; $52.04 − $1.56 − $0.49 = $49.99
    const m = M.us;
    const inputs = { ...offerup.defaults(m), payMethod: "app", appRate: 2.99, appFixed: 0.49 };
    expect(solvePrice(offerup, inputs, m, "payout", 5000).price).toBe(5205);
  });

  it("reverse mode for profit and margin", () => {
    const m = M.us;
    // $20 profit on a $40 item with yearly Promote Plus over 4 sales ($2.08): $40 + $20 + $2.08 = $62.08
    const p = solvePrice(offerup, { ...offerup.defaults(m), itemCost: 40, promotion: "plus-yearly", salesPerMonth: 4 }, m, "profit", 2000);
    expect(p.price).toBe(6208);
    expect(p.result!.profit).toBe(2000);
    // 20% margin on a $40 item with no fees: $50.00
    expect(solvePrice(offerup, { ...offerup.defaults(m), itemCost: 40 }, m, "margin", 0.2).price).toBe(5000);
  });

  it("costs subtitle doesn’t mention postage: OfferUp sales are local pickup", () => {
    expect(offerup.costsHint).toBeDefined();
    expect(offerup.costsHint).not.toMatch(/postage|shipping/i);
  });

  it("with no paid features the price to ask equals the amount you want", () => {
    const m = M.us;
    const s = solvePrice(offerup, offerup.defaults(m), m, "payout", 7500);
    expect(s.price).toBe(7500);
  });
});
