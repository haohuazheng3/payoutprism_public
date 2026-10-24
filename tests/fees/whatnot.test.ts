import { afterEach, describe, expect, it, vi } from "vitest";
import whatnot, { auFashionZeroActive, premierDiscountActive, rateFor } from "@/fees/platforms/whatnot";
import { solvePrice } from "@/fees/solve";
import { M } from "@/fees/markets";
import { checkContract, line, run } from "./helpers";

const has = (r: ReturnType<typeof run>, id: string) => r.fees.some((l) => l.id === id);

/** Pin the clock for date-driven rules (Premier Shop discount, AU Fashion 0% week). */
function at(iso: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
}

describe("whatnot", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("meets the module contract in every market", () => {
    expect(checkContract(whatnot)).toEqual([]);
  });

  // ---- Official worked examples (research §6) ----

  it("E1 (fees page): 8% commission on the $10 item only; processing on the $15.84 the buyer pays", () => {
    const r = run(whatnot, "us", { price: 10, shippingCharged: 4.99, salesTax: 8.5 });
    expect(r.buyerPays).toBe(1584); // 10 + 4.99 + 0.85 tax
    expect(line(r, "commission")).toBe(80);
    expect(line(r, "processing")).toBe(76); // 2.9% × 15.84 + 0.30 = 0.75936
  });

  it("E2 (US/CA/AU net earnings): $50 sale, $58.70 order total → $4 + $2.00, keep $44.00", () => {
    const r = run(whatnot, "us", { price: 50, shippingCharged: 8.7, salesTax: 0 });
    expect(r.buyerPays).toBe(5870);
    expect(line(r, "commission")).toBe(400);
    expect(line(r, "processing")).toBe(200); // 2.9% × 58.70 + 0.30 = 2.0023
    expect(r.payout).toBe(4400);
  });

  it("E3 (UK & EU net earnings): £/€50 sale, £/€65 order total, 20% VAT → keep 43.82", () => {
    for (const [market, category] of [
      ["uk", "trading_card_games"],
      ["fr", "toys"], // France's Sports/TCG are 4%, so use a 6.67% category
    ] as const) {
      const r = run(whatnot, market, { price: 50, shippingCharged: 15, category, vatOnFees: true });
      expect(line(r, "commission")).toBe(333);
      expect(line(r, "vatCommission")).toBe(67);
      expect(line(r, "processing")).toBe(182); // 2.42% × 65.00 + 0.25 = 1.823
      expect(line(r, "vatProcessing")).toBe(36);
      expect(r.payout).toBe(4382);
    }
  });

  it("E5 (high-value orders): $2,000 in a qualifying category → $120 commission, processing on the full value", () => {
    const r = run(whatnot, "us", { price: 2000, shippingCharged: 0, category: "trading_card_games" });
    expect(line(r, "commission")).toBe(12000);
    expect(line(r, "processing")).toBe(5830); // 2.9% × 2,000 + 0.30
  });

  it("E6 (tax on fees): Houston seller, $100 order total → $3.20 processing, $0.21 tax at 8.25% × 80%", () => {
    const r = run(whatnot, "us", { price: 100, shippingCharged: 0, feeTaxState: "tx", feeTaxRate: 8.25 });
    expect(line(r, "processing")).toBe(320);
    expect(line(r, "taxProcessing")).toBe(21);
    expect(has(r, "taxCommission")).toBe(false); // Texas taxes processing only
  });

  it("E7 (Premier Shop, through October 31): 8% becomes 7.2%, 5% becomes 4.5%", () => {
    at("2026-10-23T12:00:00Z");
    expect(line(run(whatnot, "us", { price: 100, premier: true }), "commission")).toBe(720);
    // Other Collectibles, Tier 4 = 5%
    expect(line(run(whatnot, "us", { price: 100, category: "toys", tier: "4", premier: true }), "commission")).toBe(450);
  });

  it("E9 (tiers by total sales): $15,000 unlocks Tier 1 → Fashion 7.00%, Toys (Other Collectibles) 7.25%", () => {
    expect(rateFor("us", "fashion", 1)).toBe(7);
    expect(rateFor("us", "collectibles", 1)).toBe(7.25);
    expect(line(run(whatnot, "us", { price: 100, category: "womens_fashion", tier: "1" }), "commission")).toBe(700);
    expect(line(run(whatnot, "us", { price: 100, category: "toys", tier: "1" }), "commission")).toBe(725);
  });

  it("E10 (capped shipping): buyer pays $7.75 of $20, seller pays $12.25, which isn't in the processing base", () => {
    const r = run(whatnot, "us", { price: 25, shippingCharged: 7.75, sellerShipping: 12.25 });
    expect(line(r, "sellerShipping")).toBe(1225);
    expect(line(r, "processing")).toBe(125); // 2.9% × 32.75 = 0.94975 → 0.95, + 0.30
    expect(r.payout).toBe(950); // 25.00 − 2.00 − 1.25 − 12.25
  });

  it("E11 (seller coupon): an item priced 20 with a 5 coupon is charged on 15", () => {
    expect(line(run(whatnot, "us", { price: 15 }), "commission")).toBe(120);
  });

  // ---- Derived examples (research §6 D1–D5) ----

  it("D1: US Fashion Tier 2, $100 + $7.75 shipping + $8 tax → keep $89.84", () => {
    const r = run(whatnot, "us", { price: 100, shippingCharged: 7.75, salesTax: 8, category: "womens_fashion", tier: "2" });
    expect(line(r, "commission")).toBe(650);
    expect(line(r, "processing")).toBe(366); // 2.9% × 115.75 + 0.30 = 3.65675
    expect(r.payout).toBe(8984);
  });

  it("D2: US TCG $2,000 + $7.75 shipping → $120 + $58.52 + $4.36 signature, keep $1,817.12", () => {
    const r = run(whatnot, "us", { price: 2000, shippingCharged: 7.75 });
    expect(line(r, "commission")).toBe(12000);
    expect(line(r, "processing")).toBe(5852);
    expect(line(r, "signature")).toBe(436);
    expect(r.payout).toBe(181712);
    expect(run(whatnot, "us", { price: 2000, shippingCharged: 7.75, signature: "no" }).payout).toBe(182148);
  });

  it("D3: UK TCG £30 + £3.99 shipping, not VAT registered → keep £26.32", () => {
    const r = run(whatnot, "uk", { price: 30, shippingCharged: 3.99 });
    expect(line(r, "commission")).toBe(200);
    expect(line(r, "vatCommission")).toBe(40);
    expect(line(r, "processing")).toBe(107);
    expect(line(r, "vatProcessing")).toBe(21);
    expect(r.payout).toBe(2632);
  });

  it("D5: a $1 win with $4.47 shipping costs $0.54 in fees; bundled into an earlier win (no shipping) $0.41", () => {
    expect(run(whatnot, "us", { price: 1, shippingCharged: 4.47 }).totalFees).toBe(54);
    const bundled = run(whatnot, "us", { price: 1, shippingCharged: 0 });
    expect(line(bundled, "processing")).toBe(33);
    expect(bundled.totalFees).toBe(41);
  });

  // ---- Rate cards, edges and options ----

  it("default US case: $25 card + $4.47 shipping → $2.00 + $1.15", () => {
    const r = run(whatnot, "us");
    expect(line(r, "commission")).toBe(200);
    expect(line(r, "processing")).toBe(115); // 2.9% × 29.47 + 0.30 = 1.15463
    expect(r.payout).toBe(2185);
  });

  it("US rate card: every tier of the Sports/TCG and Coins ladders", () => {
    const tcg = [800, 775, 750, 725, 700, 675, 650];
    const coins = [400, 390, 380, 370, 360, 355, 350];
    for (let t = 0; t < 7; t++) {
      expect(line(run(whatnot, "us", { price: 100, tier: String(t) }), "commission")).toBe(tcg[t]);
      expect(line(run(whatnot, "us", { price: 100, category: "coins_and_money", tier: String(t) }), "commission")).toBe(coins[t]);
    }
    expect(rateFor("us", "other", 6)).toBe(4);
    expect(rateFor("us", "fashion", 6)).toBe(4.5);
  });

  it("Australia's Sports/TCG ladder differs (Tier 2 7.00% vs 7.50% in the US); Canada matches the US", () => {
    expect(rateFor("au", "tcg", 2)).toBe(7);
    expect(rateFor("au", "sports", 6)).toBe(6);
    expect(rateFor("ca", "tcg", 2)).toBe(7.5);
    expect(rateFor("au", "fashion", 3)).toBe(rateFor("us", "fashion", 3));
  });

  it("tier options show each market's thresholds", () => {
    const field = whatnot.fields.find((f) => f.id === "tier")!;
    if (field.kind !== "select" || typeof field.options !== "function") throw new Error("tier options");
    const us = field.options(whatnot.defaults(M.us), M.us).map((o) => o.label);
    expect(us[0]).toBe("Under $15,000 · Standard");
    expect(us[1]).toBe("$15,000–$34,999 · Tier 1");
    expect(us[6]).toBe("$500,000 or more · Tier 6");
    const au = field.options(whatnot.defaults(M.au), M.au).map((o) => o.label);
    expect(au[4]).toContain("70,000");
  });

  it("France and Belgium: Sports and TCG 4% at every tier; other categories on the UK/EU card", () => {
    for (let t = 0; t < 7; t++) expect(line(run(whatnot, "fr", { price: 100, tier: String(t), vatOnFees: false }), "commission")).toBe(400);
    expect(line(run(whatnot, "be", { price: 100, category: "womens_fashion", tier: "6", vatOnFees: false }), "commission")).toBe(425);
    expect(line(run(whatnot, "de", { price: 100, tier: "6", vatOnFees: false }), "commission")).toBe(525);
  });

  it("6.67% is 8% ÷ 1.2: £1.67 on £25 and £3.33 on £50", () => {
    expect(line(run(whatnot, "uk", { price: 25 }), "commission")).toBe(167);
    expect(line(run(whatnot, "uk", { price: 50 }), "commission")).toBe(333);
  });

  it("high-value edge: 0% only above 1,500 and only in qualifying categories", () => {
    expect(line(run(whatnot, "us", { price: 1499.99 }), "commission")).toBe(12000); // 8% × 1,499.99 = 119.9992
    expect(line(run(whatnot, "us", { price: 1500 }), "commission")).toBe(12000);
    expect(line(run(whatnot, "us", { price: 1500.01 }), "commission")).toBe(12000);
    expect(line(run(whatnot, "us", { price: 3000 }), "commission")).toBe(12000);
    // Sports breaks don't qualify
    expect(line(run(whatnot, "us", { price: 2000, category: "sports_cards" }), "commission")).toBe(16000);
    expect(line(run(whatnot, "us", { price: 2000, category: "sports_singles" }), "commission")).toBe(12000);
    // Tier rate applies to the first 1,500 (Tier 6 TCG 6.5%)
    expect(line(run(whatnot, "us", { price: 2000, tier: "6" }), "commission")).toBe(9750);
    // UK: £1,500 at 6.67%
    expect(line(run(whatnot, "uk", { price: 2000 }), "commission")).toBe(10000);
  });

  it("signature confirmation: automatic from a $500 subtotal (US only), or added by hand", () => {
    expect(has(run(whatnot, "us", { price: 499.99 }), "signature")).toBe(false);
    expect(line(run(whatnot, "us", { price: 500 }), "signature")).toBe(436);
    expect(has(run(whatnot, "us", { price: 600, signature: "no" }), "signature")).toBe(false);
    expect(line(run(whatnot, "us", { price: 25, signature: "yes" }), "signature")).toBe(436);
    expect(has(run(whatnot, "ca", { price: 600 }), "signature")).toBe(false);
  });

  it("VAT/GST on fees only without a VAT/GST number; Australia adds 10% GST", () => {
    const registered = run(whatnot, "uk", { vatOnFees: false });
    expect(has(registered, "vatCommission") || has(registered, "vatProcessing")).toBe(false);
    const au = run(whatnot, "au", { price: 100, shippingCharged: 10, category: "toys" });
    expect(line(au, "commission")).toBe(800);
    expect(line(au, "vatCommission")).toBe(80);
    expect(line(au, "processing")).toBe(349); // 2.9% × 110 + 0.30
    expect(line(au, "vatProcessing")).toBe(35);
    const de = run(whatnot, "de", { price: 100, shippingCharged: 0 });
    expect(line(de, "commission")).toBe(667); // 100 × 8% ÷ 1.2 = 6.666…
    expect(line(de, "vatCommission")).toBe(127); // 19% × 6.67 = 1.2673
  });

  it("Canada: GST/HST the buyer pays raises processing (C$100 + 13% HST)", () => {
    const r = run(whatnot, "ca", { price: 100, shippingCharged: 0, salesTax: 13 });
    expect(r.buyerPays).toBe(11300);
    expect(line(r, "processing")).toBe(358); // 2.9% × 113 + 0.30 = 3.577
  });

  it("US sales tax on fees by state", () => {
    const hi = run(whatnot, "us", { price: 100, shippingCharged: 0, promote: 5, feeTaxState: "hi", feeTaxRate: 4.5 });
    expect(line(hi, "taxCommission")).toBe(36); // 4.5% × 8.00
    expect(line(hi, "taxProcessing")).toBe(14); // 4.5% × 3.20
    expect(line(hi, "taxPromote")).toBe(23); // 4.5% × 5.00 = 0.225
    const ct = run(whatnot, "us", { price: 100, shippingCharged: 0, feeTaxState: "ct" });
    expect(line(ct, "taxProcessing")).toBe(3); // 1% × 3.20
    expect(has(ct, "taxCommission")).toBe(false);
    const dc = run(whatnot, "us", { price: 100, shippingCharged: 0, feeTaxState: "dc", feeTaxRate: 6 });
    expect(line(dc, "taxCommission")).toBe(48);
    expect(has(dc, "taxProcessing")).toBe(false);
    const oh = run(whatnot, "us", { price: 100, shippingCharged: 0, feeTaxState: "oh", feeTaxRate: 7.25 });
    expect(has(oh, "taxCommission")).toBe(false);
    expect(line(oh, "taxProcessing")).toBe(23);
  });

  it("Promote/Boost is charged VAT for unregistered UK sellers", () => {
    const r = run(whatnot, "uk", { promote: 2 });
    expect(line(r, "promote")).toBe(200);
    expect(line(r, "vatPromote")).toBe(40);
  });

  it("Promote Tools aren't offered in Australia or the Netherlands: the field is hidden and ignored", () => {
    const field = whatnot.fields.find((f) => f.id === "promote")!;
    for (const m of [M.au, M.nl]) {
      expect(field.showIf!(whatnot.defaults(m), m)).toBe(false);
      const r = run(whatnot, m.id, { promote: 2 });
      expect(has(r, "promote") || has(r, "vatPromote")).toBe(false);
    }
    expect(field.showIf!(whatnot.defaults(M.be), M.be)).toBe(true);
  });

  // ---- Independent hand calculations (reviewer, 2026-10-23) ----

  it("hand-checked: US TCG Tier 3 at the 1,500 edge with $7.75 shipping (7.25%, signature, 0% above 1,500)", () => {
    const below = run(whatnot, "us", { price: 1499.99, tier: "3", shippingCharged: 7.75 });
    expect(line(below, "commission")).toBe(10875); // 7.25% × 1,499.99 = 108.749275
    expect(line(below, "processing")).toBe(4402); // 2.9% × 1,507.74 = 43.72446, + 0.30
    expect(line(below, "signature")).toBe(436);
    expect(below.payout).toBe(134286);
    const above = run(whatnot, "us", { price: 1500.01, tier: "3", shippingCharged: 7.75 });
    expect(line(above, "commission")).toBe(10875); // capped at 7.25% × 1,500
    expect(line(above, "processing")).toBe(4403); // 2.9% × 1,507.76 = 43.72504, + 0.30
    expect(above.payout).toBe(134287);
  });

  it("hand-checked: UK Fashion Tier 4 £120 + £3.27 shipping, no VAT number → keep £109.28", () => {
    const r = run(whatnot, "uk", { price: 120, category: "womens_fashion", tier: "4" });
    expect(line(r, "commission")).toBe(570); // 4.75% × 120
    expect(line(r, "vatCommission")).toBe(114);
    expect(line(r, "processing")).toBe(323); // 2.42% × 123.27 = 2.983134, + 0.25
    expect(line(r, "vatProcessing")).toBe(65); // 20% × 3.23 = 0.646
    expect(r.payout).toBe(10928);
  });

  it("hand-checked: Netherlands Coins Tier 6 €80 + €5, 21% VAT → keep €73.81", () => {
    const r = run(whatnot, "nl", { price: 80, category: "coins_and_money", tier: "6" });
    expect(line(r, "commission")).toBe(280); // 3.5% × 80
    expect(line(r, "vatCommission")).toBe(59); // 21% × 2.80 = 0.588
    expect(line(r, "processing")).toBe(231); // 2.42% × 85 = 2.057, + 0.25
    expect(line(r, "vatProcessing")).toBe(49); // 21% × 2.31 = 0.4851
    expect(r.payout).toBe(7381);
  });

  it("hand-checked: Australia Music Tier 4 A$60 + A$10, 10% GST → keep A$54.80", () => {
    const r = run(whatnot, "au", { price: 60, category: "music", tier: "4" });
    expect(line(r, "commission")).toBe(240); // 4% × 60
    expect(line(r, "vatCommission")).toBe(24);
    expect(line(r, "processing")).toBe(233); // 2.9% × 70 = 2.03, + 0.30
    expect(line(r, "vatProcessing")).toBe(23); // 10% × 2.33
    expect(r.payout).toBe(5480);
  });

  it("hand-checked: West Virginia seller, Toys Tier 2, $40 + $4.85 + 7% buyer tax, 6% local rate → keep $35.46", () => {
    const r = run(whatnot, "us", { price: 40, category: "toys", tier: "2", shippingCharged: 4.85, salesTax: 7, feeTaxState: "wv", feeTaxRate: 6 });
    expect(r.buyerPays).toBe(4765); // 40 + 4.85 + 2.80
    expect(line(r, "commission")).toBe(260); // 6.5% × 40
    expect(line(r, "processing")).toBe(168); // 2.9% × 47.65 = 1.38185, + 0.30
    expect(line(r, "taxCommission")).toBe(16); // 6% × 2.60 = 0.156
    expect(line(r, "taxProcessing")).toBe(10); // 6% × 1.68 = 0.1008
    expect(r.payout).toBe(3546);
  });

  it("hand-checked: France TCG €2,000 + €5, 4% on the first €1,500 only → keep €1,869.48", () => {
    const r = run(whatnot, "fr", { price: 2000 });
    expect(line(r, "commission")).toBe(6000); // 4% × 1,500
    expect(line(r, "vatCommission")).toBe(1200);
    expect(line(r, "processing")).toBe(4877); // 2.42% × 2,005 = 48.521, + 0.25
    expect(line(r, "vatProcessing")).toBe(975); // 20% × 48.77 = 9.754
    expect(r.payout).toBe(186948);
  });

  // ---- Date-driven rules ----

  it("Premier Shop discount: on through October 31, gone from November 1", () => {
    expect(premierDiscountActive(Date.UTC(2026, 9, 31, 12))).toBe(true);
    expect(premierDiscountActive(Date.UTC(2026, 10, 1, 3, 59))).toBe(true);
    expect(premierDiscountActive(Date.UTC(2026, 10, 1, 4, 0))).toBe(false);
    at("2026-11-02T12:00:00Z");
    expect(line(run(whatnot, "us", { price: 100, premier: true }), "commission")).toBe(800);
  });

  it("Australia Fashion 0% week (October 18–24, 2026): 0% commission, processing unchanged", () => {
    expect(auFashionZeroActive(Date.UTC(2026, 9, 17, 12, 59))).toBe(false);
    expect(auFashionZeroActive(Date.UTC(2026, 9, 20))).toBe(true);
    expect(auFashionZeroActive(Date.UTC(2026, 9, 24, 13, 0))).toBe(false);
    at("2026-10-23T00:00:00Z");
    const during = run(whatnot, "au", { price: 100, shippingCharged: 10, category: "womens_fashion" });
    expect(line(during, "commission")).toBe(0);
    expect(has(during, "vatCommission")).toBe(false);
    expect(line(during, "processing")).toBe(349);
    expect(line(run(whatnot, "us", { price: 100, category: "womens_fashion" }), "commission")).toBe(800); // AU only
    at("2026-10-26T00:00:00Z");
    expect(line(run(whatnot, "au", { price: 100, shippingCharged: 10, category: "womens_fashion" }), "commission")).toBe(800);
  });

  // ---- Reverse mode ----

  it("reverse mode finds the lowest price that pays the target", () => {
    const m = M.us;
    const inputs = whatnot.defaults(m);
    const s = solvePrice(whatnot, inputs, m, "payout", 2000);
    expect(s.price).not.toBeNull();
    expect(s.result!.payout).toBeGreaterThanOrEqual(2000);
    expect(whatnot.calculate({ ...inputs, price: (s.price! - 1) / 100 }, m).payout).toBeLessThan(2000);
  });

  it("reverse mode jumps the $500 signature drop", () => {
    const m = M.us;
    const inputs = whatnot.defaults(m);
    const top = whatnot.calculate({ ...inputs, price: 499.99 }, m).payout;
    expect(whatnot.calculate({ ...inputs, price: 500 }, m).payout).toBeLessThan(top);
    const s = solvePrice(whatnot, inputs, m, "payout", top + 1);
    expect(s.price!).toBeGreaterThan(50000);
    expect(s.result!.payout).toBeGreaterThanOrEqual(top + 1);
    expect(whatnot.calculate({ ...inputs, price: (s.price! - 1) / 100 }, m).payout).toBeLessThan(top + 1);
    // Just below the drop, $499.99 is still the answer for its own payout.
    expect(solvePrice(whatnot, inputs, m, "payout", top).price).toBe(49999);
    // Hand-checked: $445.07 needs $504.89 (40.39 + 15.07 + 4.36 signature); $504.88 keeps $445.06.
    expect(top).toBe(44506);
    expect(s.price).toBe(50489);
  });

  it("reverse mode for a profit target: $140 profit on a $300 card needs $494.30", () => {
    const m = M.us;
    const inputs = { ...whatnot.defaults(m), itemCost: 300 };
    const s = solvePrice(whatnot, inputs, m, "profit", 14000);
    // 494.30: 8% = 39.544 → 39.54; 2.9% × 498.77 + 0.30 = 14.76; 494.30 − 39.54 − 14.76 − 300 = 140.00
    expect(s.price).toBe(49430);
    expect(s.result!.profit).toBe(14000);
    expect(whatnot.calculate({ ...inputs, price: 494.29 }, m).profit).toBe(13999);
  });
});
