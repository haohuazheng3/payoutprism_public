import { afterEach, describe, expect, it, vi } from "vitest";
import poshmark, { OVERWEIGHT_DEDUCTION_FROM, overweightDeductionActive, sellerFee } from "@/fees/platforms/poshmark";
import { solvePrice } from "@/fees/solve";
import { M } from "@/fees/markets";
import type { Inputs, Market } from "@/fees/types";
import { checkContract, line, run } from "./helpers";
import { fieldHelp, fieldOptions } from "@/components/calculator/util";

/** Lowest price the solver returns must reach the goal, and one cent less must not. */
function expectMinimal(market: Market, inputs: Inputs, goal: number, expected?: number) {
  const s = solvePrice(poshmark, inputs, market, "payout", goal);
  expect(s.price).not.toBeNull();
  if (expected !== undefined) expect(s.price).toBe(expected);
  expect(s.result!.payout).toBeGreaterThanOrEqual(goal);
  // Brute force: no cheaper price anywhere (including below the threshold) reaches the goal.
  for (let p = s.price! - 1; p >= Math.max(0, s.price! - 3000); p--) {
    const r = poshmark.calculate({ ...inputs, price: p / 100 }, market);
    expect(r.payout).toBeLessThan(goal);
  }
}

describe("poshmark", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("meets the module contract in every market", () => {
    expect(checkContract(poshmark)).toEqual([]);
  });

  it("official example: Texas Seller Fee Tax on a $100 sale is $1.32 (8.25% × 80% × $20)", () => {
    const r = run(poshmark, "us", { price: 100, texas: true, texasRate: 8.25 });
    expect(line(r, "seller-fee")).toBe(2000);
    expect(line(r, "texas")).toBe(132);
    expect(r.payout).toBe(10000 - 2000 - 132); // research D4: $78.68
  });

  it("US default: $30 sale keeps $24.00, buyer pays $6.49 shipping on top", () => {
    const r = run(poshmark, "us");
    expect(line(r, "seller-fee")).toBe(600);
    expect(r.totalFees).toBe(600);
    expect(r.payout).toBe(2400);
    expect(r.buyerFees.find((l) => l.id === "buyer-shipping")!.amount).toBe(649);
    expect(r.buyerPays).toBe(3649);
  });

  it("D1: $10 sale pays the flat $2.95 and keeps $7.05", () => {
    const r = run(poshmark, "us", { price: 10 });
    expect(line(r, "seller-fee")).toBe(295);
    expect(r.payout).toBe(705);
  });

  it("D2: US threshold — $14.99 keeps $12.04, $15.00 keeps $12.00, $15.05 keeps $12.04", () => {
    expect(sellerFee(1499, M.us)).toBe(295);
    expect(sellerFee(1500, M.us)).toBe(300);
    expect(run(poshmark, "us", { price: 14.99 }).payout).toBe(1204);
    expect(run(poshmark, "us", { price: 15 }).payout).toBe(1200);
    expect(run(poshmark, "us", { price: 15.04 }).payout).toBe(1203);
    expect(run(poshmark, "us", { price: 15.05 }).payout).toBe(1204);
  });

  it("flags the payout drop just above the threshold and points to the better price", () => {
    const r = run(poshmark, "us", { price: 15 });
    expect(r.notes.some((n) => n.includes("$14.99") && n.includes("$15.05"))).toBe(true);
    expect(run(poshmark, "us", { price: 15.05 }).notes.some((n) => n.includes("$14.99"))).toBe(false);
  });

  it("D3: $50 offer with free shipping (whole $6.49 label) keeps $33.51; the fee ignores the discount", () => {
    const r = run(poshmark, "us", { price: 50, shippingDiscount: 6.49 });
    expect(line(r, "seller-fee")).toBe(1000);
    expect(line(r, "shipping-discount")).toBe(649);
    expect(r.payout).toBe(3351);
    expect(r.buyerPays).toBe(5000);
  });

  it("a shipping discount larger than the label is capped at the label", () => {
    const r = run(poshmark, "us", { price: 50, shippingDiscount: 20 });
    expect(line(r, "shipping-discount")).toBe(649);
  });

  it("D4: Texas seller on a $10 sale pays $0.19 (2.95 × 80% × 8.25% = 0.1947)", () => {
    const r = run(poshmark, "us", { price: 10, texas: true });
    expect(line(r, "texas")).toBe(19);
    expect(r.payout).toBe(686);
  });

  it("D5: $40 bundle in a 7 lb box pays the $5 upgrade; Instant Transfer costs $2 more", () => {
    const r = run(poshmark, "us", { price: 40, weight: "10" });
    expect(line(r, "seller-fee")).toBe(800);
    expect(line(r, "label-upgrade")).toBe(500);
    expect(r.payout).toBe(2700);
    const instant = run(poshmark, "us", { price: 40, weight: "10", cashOut: "instant" });
    expect(line(instant, "cash-out")).toBe(200);
    expect(instant.payout).toBe(2500);
  });

  it("US 10.01–15 lb upgrade is $10; PayPal/Venmo transfer is $0.35", () => {
    const r = run(poshmark, "us", { price: 60, weight: "15", cashOut: "paypal" });
    expect(line(r, "label-upgrade")).toBe(1000);
    expect(line(r, "cash-out")).toBe(35);
  });

  it("over 15 lb on one label: $15 deducted only from October 26, 2026", () => {
    expect(overweightDeductionActive(Date.UTC(2026, 9, 23))).toBe(false);
    expect(overweightDeductionActive(OVERWEIGHT_DEDUCTION_FROM - 1)).toBe(false);
    expect(overweightDeductionActive(OVERWEIGHT_DEDUCTION_FROM)).toBe(true);
    expect(overweightDeductionActive(Date.UTC(2026, 10, 1))).toBe(true);
  });

  it("over 15 lb on one label through calculate(): $0 on October 25, 2026, $15.00 from October 26 (00:00 PT)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-26T06:59:00Z")); // 23:59 PDT on Oct 25
    const before = run(poshmark, "us", { price: 40, weight: "25" });
    expect(line(before, "label-upgrade")).toBe(0);
    expect(before.payout).toBe(4000 - 800);
    const hint = (fieldOptions(poshmark.fields.find((f) => f.id === "weight")!, poshmark.defaults(M.us), M.us).find((o) => o.value === "25")!.hint)!;
    expect(hint).toContain("from Oct 26, 2026");
    vi.setSystemTime(new Date("2026-10-26T07:00:00Z")); // 00:00 PDT on Oct 26
    const after = run(poshmark, "us", { price: 40, weight: "25" });
    expect(line(after, "label-upgrade")).toBe(1500);
    expect(after.payout).toBe(4000 - 800 - 1500); // $17.00
    // The 5.01–10 lb upgrade is the same $5.00 on both sides of the date.
    expect(line(run(poshmark, "us", { price: 40, weight: "10" }), "label-upgrade")).toBe(500);
  });

  it("Texas tax on the flat fee at the 6.25% state-only rate: $12 sale pays $0.15 (2.95 × 80% × 6.25% = 0.1475)", () => {
    const r = run(poshmark, "us", { price: 12, texas: true, texasRate: 6.25 });
    expect(line(r, "seller-fee")).toBe(295);
    expect(line(r, "texas")).toBe(15);
    expect(r.payout).toBe(890);
    // Rates outside 6.25%–8.25% are clamped: 10% is treated as 8.25%.
    expect(line(run(poshmark, "us", { price: 100, texas: true, texasRate: 10 }), "texas")).toBe(132);
  });

  it("D6: Canada threshold, Ontario 13% HST — C$19.99 keeps C$15.53, C$20.00 keeps C$15.48", () => {
    const below = run(poshmark, "ca", { price: 19.99, province: "on" });
    expect(line(below, "seller-fee")).toBe(395);
    expect(line(below, "fee-tax")).toBe(51); // 13% × 3.95 = 0.5135
    expect(below.payout).toBe(1553);
    const at = run(poshmark, "ca", { price: 20, province: "on" });
    expect(line(at, "seller-fee")).toBe(400);
    expect(line(at, "fee-tax")).toBe(52);
    expect(at.payout).toBe(1548);
  });

  it("D7: Alberta seller, C$50 sale: 20% + 5% GST keeps C$39.50; PayPal payout C$0.50 more", () => {
    const r = run(poshmark, "ca", { price: 50, province: "ab" });
    expect(line(r, "seller-fee")).toBe(1000);
    expect(line(r, "fee-tax")).toBe(50);
    expect(r.payout).toBe(3950);
    expect(run(poshmark, "ca", { price: 50, province: "ab", cashOut: "paypal" }).payout).toBe(3900);
  });

  it("Canada default: C$30 in Ontario keeps C$23.22; buyer pays C$12.49 Canada Post", () => {
    const r = run(poshmark, "ca");
    expect(r.totalFees).toBe(678);
    expect(r.payout).toBe(2322);
    expect(r.buyerPays).toBe(3000 + 1249);
    expect(run(poshmark, "ca", { caShipping: "purolator" }).buyerPays).toBe(3000 + 699);
  });

  it("B.C. seller selling to a B.C. buyer pays 5% GST + 7% PST on the fee", () => {
    const r = run(poshmark, "ca", { price: 50, province: "bc", bcBuyer: true });
    expect(line(r, "fee-tax")).toBe(50);
    expect(line(r, "bc-pst")).toBe(70);
    expect(r.payout).toBe(3880);
    // Not for sellers in other provinces, even if the toggle is on.
    expect(run(poshmark, "ca", { price: 50, province: "on", bcBuyer: true }).fees.some((l) => l.id === "bc-pst")).toBe(false);
  });

  it("Canada heavier label: 3.5 kg is C$2 plus GST/HST (Ontario: C$2.26); Nova Scotia HST is 14%", () => {
    expect(line(run(poshmark, "ca", { price: 50, weight: "3.5" }), "label-upgrade")).toBe(226);
    expect(line(run(poshmark, "ca", { price: 50, weight: "5", province: "ab" }), "label-upgrade")).toBe(525);
    expect(line(run(poshmark, "ca", { price: 50, province: "ns" }), "fee-tax")).toBe(140);
  });

  it("New Brunswick 15% HST at the threshold: C$19.99 keeps C$15.45, C$20.00 keeps C$15.40", () => {
    const below = run(poshmark, "ca", { price: 19.99, province: "nb" });
    expect(line(below, "fee-tax")).toBe(59); // 15% × 3.95 = 0.5925
    expect(below.payout).toBe(1545);
    const at = run(poshmark, "ca", { price: 20, province: "nb" });
    expect(line(at, "fee-tax")).toBe(60);
    expect(at.payout).toBe(1540);
  });

  it("Quebec, 4 kg, Purolator, free shipping: discount capped at the C$6.99 label, C$3 upgrade + 5% GST", () => {
    const r = run(poshmark, "ca", { price: 45, province: "qc", weight: "4", caShipping: "purolator", shippingDiscount: 10 });
    expect(line(r, "seller-fee")).toBe(900);
    expect(line(r, "fee-tax")).toBe(45);
    expect(line(r, "shipping-discount")).toBe(699);
    expect(line(r, "label-upgrade")).toBe(315);
    expect(r.payout).toBe(4500 - 900 - 45 - 699 - 315); // C$25.41
    expect(r.buyerPays).toBe(4500);
  });

  it("B.C. to B.C., C$100 sale, Visa Instant Transfer: 20% + 5% GST + 7% PST + C$2.00", () => {
    const r = run(poshmark, "ca", { price: 100, province: "bc", bcBuyer: true, cashOut: "instant" });
    expect(line(r, "bc-pst")).toBe(140);
    expect(line(r, "cash-out")).toBe(200);
    expect(r.payout).toBe(10000 - 2000 - 100 - 140 - 200); // C$75.60
  });

  it("help and cash-out choices follow the market", () => {
    const cash = poshmark.fields.find((f) => f.id === "cashOut")!;
    expect(fieldOptions(cash, poshmark.defaults(M.us), M.us).map((o) => o.label)).toContain("PayPal / Venmo");
    expect(fieldOptions(cash, poshmark.defaults(M.ca), M.ca).map((o) => o.label)).not.toContain("PayPal / Venmo");
    expect(fieldHelp(cash, poshmark.defaults(M.ca), M.ca)).toContain("CA$0.50");
    const discount = poshmark.fields.find((f) => f.id === "shippingDiscount")!;
    expect(fieldHelp(discount, poshmark.defaults(M.us), M.us)).toContain("$6.49");
    expect(fieldHelp(discount, poshmark.defaults(M.ca), M.ca)).toContain("CA$12.49");
  });

  it("Canada threshold note uses C$20 and the 20.06 escape price", () => {
    const r = run(poshmark, "ca", { price: 20 });
    expect(r.notes.some((n) => n.includes("$19.99") && n.includes("$20.06"))).toBe(true);
  });

  it("breakpoints are the flat-fee thresholds", () => {
    expect(poshmark.breakpoints!(poshmark.defaults(M.us), M.us)).toEqual([1500]);
    expect(poshmark.breakpoints!(poshmark.defaults(M.ca), M.ca)).toEqual([2000]);
  });

  it("reverse mode finds the true lowest price across the payout drop (US)", () => {
    const inputs = poshmark.defaults(M.us);
    expectMinimal(M.us, inputs, 1204, 1499); // $14.99 beats $15.00–$15.04
    expectMinimal(M.us, inputs, 1205, 1506); // above the drop
    expectMinimal(M.us, inputs, 2000);
  });

  it("reverse mode across the drop for a Texas seller (8.25%): $11.85 → $14.99, $11.86 → $15.07, $12.04 → $15.30", () => {
    const inputs = { ...poshmark.defaults(M.us), texas: true };
    expectMinimal(M.us, inputs, 1185, 1499); // 14.99 − 2.95 − 0.19
    expectMinimal(M.us, inputs, 1186, 1507); // 15.07 − 3.01 − 0.20
    expectMinimal(M.us, inputs, 1204, 1530); // 15.30 − 3.06 − 0.20
  });

  it("reverse mode across the drop in Canada, with HST and a heavier label", () => {
    const inputs = { ...poshmark.defaults(M.ca), weight: "3" };
    expectMinimal(M.ca, inputs, 1440);
    expectMinimal(M.ca, inputs, 1442);
    expectMinimal(M.ca, poshmark.defaults(M.ca), 1553, 1999);
    expectMinimal(M.ca, poshmark.defaults(M.ca), 1554);
    expectMinimal(M.ca, { ...poshmark.defaults(M.ca), province: "nb" }, 1546, 2007); // 20.07 − 4.01 − 0.60
    expectMinimal(M.ca, { ...poshmark.defaults(M.ca), province: "ab" }, 1585, 2006); // 20.06 − 4.01 − 0.20
  });

  it("compare maps to a US sale where the buyer pays the label", () => {
    const inputs = { ...poshmark.defaults(M.us), ...poshmark.compare!.map({ price: 50, shipping: 6, itemCost: 10, shippingCost: 5 }) } as Inputs;
    const r = poshmark.calculate(inputs, M.us);
    expect(r.payout).toBe(4000);
    expect(r.profit).toBe(3000);
    // $0 shipping on the compare page = free shipping: the seller covers the whole $6.49 label.
    const free = { ...poshmark.defaults(M.us), ...poshmark.compare!.map({ price: 50, shipping: 0, itemCost: 10, shippingCost: 5 }) } as Inputs;
    const f = poshmark.calculate(free, M.us);
    expect(line(f, "shipping-discount")).toBe(649);
    expect(f.payout).toBe(3351);
    expect(f.buyerPays).toBe(5000);
  });
});
