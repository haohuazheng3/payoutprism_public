import { describe, expect, it } from "vitest";
import fba, { fbaSeason, fulfillmentFee, placementRange, priceBand, sizeTier, storageSeason, weightBand, type FeeType, type Season } from "@/fees/platforms/amazon-fba";
import { solvePrice } from "@/fees/solve";
import { M } from "@/fees/markets";
import { checkContract, line, run } from "./helpers";

const fee = (dims: number[], lb: number, type: FeeType, season: Season, price: number) => {
  const s = sizeTier(dims, lb);
  return fulfillmentFee(s, type, season, priceBand(Math.round(price * 100))).amount;
};

describe("amazon-fba", () => {
  it("meets the module contract", () => {
    expect(checkContract(fba)).toEqual([]);
  });

  it("default: $19.99 small standard item (10 × 7 × 0.7 in, 8 oz), Home & Kitchen, peak", () => {
    const r = run(fba, "us", { season: "peak", storageSeason: "peak" });
    expect(line(r, "referral")).toBe(300); // 15% × 19.99 = 2.9985
    expect(line(r, "fulfillment")).toBe(374); // small standard 6+ to 8 oz, $10–$50, peak
    expect(line(r, "fuel")).toBe(13); // 3.5% × 3.74 = 0.1309
    expect(line(r, "storage")).toBe(7); // 49/1728 cu ft × $2.40
    expect(line(r, "subscription")).toBe(40);
    expect(r.totalFees).toBe(734);
    expect(r.payout).toBe(1265);
  });

  // Official examples on "2026 US FBA fulfillment fee changes" (non-peak / peak, surcharge excluded).
  it("official: mobile device case 13.8 × 9 × 0.7 in, 2.88 oz, under $10 → $2.49 / $2.68", () => {
    const s = sizeTier([13.8, 9, 0.7], 2.88 / 16);
    expect(s.tier).toBe("small-standard");
    expect(weightBand(s, "nonApparel")).toBe("2+ to 4 oz");
    expect(fee([13.8, 9, 0.7], 2.88 / 16, "nonApparel", "nonpeak", 9)).toBe(249);
    expect(fee([13.8, 9, 0.7], 2.88 / 16, "nonApparel", "peak", 9)).toBe(268);
  });

  it("official: T-shirt (apparel) at a 1.65 lb shipping weight → $6.14 / $6.53; Low-Price $5.32 / $5.71", () => {
    // Amazon's example states a 1.65 lb dimensional weight (its own dimensions give less), so feed that weight.
    const dims = [13, 9, 0.85];
    expect(sizeTier(dims, 1.65).tier).toBe("large-standard");
    expect(fee(dims, 1.65, "apparel", "nonpeak", 20)).toBe(614);
    expect(fee(dims, 1.65, "apparel", "peak", 20)).toBe(653);
    expect(fee(dims, 1.65, "apparel", "nonpeak", 9)).toBe(532);
    expect(fee(dims, 1.65, "apparel", "peak", 9)).toBe(571);
  });

  it("official: iron 12.6 × 6.6 × 5.5 in, 3.35 lb → 3.25+ to 3.5 lb, $7.13 / $7.67; Low-Price $6.31 / $6.85", () => {
    const s = sizeTier([12.6, 6.6, 5.5], 3.35);
    expect(weightBand(s, "nonApparel")).toBe("3.25+ to 3.5 lb");
    expect(fee([12.6, 6.6, 5.5], 3.35, "nonApparel", "nonpeak", 20)).toBe(713);
    expect(fee([12.6, 6.6, 5.5], 3.35, "nonApparel", "peak", 20)).toBe(767);
    expect(fee([12.6, 6.6, 5.5], 3.35, "nonApparel", "nonpeak", 9)).toBe(631);
    expect(fee([12.6, 6.6, 5.5], 3.35, "nonApparel", "peak", 9)).toBe(685);
  });

  it("official: baby cot 24 × 7.5 × 6 in, 7.90 lb → Small Bulky 7+ to 8 lb, $10.21 / $11.25; Low-Price $9.44 / $10.48", () => {
    const s = sizeTier([24, 7.5, 6], 7.9);
    expect(s.tier).toBe("small-bulky");
    expect(fee([24, 7.5, 6], 7.9, "nonApparel", "nonpeak", 60)).toBe(1021);
    expect(fee([24, 7.5, 6], 7.9, "nonApparel", "peak", 60)).toBe(1125);
    expect(fee([24, 7.5, 6], 7.9, "nonApparel", "nonpeak", 9)).toBe(944);
    expect(fee([24, 7.5, 6], 7.9, "nonApparel", "peak", 9)).toBe(1048);
  });

  it("official: monitor 54 × 35 × 3.5 in → Extra-Large by dimensional weight 47.59 lb, $44.19 / $46.92; Low-Price $43.42 / $46.15", () => {
    const s = sizeTier([54, 35, 3.5], 41);
    expect(s.tier).toBe("xl-0-50");
    expect(s.shippingWeight).toBeCloseTo(47.59, 2);
    expect(weightBand(s, "nonApparel")).toBe("47+ to 48 lb");
    expect(fee([54, 35, 3.5], 41, "nonApparel", "nonpeak", 20)).toBe(4419);
    expect(fee([54, 35, 3.5], 41, "nonApparel", "peak", 20)).toBe(4692);
    expect(fee([54, 35, 3.5], 41, "nonApparel", "nonpeak", 9)).toBe(4342);
    expect(fee([54, 35, 3.5], 41, "nonApparel", "peak", 9)).toBe(4615);
  });

  it("official: TV 65 × 20 × 7 in → Extra-Large 50+ to 70 lb at 65.47 lb, $48.57 / $51.38; Low-Price $47.80 / $50.61", () => {
    expect(sizeTier([65, 20, 7], 62).tier).toBe("xl-50-70");
    expect(fee([65, 20, 7], 62, "nonApparel", "nonpeak", 60)).toBe(4857);
    expect(fee([65, 20, 7], 62, "nonApparel", "peak", 60)).toBe(5138);
    expect(fee([65, 20, 7], 62, "nonApparel", "nonpeak", 9)).toBe(4780);
    expect(fee([65, 20, 7], 62, "nonApparel", "peak", 9)).toBe(5061);
  });

  it("official: low-inventory-level fee page fulfillment fees ($10–$50, non-peak)", () => {
    expect(fee([8, 6, 1], 0.45, "nonApparel", "nonpeak", 20)).toBe(395); // large standard 4+ to 8 oz
    expect(fee([10, 8, 0.5], 0.45, "nonApparel", "nonpeak", 20)).toBe(354); // small standard 6+ to 8 oz
    expect(fee([10, 8, 2], 2.2, "nonApparel", "nonpeak", 20)).toBe(592); // large standard 2+ to 2.25 lb
    expect(fee([40, 4, 4], 6, "nonApparel", "nonpeak", 20)).toBe(1125); // large bulky 6 lb (dim weight 4.6 lb)
  });

  it("official shipping-weight examples: unit vs dimensional weight", () => {
    expect(weightBand(sizeTier([6.3, 6.2, 4.8], 3), "nonApparel")).toBe("2.75+ to 3 lb");
    expect(weightBand(sizeTier([16.6, 13.3, 7.7], 6.6), "nonApparel")).toBe("12+ to 12.25 lb");
    expect(weightBand(sizeTier([12.2, 12.0, 4.3], 3.6), "nonApparel")).toBe("4.5+ to 4.75 lb");
    expect(weightBand(sizeTier([12.2, 12.0, 3.2], 3.6), "nonApparel")).toBe("3.5+ to 3.75 lb");
    // White board 40 × 1 × 25 in: 2-inch minimum → 14.4 lb dimensional weight, 14+ to 15 lb.
    const board = sizeTier([40, 1, 25], 4.5);
    expect(board.dimWeight).toBeCloseTo(14.39, 2);
    expect(weightBand(board, "nonApparel")).toBe("14+ to 15 lb");
  });

  it("official storage example: 0.05 cu ft in July at $0.78 → $3.90 per 100 units", () => {
    const r = run(fba, "us", { length: 12, width: 7.2, height: 1, weight: 0.5, storageMonths: 1, storageSeason: "offpeak" });
    expect(line(r, "storage")).toBe(4); // 0.05 × $0.78 = $0.039 per unit
    const two = run(fba, "us", { length: 12, width: 7.2, height: 1, weight: 0.5, storageMonths: 100, storageSeason: "offpeak" });
    expect(line(two, "storage")).toBe(390); // the same 0.05 cu ft × $0.78 × 100
  });

  it("derived examples with the 3.5% surcharge (research D1–D4)", () => {
    const d1 = run(fba, "us", { length: 6, width: 4, height: 0.5, weight: 0.2, price: 19.99, season: "peak", storageMonths: 0 });
    expect(line(d1, "fulfillment") + line(d1, "fuel")).toBe(374);
    const d2 = run(fba, "us", { length: 12, width: 9, height: 4, weight: 1.1, price: 24.99, season: "nonpeak", storageMonths: 0 });
    expect(line(d2, "fulfillment")).toBe(705);
    expect(line(d2, "fuel")).toBe(25);
    const d3 = run(fba, "us", { category: "clothing", length: 14, width: 11, height: 3, weight: 1.6, price: 59.99, season: "peak", storageMonths: 0 });
    expect(line(d3, "fulfillment")).toBe(806);
    expect(line(d3, "fuel")).toBe(28);
    const d4 = run(fba, "us", { length: 30, width: 20, height: 6, weight: 9, price: 35, season: "peak", storageMonths: 0 });
    expect(line(d4, "fulfillment")).toBe(1809);
    expect(line(d4, "fuel")).toBe(63);
    expect(line(d4, "packaging")).toBe(347);
  });

  it("price band edges: $9.99 / $10.00 / $50.00 / $50.01 (small standard, 2 oz)", () => {
    const at = (p: number, season: Season) => fee([8, 5, 0.5], 0.1, "nonApparel", season, p);
    expect([at(9.99, "nonpeak"), at(10, "nonpeak"), at(50, "nonpeak"), at(50.01, "nonpeak")]).toEqual([243, 332, 332, 358]);
    expect([at(9.99, "peak"), at(10, "peak"), at(50, "peak"), at(50.01, "peak")]).toEqual([262, 351, 351, 377]);
  });

  it("size tier edges", () => {
    expect(sizeTier([15, 12, 0.75], 1).tier).toBe("small-standard");
    expect(sizeTier([15, 12, 0.75], 1.001).tier).toBe("large-standard");
    expect(sizeTier([15, 12, 0.76], 0.5).tier).toBe("large-standard");
    expect(sizeTier([18, 14, 8], 20).tier).toBe("large-standard"); // dim weight 2016/139 = 14.5 lb
    expect(sizeTier([18, 14, 8], 20.01).tier).toBe("small-bulky");
    expect(sizeTier([18.1, 14, 8], 5).tier).toBe("small-bulky");
    expect(sizeTier([37, 20, 5], 30).tier).toBe("small-bulky"); // dim weight 26.6 lb, 37 + 50 = 87 in
    expect(sizeTier([37.1, 20, 5], 30).tier).toBe("large-bulky");
    expect(sizeTier([37, 20, 10], 30).tier).toBe("xl-50-70"); // dim weight 53.2 lb > 50
    expect(sizeTier([59, 33, 2.5], 30).tier).toBe("large-bulky"); // length + girth exactly 130 in
    expect(sizeTier([59, 33, 2.51], 30).tier).toBe("xl-0-50"); // 130.02 in
    expect(sizeTier([37, 28, 20], 40).tier).toBe("xl-70-150"); // 133 in, and dimensional weight 149 lb
    expect(sizeTier([30, 20, 10], 50).tier).toBe("small-bulky");
    expect(sizeTier([30, 20, 10], 50.01).tier).toBe("xl-50-70");
    expect(sizeTier([60, 30, 30], 160).tier).toBe("xl-150-plus");
  });

  it("Extra-Large 150+ lb is set by the greater of unit and dimensional weight, but billed on unit weight", () => {
    // Boxed sofa 80 × 38 × 30 in, 90 lb: dimensional weight 91,200 / 139 = 656.1 lb → 150+ lb tier,
    // fee from the 90 lb unit weight: $194.95 (non-peak, over $50), no Overmax (that is for XL up to 150 lb).
    const sofa = sizeTier([80, 38, 30], 90);
    expect(sofa.tier).toBe("xl-150-plus");
    expect(sofa.shippingWeight).toBe(90);
    expect(sofa.overmax).toBe(false);
    expect(weightBand(sofa, "nonApparel")).toBe("151 lb or less");
    expect(fee([80, 38, 30], 90, "nonApparel", "nonpeak", 400)).toBe(19495);
    // 160 lb unit weight: $194.95 + $0.19 × 9 lb above 151 lb = $196.66.
    expect(fee([60, 30, 30], 160, "nonApparel", "nonpeak", 400)).toBe(19666);
    // Dimensional weight exactly 150 lb (50 × 30 × 13.9 = 20,850 in³) stays in 70+ to 150 lb:
    // $51.32 + $0.75 × (150 − 71) = $110.57. A hair more crosses into 150+.
    expect(sizeTier([50, 30, 13.9], 100).tier).toBe("xl-70-150");
    expect(fee([50, 30, 13.9], 100, "nonApparel", "nonpeak", 400)).toBe(11057);
    expect(sizeTier([50, 30, 13.91], 100).tier).toBe("xl-150-plus");
  });

  it("hand-computed cases: price bands, Bulky packaging, Overmax, apparel SIPP, storage surcharge, hazmat", () => {
    // 12 × 9 × 2 in, 0.8 lb: dimensional weight 216 / 139 = 1.55 lb → large standard 1.5+ to 1.75 lb.
    const box = { length: 12, width: 9, height: 2, weight: 0.8, season: "nonpeak", storageMonths: 0 };
    expect(line(run(fba, "us", { ...box, price: 9.99 }), "fulfillment")).toBe(475);
    expect(line(run(fba, "us", { ...box, price: 50 }), "fulfillment")).toBe(557);
    expect(line(run(fba, "us", { ...box, price: 50.01 }), "fulfillment")).toBe(583);
    expect(line(run(fba, "us", { ...box, price: 50 }), "fuel")).toBe(19); // 3.5% × $5.57 = $0.19495
    // Small Bulky 20 × 15 × 10 in, 25 lb (dim 21.58 lb): $7.55 + $0.38 × 24 = $16.67; packaging (20–25 lb dim) $2.92; fuel $0.58.
    const bulky = run(fba, "us", { length: 20, width: 15, height: 10, weight: 25, price: 60, season: "nonpeak", storageMonths: 0 });
    expect([line(bulky, "fulfillment"), line(bulky, "packaging"), line(bulky, "fuel")]).toEqual([1667, 292, 58]);
    // 97 × 4 × 4 in, 20 lb: Extra-Large 0–50 lb, $26.33 + $0.38 × 19 = $33.55, plus the $17 Overmax fee.
    const pole = run(fba, "us", { length: 97, width: 4, height: 4, weight: 20, price: 80, season: "nonpeak", storageMonths: 0 });
    expect([line(pole, "fulfillment"), line(pole, "overmax")]).toEqual([3355, 1700]);
    // Apparel, 1 oz small standard, $9, peak: $2.85; SIPP −$0.06; fuel 3.5% × $2.79 = $0.09765 → $0.10.
    const tee = run(fba, "us", { category: "clothing", length: 8, width: 6, height: 0.5, weight: 1 / 16, price: 9, season: "peak", sipp: true, storageMonths: 0 });
    expect([line(tee, "fulfillment"), line(tee, "sipp"), line(tee, "fuel")]).toEqual([285, -6, 10]);
    // 18 × 14 × 8 in = 1.1667 cu ft: 2 months × $0.78 = $1.82; utilization 22–28 weeks: 1 month × $0.44 = $0.51.
    const stored = run(fba, "us", { length: 18, width: 14, height: 8, weight: 10, price: 40, storageMonths: 2, storageSeason: "offpeak", utilization: "22-28", season: "nonpeak" });
    expect([line(stored, "storage"), line(stored, "utilization")]).toEqual([182, 51]);
    // Hazmat 12 × 8 × 4 in, 2 lb: dim 2.76 lb → 2.75+ to 3 lb, dangerous-goods peak $10–$50 = $7.94.
    expect(line(run(fba, "us", { length: 12, width: 8, height: 4, weight: 2, price: 20, season: "peak", dangerousGoods: true, storageMonths: 0 }), "fulfillment")).toBe(794);
  });

  it("bracket note speaks of gift wrap, not shipping, on FBA orders", () => {
    const r = run(fba, "us", { category: "clothing", price: 17, giftWrap: 2, season: "nonpeak" });
    expect(r.notes.some((n) => n.includes("including gift wrap") && !n.includes("shipping and gift wrap"))).toBe(true);
  });

  it("weight steps: large standard 3+ lb per 4 oz (apparel per half-lb), bulky per lb", () => {
    const at = (lb: number, t: FeeType = "nonApparel") => fee([12, 10, 6], lb, t, "nonpeak", 20); // dim weight 5.18 lb
    const small = (lb: number, t: FeeType = "nonApparel") => fee([12, 10, 3], lb, t, "nonpeak", 20); // dim weight 2.59 lb
    expect(small(3)).toBe(667);
    expect(small(3.01)).toBe(705);
    expect(small(3.25)).toBe(705);
    expect(small(3.26)).toBe(713);
    expect(small(3.5, "apparel")).toBe(713);
    expect(small(3.51, "apparel")).toBe(729);
    expect(at(1)).toBe(697 + 8 * 9); // dimensional weight 5.18 lb → 9 quarter-pound steps over 3 lb
    expect(fee([24, 7.5, 6], 8, "nonApparel", "nonpeak", 20)).toBe(755 + 38 * 7);
    expect(fee([24, 7.5, 6], 8.01, "nonApparel", "nonpeak", 20)).toBe(755 + 38 * 8);
  });

  it("dangerous goods use their own rate card and storage rates", () => {
    const r = run(fba, "us", { dangerousGoods: true, season: "peak", storageSeason: "peak" });
    expect(line(r, "fulfillment")).toBe(486); // small standard 6+ to 8 oz, $10–$50, peak
    expect(line(r, "storage")).toBe(Math.round((49 / 1728) * 363));
  });

  it("oversize storage, utilization surcharge after the first month, Overmax, lithium, SIPP", () => {
    const big = run(fba, "us", { length: 30, width: 20, height: 6, weight: 9, price: 35, storageMonths: 3, storageSeason: "offpeak", utilization: "28-36" });
    const cuft = (30 * 20 * 6) / 1728;
    expect(line(big, "storage")).toBe(Math.round(cuft * 56 * 3));
    expect(line(big, "utilization")).toBe(Math.round(cuft * 46 * 2));
    const long = run(fba, "us", { length: 97, width: 4, height: 4, weight: 20, price: 80, storageMonths: 0 });
    expect(line(long, "overmax")).toBe(1700);
    expect(line(run(fba, "us", { lithium: true }), "lithium")).toBe(11);
    const sipp = run(fba, "us", { sipp: true, season: "nonpeak" });
    expect(line(sipp, "sipp")).toBe(-5);
    expect(line(sipp, "fuel")).toBe(Math.round(0.035 * (354 - 5)));
    expect(run(fba, "us", { length: 24, width: 7.5, height: 6, weight: 7.9, sipp: true }).fees.some((l) => l.id === "packaging")).toBe(false);
  });

  it("inbound placement: top of Amazon's range, nothing for Amazon-optimized splits", () => {
    expect(line(run(fba, "us", { placement: "minimal" }), "placement")).toBe(32);
    expect(run(fba, "us", { placement: "optimized" }).fees.some((l) => l.id === "placement")).toBe(false);
    expect(placementRange(sizeTier([12, 10, 6], 6), "minimal")).toEqual([40, 98]);
    expect(placementRange(sizeTier([24, 7.5, 6], 7.9), "partial")).toEqual([65, 175]);
    expect(placementRange(sizeTier([40, 4, 4], 6), "minimal")).toEqual([210, 290]);
  });

  it("holiday peak switches on October 15, 2026 and off on January 15, 2027", () => {
    expect(fbaSeason(Date.UTC(2026, 9, 14, 23))).toBe("nonpeak");
    expect(fbaSeason(Date.UTC(2026, 9, 15))).toBe("peak");
    expect(fbaSeason(Date.UTC(2027, 0, 14, 23))).toBe("peak");
    expect(fbaSeason(Date.UTC(2027, 0, 15))).toBe("nonpeak");
    expect(storageSeason(Date.UTC(2026, 8, 30))).toBe("offpeak");
    expect(storageSeason(Date.UTC(2026, 9, 1))).toBe("peak");
    expect(storageSeason(Date.UTC(2027, 0, 1))).toBe("offpeak");
  });

  it("keeps to three notes and mentions the refund administration fee", () => {
    const r = run(fba, "us", { season: "nonpeak", price: 10.5 });
    expect(r.notes.length).toBeLessThanOrEqual(3);
    expect(r.notes.some((n) => n.includes("$0.32 refund administration fee"))).toBe(true); // 20% × 15% × $10.50 = $0.315
    expect(r.notes.some((n) => n.includes("$9.99"))).toBe(true); // Low-Price FBA cliff note
  });

  it("UK-established sellers pay 2% on the referral and fulfillment fees", () => {
    const r = run(fba, "us", { establishment: "uk", season: "peak" });
    expect(line(r, "dsf")).toBe(Math.ceil(0.02 * 300) + Math.ceil(0.02 * 374)); // 6 + 8
    const it = run(fba, "us", { establishment: "it-es", season: "peak" });
    expect(line(it, "dsf")).toBe(9); // 3% × $3.00 only, not the FBA fee
  });

  it("reverse mode across the $50.01 price band: true minimum for a profit target", () => {
    const m = M.us;
    const inputs = { ...fba.defaults(m), season: "peak", storageSeason: "peak", itemCost: 5 };
    expect(fba.breakpoints!(inputs, m)).toEqual([1000, 5001]);
    // At $46.28: referral $6.94, fulfillment $3.74, fuel $0.13, storage $0.07, plan $0.40 → payout $35.00, profit $30.00.
    const s = solvePrice(fba, inputs, m, "profit", 3000);
    expect(s.price).toBe(4628);
    expect(s.result!.profit).toBe(3000);
    expect(fba.calculate({ ...inputs, price: 46.27 }, m).profit).toBeLessThan(3000);
  });

  it("reverse mode finds the true lowest price across the $10 Low-Price FBA edge", () => {
    const m = M.us;
    const inputs = { ...fba.defaults(m), season: "peak", storageSeason: "peak" };
    // Below $10 the most you can keep is at $9.99; past $10 the fulfillment fee jumps.
    const low = solvePrice(fba, inputs, m, "payout", 500);
    expect(low.price).toBe(992);
    expect(fba.calculate({ ...inputs, price: 9.91 }, m).payout).toBeLessThan(500);
    const high = solvePrice(fba, inputs, m, "payout", 520);
    expect(high.price!).toBeGreaterThan(1000);
    expect(high.result!.payout).toBeGreaterThanOrEqual(520);
    expect(fba.calculate({ ...inputs, price: (high.price! - 1) / 100 }, m).payout).toBeLessThan(520);
    expect(fba.calculate({ ...inputs, price: 9.99 }, m).payout).toBeLessThan(520);
  });
});
