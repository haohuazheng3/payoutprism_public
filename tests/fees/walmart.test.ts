import { afterEach, describe, expect, it, vi } from "vitest";
import walmart, { CATEGORIES, PROMO_END, promosActive, shippingWeight, standardBaseFee, storageSeason, wfsSize } from "@/fees/platforms/walmart";
import { solvePrice } from "@/fees/solve";
import { M } from "@/fees/markets";
import type { Result } from "@/fees/types";
import { checkContract, line, run } from "./helpers";

/** A WFS item with the given packaged size, 30 days of storage in January–September. */
const wfs = (length: number, width: number, height: number, weight: number, extra: Record<string, unknown> = {}) => ({
  fulfillment: "wfs",
  length,
  width,
  height,
  weight,
  storageDays: 30,
  storageSeason: "offpeak",
  ...extra,
});

/** Base fulfillment fee + add-ons, the total Walmart quotes as the fulfillment fee. */
const fulfillmentTotal = (r: Result) => line(r, "fulfillment") + (r.fees.find((l) => l.id === "wfs-addons")?.amount ?? 0);
const has = (r: Result, id: string) => r.fees.some((l) => l.id === id);

describe("walmart", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("meets the module contract", () => {
    expect(checkContract(walmart)).toEqual([]);
  });

  it("covers every contract category on the referral fee schedule", () => {
    expect(CATEGORIES).toHaveLength(38);
  });

  /* ------------------------------------------------ official worked examples (WFS) */

  it("pricing page example: John's widget, 6 lb, 12 × 10 × 10 in → 9 lb, $7.75", () => {
    const r = run(walmart, "us", wfs(12, 10, 10, 6));
    expect(shippingWeight(12, 10, 10, 6).lb).toBe(9);
    expect(line(r, "fulfillment")).toBe(775);
    expect(has(r, "wfs-addons")).toBe(false);
  });

  it("estimator example 1: bike basket storage 0.694 cu ft × $0.75 = $0.52 a month", () => {
    const r = run(walmart, "us", wfs(12, 10, 10, 6));
    expect(line(r, "storage")).toBe(52);
  });

  it("pricing page storage example: 10.0 × 5.9 × 5.9 in for 90 days from March = $0.45", () => {
    const r = run(walmart, "us", wfs(10, 5.9, 5.9, 1, { storageDays: 90, storageSeason: "offpeak" }));
    expect(line(r, "storage")).toBe(45);
  });

  it("pricing page big & bulky example: Amy's 230.4 lb massage chair = $155 + $0.80 × 141 = $267.80", () => {
    const r = run(walmart, "us", wfs(53, 32, 50, 230.4));
    expect(wfsSize(53, 32, 50, 230.4).tier).toBe("bulky");
    expect(line(r, "fulfillment")).toBe(26780);
    expect(has(r, "wfs-addons")).toBe(false);
  });

  it("estimator example 2: Anita's 10 lb shelf, 10 × 40 × 40 in, Oversize 2 → 116 lb, $43.55 + $20 = $63.55; storage $6.94", () => {
    const r = run(walmart, "us", wfs(10, 40, 40, 10));
    expect(wfsSize(10, 40, 40, 10).oversize).toBe(2);
    expect(line(r, "fulfillment")).toBe(4355);
    expect(line(r, "wfs-addons")).toBe(2000);
    expect(fulfillmentTotal(r)).toBe(6355);
    expect(line(r, "storage")).toBe(694);
  });

  it("estimator example 3: Sam's 36 lb kayak, 120 × 28 × 14 in, is big & bulky → $155; storage $20.42", () => {
    const r = run(walmart, "us", wfs(120, 28, 14, 36));
    expect(wfsSize(120, 28, 14, 36).tier).toBe("bulky");
    expect(line(r, "fulfillment")).toBe(15500);
    expect(line(r, "storage")).toBe(2042);
    expect(r.warnings.some((w) => w.includes("WFS limits"))).toBe(false);
  });

  // WFS pricing page, "Common item pricing estimates" (fulfillment cost, monthly storage).
  const common: [string, number, number, number, number, number, number][] = [
    ["Earrings", 1.0, 1.0, 2.0, 0.13, 345, 0], // Walmart shows storage as $0.001, which is $0.00 to the cent
    ["Frying pan", 18.6, 10.5, 3.0, 3.7, 615, 25],
    ["Bedding set", 14.5, 7.0, 7.0, 5.97, 695, 31],
    ["Vacuum", 28.74, 12.6, 11.42, 15.9, 1455, 179],
    ["Mountain bike", 49.0, 7.7, 26.4, 25.6, 2895, 432],
    ["Office chair", 22.85, 9.85, 20.09, 36.3, 1695, 196],
    ["Queen mattress", 43.0, 17.0, 17.0, 55.8, 3615, 539],
    ["Grill", 39.0, 16.54, 20.47, 71.2, 3855, 573],
  ];
  for (const [name, L, W, H, wt, fee, storage] of common) {
    it(`WFS pricing page estimate: ${name} → fulfillment ${fee}¢, storage ${storage}¢`, () => {
      const r = run(walmart, "us", wfs(L, W, H, wt));
      expect(fulfillmentTotal(r)).toBe(fee);
      expect(line(r, "storage")).toBe(storage);
    });
  }

  it("the vacuum lands on 31 lb (29.75 + 0.25 → 30.0015, rounded up), where the table drops to $14.55", () => {
    expect(shippingWeight(28.74, 12.6, 11.42, 15.9).lb).toBe(31);
    expect(standardBaseFee(30)).toBe(1915);
    expect(standardBaseFee(31)).toBe(1455);
  });

  /* ------------------------------------------------ referral fee: bases, bands, edges */

  it("default: $25 item + $5 shipping in Home & Kitchen pays 15% on both, $4.50, no other fee", () => {
    const r = run(walmart, "us");
    expect(line(r, "referral")).toBe(375);
    expect(line(r, "referral-shipping")).toBe(75);
    expect(r.totalFees).toBe(450);
    expect(r.payout).toBe(2550);
    expect(r.buyerPays).toBe(3000);
  });

  it("research D-1: Apparel $12 + $4 shipping = $16 falls in the 10% band for the whole amount ($1.60)", () => {
    const r = run(walmart, "us", { category: "apparel", price: 12, shippingCharged: 4 });
    expect(line(r, "referral")).toBe(120);
    expect(line(r, "referral-shipping")).toBe(40);
    const free = run(walmart, "us", { category: "apparel", price: 12, shippingCharged: 0 });
    expect(line(free, "referral")).toBe(60);
  });

  it("Apparel edges: $15.00 is 5%, $15.01 is 10%, $20.00 is 10%, $20.01 is 15% (whole amount)", () => {
    const at = (p: number) => line(run(walmart, "us", { category: "apparel", price: p, shippingCharged: 0 }), "referral");
    expect(at(14.99)).toBe(75); // 5% × 14.99 = 0.7495
    expect(at(15)).toBe(75);
    expect(at(15.01)).toBe(150);
    expect(at(20)).toBe(200);
    expect(at(20.01)).toBe(300);
  });

  it("Baby and Beauty: $10.00 is 8%, $10.01 is 15%; Grocery: $15.00 is 8%, $15.01 is 15%", () => {
    const at = (c: string, p: number) => line(run(walmart, "us", { category: c, price: p, shippingCharged: 0 }), "referral");
    expect(at("baby", 10)).toBe(80);
    expect(at("baby", 10.01)).toBe(150);
    expect(at("beauty", 9.99)).toBe(80);
    expect(at("beauty", 10.01)).toBe(150);
    expect(at("grocery", 15)).toBe(120);
    expect(at("grocery", 15.01)).toBe(225);
  });

  it("research D-6: Outdoor Power Tools $500.00 pays 15% ($75), $500.01 pays 8% on the whole price ($40)", () => {
    const at = (p: number) => line(run(walmart, "us", { category: "outdoor-power-tools", price: p, shippingCharged: 0 }), "referral");
    expect(at(500)).toBe(7500);
    expect(at(500.01)).toBe(4000);
  });

  it("shipping counts toward the band: $10 + $5 shipping is 5%, $10.01 + $5 is 10% on item and shipping", () => {
    const a = run(walmart, "us", { category: "apparel", price: 10, shippingCharged: 5 });
    expect(line(a, "referral") + line(a, "referral-shipping")).toBe(50 + 25);
    const b = run(walmart, "us", { category: "apparel", price: 10.01, shippingCharged: 5 });
    expect(line(b, "referral")).toBe(100);
    expect(line(b, "referral-shipping")).toBe(50);
  });

  it("research D-2: Jewelry $400 = 20% × $250 + 5% × $150 = $57.50", () => {
    expect(line(run(walmart, "us", { category: "jewelry", price: 400, shippingCharged: 0 }), "referral")).toBe(5750);
  });

  it("research D-3: approved trading cards $4,000 = 8% × $2,500 + 2.35% × $1,500 = $235.25", () => {
    const r = run(walmart, "us", { category: "collectibles-cards", price: 4000, shippingCharged: 0 });
    expect(line(r, "referral")).toBe(23525);
    expect(line(run(walmart, "us", { category: "collectibles-cards", price: 2500, shippingCharged: 0 }), "referral")).toBe(20000);
    expect(line(run(walmart, "us", { category: "collectibles-other", price: 4000, shippingCharged: 0 }), "referral")).toBe(32000);
  });

  it("research D-4 and D-5: Watches $2,000 = $240.00; Electronics Accessories $150 = $19.00", () => {
    expect(line(run(walmart, "us", { category: "watches", price: 2000, shippingCharged: 0 }), "referral")).toBe(24000);
    expect(line(run(walmart, "us", { category: "electronics-accessories", price: 150, shippingCharged: 0 }), "referral")).toBe(1900);
  });

  it("banded categories include shipping in the total: Furniture $190 + $20 = $210 → 15% × $200 + 10% × $10", () => {
    const r = run(walmart, "us", { category: "furniture", price: 190, shippingCharged: 20 });
    expect(line(r, "referral")).toBe(3100);
    expect(has(r, "referral-shipping")).toBe(false);
    const c = run(walmart, "us", { category: "appliances-compact", price: 400, shippingCharged: 0 });
    expect(line(c, "referral")).toBe(3600 + 800);
  });

  it("flat categories: Personal Computers 6%, Plumbing 10%, printer cartridges 12%, binoculars 8%", () => {
    const at = (c: string) => line(run(walmart, "us", { category: c, price: 100, shippingCharged: 0 }), "referral");
    expect(at("computers")).toBe(600);
    expect(at("plumbing")).toBe(1000);
    expect(at("printer-cartridges")).toBe(1200);
    expect(at("office")).toBe(1500);
    expect(at("outdoors-optics")).toBe(800);
    expect(at("outdoors")).toBe(1500);
  });

  it("gift wrap is part of the total sales price", () => {
    const r = run(walmart, "us", { price: 25, giftWrap: 5, shippingCharged: 0 });
    expect(line(r, "referral")).toBe(450);
  });

  /* ------------------------------------------------ WFS details */

  it("research D-7: WFS Home & Kitchen $29.99, 2.4 lb, 10 × 8 × 4 in → $4.50 + $5.45 + $0.14 storage", () => {
    const r = run(walmart, "us", wfs(10, 8, 4, 2.4, { price: 29.99 }));
    expect(line(r, "referral")).toBe(450);
    expect(line(r, "fulfillment")).toBe(545);
    expect(line(r, "storage")).toBe(14);
    expect(has(r, "referral-shipping")).toBe(false); // WFS: no shipping charge of yours
  });

  it("WFS ignores a shipping charge typed before switching", () => {
    const r = run(walmart, "us", wfs(10, 8, 4, 2, { shippingCharged: 9 }));
    expect(r.saleAmount).toBe(2500);
  });

  it("under 1 lb uses the unit weight only: 0.75 lb → 1 lb ($3.45), 0.76 lb → 2 lb ($4.95)", () => {
    expect(line(run(walmart, "us", wfs(12, 9, 6, 0.75)), "fulfillment")).toBe(345);
    expect(line(run(walmart, "us", wfs(12, 9, 6, 0.76)), "fulfillment")).toBe(495);
  });

  it("add-ons: clothing $0.50, hazmat $0.50, under $10 $1 (not at $10.00), Oversize 1 $3", () => {
    const r = run(walmart, "us", wfs(10, 8, 4, 2, { price: 9.99, apparel: true, hazmat: true }));
    expect(line(r, "wfs-addons")).toBe(200);
    expect(has(run(walmart, "us", wfs(10, 8, 4, 2, { price: 10 })), "wfs-addons")).toBe(false);
    expect(line(run(walmart, "us", wfs(48.1, 8, 4, 2)), "wfs-addons")).toBe(300);
    expect(has(run(walmart, "us", wfs(48, 8, 4, 2)), "wfs-addons")).toBe(false);
    expect(wfsSize(35, 31, 4, 2).oversize).toBe(1); // median side over 30 in.
  });

  it("Oversize 2 starts the unit weight at 90 lb before the 0.25 lb packaging allowance", () => {
    // 100 in. long, light and thin: dim weight 100 × 6 × 4 / 139 = 17.3 lb, so 90 lb + 0.25 → 91 lb.
    const r = run(walmart, "us", wfs(100, 6, 4, 5));
    expect(wfsSize(100, 6, 4, 5).oversize).toBe(2);
    expect(line(r, "fulfillment")).toBe(1755 + 40 * 40);
    expect(line(r, "wfs-addons")).toBe(2000);
  });

  it("big & bulky edges: 150 lb is standard, 150.01 lb is bulky; 108 in. standard, 108.1 in. bulky", () => {
    expect(wfsSize(30, 20, 20, 150).tier).toBe("standard");
    expect(wfsSize(30, 20, 20, 150.01).tier).toBe("bulky");
    expect(wfsSize(108, 10, 10, 20).tier).toBe("standard");
    expect(wfsSize(108.1, 10, 10, 20).tier).toBe("bulky");
    expect(line(run(walmart, "us", wfs(30, 20, 20, 150.01)), "fulfillment")).toBe(15500 + 80 * 61);
  });

  it("items over the WFS limits get a warning", () => {
    const limits = (r: Result) => r.warnings.some((w) => w.includes("WFS limits"));
    expect(limits(run(walmart, "us", wfs(130, 20, 20, 50)))).toBe(true);
    expect(limits(run(walmart, "us", wfs(60, 20, 20, 501)))).toBe(true);
    expect(limits(run(walmart, "us", wfs(60, 104, 20, 50)))).toBe(false);
    expect(limits(run(walmart, "us", wfs(110, 105, 20, 50)))).toBe(true);
  });

  it("storage: Oct–Dec adds $1.50 after day 30; long-term $2.25 from day 366 and $7.50 after 450", () => {
    // 1 cubic foot (12 × 12 × 12)
    const at = (days: number, season: string) => line(run(walmart, "us", wfs(12, 12, 12, 5, { storageDays: days, storageSeason: season })), "storage");
    expect(at(30, "peak")).toBe(75);
    expect(at(60, "peak")).toBe(75 + 225);
    expect(at(60, "offpeak")).toBe(150);
    expect(at(365, "offpeak")).toBe(Math.round((75 * 365) / 30));
    expect(at(366, "offpeak")).toBe(Math.round((75 * 365 + 225) / 30));
    expect(at(451, "offpeak")).toBe(Math.round((75 * 365 + 225 * 85 + 750) / 30));
    expect(has(run(walmart, "us", wfs(12, 12, 12, 5, { storageDays: 0 })), "storage")).toBe(false);
  });

  it("storage season follows the calendar", () => {
    expect(storageSeason(Date.UTC(2026, 8, 15, 12))).toBe("offpeak");
    expect(storageSeason(Date.UTC(2026, 9, 15, 12))).toBe("peak");
    expect(storageSeason(Date.UTC(2027, 0, 15, 12))).toBe("offpeak");
  });

  it("prep services: $0.45 labeling, $0.60 poly bag, $1.05 both", () => {
    expect(line(run(walmart, "us", wfs(10, 8, 4, 2, { prep: "label" })), "prep")).toBe(45);
    expect(line(run(walmart, "us", wfs(10, 8, 4, 2, { prep: "bag" })), "prep")).toBe(60);
    expect(line(run(walmart, "us", wfs(10, 8, 4, 2, { prep: "both" })), "prep")).toBe(105);
  });

  it("WFS return note quotes the return processing fee for the shipping weight", () => {
    const r = run(walmart, "us", wfs(12, 10, 10, 6));
    expect(r.notes.some((n) => n.includes("$7.75 fulfillment fee") && n.includes("$9.00 return processing fee"))).toBe(true);
  });

  /* ------------------------------------------------ promotions (end January 31, 2027) */

  it("promotions run until January 31, 2027 (Pacific) and stop after", () => {
    expect(promosActive(Date.UTC(2026, 9, 23))).toBe(true);
    expect(promosActive(PROMO_END - 1)).toBe(true);
    expect(promosActive(PROMO_END)).toBe(false);
  });

  it("New-Seller Savings: 20% off the referral fee, 10% off WFS fulfillment, while the offer runs", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 23, 18)));
    const r = run(walmart, "us", { promo: "nss-20" });
    expect(line(r, "referral-discount")).toBe(-90); // 20% × $4.50
    expect(r.payout).toBe(3000 - 360);
    const w = run(walmart, "us", wfs(10, 8, 4, 2, { promo: "nss-30" }));
    expect(line(w, "wfs-discount")).toBe(-55); // 10% × $5.45 = 0.545
    expect(line(w, "referral-discount")).toBe(-113); // 30% × $3.75 = 1.125
  });

  it("Customer Favorites with WFS: 25% off referral, 15% off fulfillment, storage free; not on big & bulky fulfillment", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 23, 18)));
    const r = run(walmart, "us", wfs(12, 10, 10, 6, { promo: "cf-25" }));
    expect(line(r, "referral-discount")).toBe(-94); // 25% × $3.75
    expect(line(r, "wfs-discount")).toBe(-116); // 15% × $7.75 = 1.1625
    expect(line(r, "storage-discount")).toBe(-52);
    const all = run(walmart, "us", { promo: "cf-100" });
    expect(all.totalFees).toBe(0);
    const bulky = run(walmart, "us", wfs(120, 28, 14, 36, { promo: "cf-25" }));
    expect(has(bulky, "wfs-discount")).toBe(false);
  });

  it("after January 31, 2027 the promotions no longer reduce fees", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2027, 1, 2, 18)));
    const r = run(walmart, "us", { promo: "nss-20" });
    expect(has(r, "referral-discount")).toBe(false);
    expect(r.totalFees).toBe(450);
    expect(r.notes.some((n) => n.includes("ended on January 31, 2027"))).toBe(true);
  });

  /* ------------------------------------------------ reverse mode */

  it("reverse mode finds the lowest price that pays the target", () => {
    const m = M.us;
    const inputs = walmart.defaults(m);
    const s = solvePrice(walmart, inputs, m, "payout", 2000);
    expect(s.price).not.toBeNull();
    expect(s.result!.payout).toBeGreaterThanOrEqual(2000);
    expect(walmart.calculate({ ...inputs, price: (s.price! - 1) / 100 }, m).payout).toBeLessThan(2000);
  });

  it("reverse mode across the Apparel $15 band edge picks the price just under it", () => {
    const m = M.us;
    const inputs = { ...walmart.defaults(m), category: "apparel", shippingCharged: 5 };
    // At $10.00 + $5 shipping the whole $15.00 pays 5%: $14.25 kept. One cent more pays 10%: $13.51.
    const s = solvePrice(walmart, inputs, m, "payout", 1425);
    expect(s.price).toBe(1000);
    expect(walmart.calculate({ ...inputs, price: 9.99 }, m).payout).toBeLessThan(1425);
    // $14.26 can't be reached under the edge, so the answer is well above it.
    const t = solvePrice(walmart, inputs, m, "payout", 1426);
    expect(t.price).toBeGreaterThan(1001);
    expect(t.result!.payout).toBeGreaterThanOrEqual(1426);
    expect(walmart.calculate({ ...inputs, price: (t.price! - 1) / 100 }, m).payout).toBeLessThan(1426);
  });

  it("reverse mode with WFS crosses the $10 low-price add-on", () => {
    const m = M.us;
    const inputs = { ...walmart.defaults(m), ...wfs(10, 8, 4, 2) };
    // $9.99 pays the $1 add-on and keeps $1.90; $10.00 doesn't and keeps $2.91.
    const s = solvePrice(walmart, inputs, m, "payout", 290);
    expect(s.price).toBe(1000);
    expect(s.result!.payout).toBe(291);
    expect(walmart.calculate({ ...inputs, price: 9.99 }, m).payout).toBe(190);
  });
});
