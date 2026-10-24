import { describe, expect, it } from "vitest";
import reverb from "@/fees/platforms/reverb";
import { solvePrice } from "@/fees/solve";
import { M } from "@/fees/markets";
import { checkContract, line, run } from "./helpers";

const has = (r: ReturnType<typeof run>, id: string) => r.fees.some((l) => l.id === id);

describe("reverb", () => {
  it("meets the module contract in every market", () => {
    expect(checkContract(reverb)).toEqual([]);
  });

  /* Official worked examples */

  it("Billing Policy: a $650 Gibson Les Paul pays a $32.50 selling fee", () => {
    const r = run(reverb, "us", { price: 650, shippingCharged: 0 });
    expect(line(r, "selling")).toBe(3250);
  });

  it("Preferred Seller article: a $15,000 guitar pays $500, not $750", () => {
    const r = run(reverb, "us", { price: 15000, shippingCharged: 0 });
    expect(line(r, "selling")).toBe(50000);
  });

  it("Pricing page: 5% + 3.19% + $0.49 = 8.19% + $0.49 total fees", () => {
    const r = run(reverb, "us", { price: 100, shippingCharged: 0 });
    expect(r.totalFees).toBe(819 + 49);
  });

  /* Derived examples (research file section 6) */

  it("US default: $300 item + $25 shipping, no tax", () => {
    const r = run(reverb, "us");
    expect(line(r, "selling")).toBe(1625);
    expect(line(r, "processing")).toBe(1086); // 3.19% × 325.00 = 10.3675 → 10.37 + 0.49
    expect(r.totalFees).toBe(2711);
    expect(r.payout).toBe(29789);
  });

  it("derived A: processing includes sales tax, the selling fee doesn't", () => {
    const r = run(reverb, "us", { price: 1000, shippingCharged: 50, salesTax: 8 });
    expect(r.buyerPays).toBe(113400);
    expect(line(r, "selling")).toBe(5250);
    expect(line(r, "processing")).toBe(3666); // 3.19% × 1,134.00 = 36.1746 → 36.17 + 0.49
    expect(r.totalFees).toBe(8916);
    expect(r.payout).toBe(96084);
  });

  it("derived B: Bump 5% on price + shipping", () => {
    const r = run(reverb, "us", { price: 300, shippingCharged: 25, bump: 5 });
    expect(line(r, "bump")).toBe(1625);
    expect(r.totalFees).toBe(4336);
    expect(r.payout).toBe(28164);
  });

  it("derived C: $12,000 sold abroad hits the $500 cap and pays 1% cross-border", () => {
    const r = run(reverb, "us", { price: 12000, shippingCharged: 150, buyerRegion: "international", salesTax: 8 });
    expect(line(r, "selling")).toBe(50000);
    expect(line(r, "processing")).toBe(38808); // 388.075 → 388.08 (no US sales tax on an export)
    expect(line(r, "crossborder")).toBe(12150);
    expect(r.payout).toBe(1114042);
  });

  it("derived D: UK all-in 5%, no processing; +1% for a buyer outside the UK", () => {
    const home = run(reverb, "uk", { price: 400, shippingCharged: 20, vatOnFees: false });
    expect(line(home, "selling")).toBe(2100);
    expect(line(home, "processing")).toBe(0);
    expect(home.payout).toBe(39900);
    const abroad = run(reverb, "uk", { price: 400, shippingCharged: 20, vatOnFees: false, buyerRegion: "international" });
    expect(line(abroad, "crossborder")).toBe(420);
    expect(abroad.payout).toBe(39480);
  });

  it("derived E: an $8 item pays the $0.50 minimum", () => {
    const r = run(reverb, "us", { price: 8, shippingCharged: 0 });
    expect(line(r, "selling")).toBe(50);
    expect(line(r, "processing")).toBe(75); // 0.2552 → 0.26 + 0.49
    expect(r.totalFees).toBe(125);
  });

  /* Thresholds */

  it("USD minimum and maximum edges", () => {
    const fee = (price: number) => line(run(reverb, "us", { price, shippingCharged: 0 }), "selling");
    expect(fee(9)).toBe(50);
    expect(fee(9.99)).toBe(50); // 0.4995 → minimum
    expect(fee(10)).toBe(50);
    expect(fee(10.09)).toBe(50); // 0.5045 → 0.50
    expect(fee(10.1)).toBe(51); // 0.505 rounds half away from zero
    expect(fee(9990)).toBe(49950);
    expect(fee(9999.89)).toBe(49999); // 499.9945
    expect(fee(10000)).toBe(50000);
    expect(fee(10000.01)).toBe(50000);
    // shipping counts toward the cap
    expect(line(run(reverb, "us", { price: 9900, shippingCharged: 100 }), "selling")).toBe(50000);
    // $9.99 sale: 3.19% × 9.99 = 0.3187 → 0.32 + 0.49
    const r = run(reverb, "us", { price: 9.99, shippingCharged: 0 });
    expect(line(r, "processing")).toBe(81);
    expect(r.payout).toBe(999 - 131);
  });

  it("EUR and GBP caps are €500 and £500", () => {
    expect(line(run(reverb, "de", { price: 9999.89, shippingCharged: 0 }), "selling")).toBe(49999);
    expect(line(run(reverb, "de", { price: 10000, shippingCharged: 0 }), "selling")).toBe(50000);
    const uk = run(reverb, "uk", { price: 10500, shippingCharged: 0, buyerRegion: "international", vatOnFees: false });
    expect(line(uk, "selling")).toBe(50000);
    expect(line(uk, "crossborder")).toBe(10500); // 1% of £10,500
    expect(uk.payout).toBe(1050000 - 60500);
  });

  it("CAD cap is C$680 (Help Center)", () => {
    const fee = (price: number) => line(run(reverb, "ca", { price, shippingCharged: 0 }), "selling");
    expect(fee(13590)).toBe(67950);
    expect(fee(13599.89)).toBe(67999); // 679.9945
    expect(fee(13600)).toBe(68000);
    expect(fee(14000)).toBe(68000);
  });

  it("other currencies use the US-dollar equivalent of $0.50 / $500 (ECB 2026-10-22)", () => {
    // $500 × 0.9211 / 1.1205 = CHF 411.0219…
    const ch = run(reverb, "ch", { price: 9000, shippingCharged: 0 });
    expect(line(ch, "selling")).toBe(41102);
    expect(line(ch, "processing")).toBe(28710 + 50); // 3.19% × 9,000 + CHF 0.50
    // $0.50 × 11.112 / 1.1205 = SEK 4.958…
    expect(line(run(reverb, "se", { price: 1, shippingCharged: 0 }), "selling")).toBe(496);
    // $0.50 × 10.488 / 1.1205 = NOK 4.680…: NOK 80 → minimum, NOK 100 → 5%
    expect(line(run(reverb, "no", { price: 80, shippingCharged: 0 }), "selling")).toBe(468);
    expect(line(run(reverb, "no", { price: 100, shippingCharged: 0 }), "selling")).toBe(500);
  });

  /* Markets */

  it("Canada: 3.19% + C$0.49; Germany: 3.19% + €0.49; Norway 3.3% + NOK 2.80; Switzerland 3.19% + CHF 0.50", () => {
    expect(line(run(reverb, "ca", { price: 400, shippingCharged: 30 }), "processing")).toBe(1421); // 13.717 → 13.72 + 0.49
    expect(line(run(reverb, "de", { price: 300, shippingCharged: 20 }), "processing")).toBe(1070); // 10.208 → 10.21 + 0.49
    expect(line(run(reverb, "no", { price: 3000, shippingCharged: 250 }), "processing")).toBe(10725 + 280);
    expect(line(run(reverb, "ch", { price: 300, shippingCharged: 20 }), "processing")).toBe(1021 + 50);
    expect(line(run(reverb, "pl", { price: 1000, shippingCharged: 0 }), "processing")).toBe(3300 + 135);
  });

  it("EEA sales are domestic; outside the EEA adds 1%", () => {
    const inside = run(reverb, "de", { buyerRegion: "domestic" });
    expect(has(inside, "crossborder")).toBe(false);
    const outside = run(reverb, "de", { price: 300, shippingCharged: 20, buyerRegion: "international" });
    expect(line(outside, "crossborder")).toBe(320);
    // Sweden, buyer outside the EEA, 25% VAT on fees:
    // 5% × 2,150 = 107.50; 3.3% × 2,150 + 3.25 = 74.20; 1% = 21.50; VAT 25% × 203.20 = 50.80
    const se = run(reverb, "se", { price: 2000, shippingCharged: 150, buyerRegion: "international" });
    expect(line(se, "selling")).toBe(10750);
    expect(line(se, "processing")).toBe(7420);
    expect(line(se, "crossborder")).toBe(2150);
    expect(line(se, "vat")).toBe(5080);
    expect(se.payout).toBe(215000 - 10750 - 7420 - 2150 - 5080);
  });

  it("VAT on fees for UK/EU sellers without a VAT ID", () => {
    const uk = run(reverb, "uk", { price: 300, shippingCharged: 20 });
    expect(line(uk, "vat")).toBe(320); // 20% × £16.00
    const de = run(reverb, "de", { price: 300, shippingCharged: 20 });
    expect(line(de, "vat")).toBe(507); // 19% × €26.70 = 5.073
    expect(has(run(reverb, "uk", { vatOnFees: false }), "vat")).toBe(false);
    expect(has(run(reverb, "ch"), "vat")).toBe(false);
  });

  /* Options */

  it("Bump: brand-new Direct Offer sales are capped at 1.5%, lower rates stay", () => {
    const capped = run(reverb, "us", { price: 300, shippingCharged: 25, bump: 6, directOfferNew: true });
    expect(line(capped, "bump")).toBe(488); // 1.5% × 325 = 4.875
    const low = run(reverb, "us", { price: 300, shippingCharged: 25, bump: 1, directOfferNew: true });
    expect(line(low, "bump")).toBe(325);
  });

  it("Preferred Sellers pay 2.99% + $0.49", () => {
    const r = run(reverb, "us", { price: 300, shippingCharged: 25, preferred: true });
    expect(line(r, "processing")).toBe(972 + 49); // 9.7175 → 9.72
  });

  it("currency conversion: 2.5% of the payout subtotal after processing", () => {
    const r = run(reverb, "ca", { price: 400, shippingCharged: 30, currencyConversion: true });
    expect(line(r, "fx")).toBe(1039); // 2.5% × (430.00 − 14.21) = 10.3948
    // Poland with VAT: 3.3% × 1,280 + 1.35 = 43.59; 2.5% × 1,236.41 = 30.91; VAT 23% × (64 + 43.59 + 30.91) = 31.855 → 31.86
    const pl = run(reverb, "pl", { currencyConversion: true });
    expect(line(pl, "processing")).toBe(4359);
    expect(line(pl, "fx")).toBe(3091);
    expect(line(pl, "vat")).toBe(3186);
  });

  it("Canada: processing is charged on the GST/HST Reverb collects", () => {
    // C$430 + 13% HST = C$485.90; 3.19% × 485.90 = 15.5002 → 15.50 + 0.49
    const r = run(reverb, "ca", { price: 400, shippingCharged: 30, salesTax: 13 });
    expect(r.buyerPays).toBe(48590);
    expect(line(r, "selling")).toBe(2150);
    expect(line(r, "processing")).toBe(1599);
    expect(r.payout).toBe(43000 - 2150 - 1599);
  });

  it("Safe Shipping is charged on the item price only", () => {
    const r = run(reverb, "us", { price: 2000, shippingCharged: 80, safeShipping: 2 });
    expect(line(r, "safeshipping")).toBe(4000);
    const top = run(reverb, "us", { price: 1500, shippingCharged: 60, safeShipping: 3.5 });
    expect(line(top, "safeshipping")).toBe(5250);
    expect(line(top, "selling")).toBe(7800);
  });

  it("Bump at the 30% maximum", () => {
    expect(line(run(reverb, "us", { bump: 30 }), "bump")).toBe(9750); // 30% × $325
  });

  /* Reverse mode */

  it("reverse mode finds the lowest price that pays the target", () => {
    const check = (market: (typeof reverb.markets)[number], overrides: Record<string, number>, goal: number) => {
      const inputs = { ...reverb.defaults(market), ...overrides };
      const s = solvePrice(reverb, inputs, market, "payout", goal);
      expect(s.price).not.toBeNull();
      expect(s.result!.payout).toBeGreaterThanOrEqual(goal);
      const below = reverb.calculate({ ...inputs, price: (s.price! - 1) / 100 }, market);
      expect(below.payout).toBeLessThan(goal);
      return s.price;
    };
    // across the $500 cap (breakpoint at $9,975 + $25 shipping)
    for (const goal of [25000, 950000, 1200000]) check(M.us, {}, goal);
    // in the $0.50-minimum zone: keep $8.00 from a no-shipping sale → $9.29 (9.29 − 0.50 − 0.79)
    expect(check(M.us, { shippingCharged: 0 }, 800)).toBe(929);
    // CAD cap (C$13,600) and the CHF cap converted from $500
    check(M.ca, { shippingCharged: 0 }, 1240000);
    check(M.ch, { shippingCharged: 0 }, 790000);
  });

  it("breakpoints sit where the minimum and the cap start", () => {
    expect(reverb.breakpoints!({ ...reverb.defaults(M.us), shippingCharged: 0 }, M.us)).toEqual([1000, 1000000]);
    expect(reverb.breakpoints!({ ...reverb.defaults(M.ca), shippingCharged: 0 }, M.ca)).toEqual([1000, 1360000]);
    expect(reverb.breakpoints!(reverb.defaults(M.us), M.us)).toEqual([997500]);
  });
});
