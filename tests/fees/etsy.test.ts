import { describe, expect, it } from "vitest";
import etsy, { shareSaveRate } from "@/fees/platforms/etsy";
import { solvePrice } from "@/fees/solve";
import { M } from "@/fees/markets";
import { checkContract, line, run } from "./helpers";

describe("etsy", () => {
  it("meets the module contract in every market", () => {
    expect(checkContract(etsy)).toEqual([]);
  });

  it("US: research example D1 (item $25, shipping $5, 8% sales tax), lines rounded separately", () => {
    const r = run(etsy, "us", { price: 25, shippingCharged: 5, salesTax: 8 });
    expect(line(r, "listing")).toBe(20);
    expect(line(r, "transaction")).toBe(163); // 6.5% × 25.00 = 1.625
    expect(line(r, "transaction-shipping")).toBe(33); // 6.5% × 5.00 = 0.325
    expect(line(r, "processing")).toBe(122); // 3% × 32.40 + 0.25 = 1.222
    expect(r.buyerPays).toBe(3240);
    expect(r.totalFees).toBe(338);
    expect(r.payout).toBe(3000 - 338);
  });

  it("US: research example D2 with Offsite Ads at 15%", () => {
    const r = run(etsy, "us", { price: 40, shippingCharged: 6, salesTax: 8, offsiteAds: "15" });
    expect(line(r, "offsite")).toBe(690);
    expect(line(r, "processing")).toBe(174); // 3% × 49.68 + 0.25
  });

  it("Offsite Ads fee is capped at US$100 per order (research D5)", () => {
    const r = run(etsy, "us", { price: 850, shippingCharged: 50, offsiteAds: "12" });
    expect(line(r, "offsite")).toBe(10000);
  });

  it("UK: research example D3 (item £20, shipping £3.50, no VAT ID)", () => {
    const r = run(etsy, "uk", { price: 20, shippingCharged: 3.5, vatOnFees: true });
    expect(line(r, "transaction")).toBe(130);
    expect(line(r, "transaction-shipping")).toBe(23);
    expect(line(r, "processing")).toBe(114); // 4% × 23.50 + 0.20
    expect(line(r, "rof")).toBe(11); // 0.48% × 23.50 = 0.1128
    expect(line(r, "listing")).toBe(15); // US$0.20 at the ECB reference rate
    expect(line(r, "vat")).toBe(Math.round(0.2 * (15 + 130 + 23 + 114 + 11)));
  });

  it("Canada: research example D4, US buyer counts as domestic (3%) and ROF 0.50%", () => {
    const r = run(etsy, "ca", { price: 40, shippingCharged: 12, buyerRegion: "domestic" });
    expect(line(r, "transaction") + line(r, "transaction-shipping")).toBe(260 + 78);
    expect(line(r, "processing")).toBe(181);
    expect(line(r, "rof")).toBe(26);
  });

  it("Canada / Australia / New Zealand international orders use 4%", () => {
    const r = run(etsy, "au", { price: 40, shippingCharged: 10, buyerRegion: "international" });
    expect(line(r, "processing")).toBe(Math.round(0.04 * 5000) + 25);
  });

  it("multi-quantity orders pay the US$0.20 listing fee per item", () => {
    expect(line(run(etsy, "us", { quantity: 10 }), "listing")).toBe(200);
  });

  it("Texas sellers pay 6.25% sales tax on 80% of transaction fees (help-center example: $100 → $5)", () => {
    const r = run(etsy, "us", { price: 1538.46, shippingCharged: 0, texas: true });
    // transaction fee 6.5% × 1538.46 = 100.00
    expect(line(r, "transaction")).toBe(10000);
    expect(line(r, "texas")).toBe(500);
  });

  it("Share & Save: 4% normally, 6.5% during the holiday promotion", () => {
    expect(shareSaveRate(Date.UTC(2026, 8, 1))).toBe(4);
    expect(shareSaveRate(Date.UTC(2026, 10, 1))).toBe(6.5);
    expect(shareSaveRate(Date.UTC(2027, 0, 5))).toBe(4);
  });

  it("Ireland always pays VAT on fees", () => {
    const r = run(etsy, "ie", { vatOnFees: false });
    expect(r.fees.some((l) => l.id === "vat")).toBe(true);
  });

  it("reverse mode finds the lowest price that pays the target", () => {
    const m = M.us;
    const inputs = etsy.defaults(m);
    const s = solvePrice(etsy, inputs, m, "payout", 2000);
    expect(s.price).not.toBeNull();
    expect(s.result!.payout).toBeGreaterThanOrEqual(2000);
    const below = etsy.calculate({ ...inputs, price: (s.price! - 1) / 100 }, m);
    expect(below.payout).toBeLessThan(2000);
  });
});
