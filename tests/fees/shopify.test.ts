import { describe, expect, it } from "vitest";
import shopify, { THIRD_PARTY, planMonthly } from "@/fees/platforms/shopify";
import { solvePrice } from "@/fees/solve";
import { M } from "@/fees/markets";
import { checkContract, line, run } from "./helpers";

/** Most examples look at one order without the plan fee spread over the month. */
const one = { ordersPerMonth: 0 };

describe("shopify", () => {
  it("meets the module contract in every market", () => {
    expect(checkContract(shopify)).toEqual([]);
  });

  it("defaults: US Basic, $50 + $5 shipping, Shopify Payments personal card, $39 plan over 100 orders", () => {
    const r = run(shopify, "us");
    expect(line(r, "plan")).toBe(39); // $39 ÷ 100
    expect(line(r, "processing")).toBe(190); // 2.9% × 55.00 = 1.595 → 1.60, + 0.30
    expect(r.totalFees).toBe(229);
    expect(r.payout).toBe(5271);
  });

  // ---- Official worked examples (Shopify help center / shopify.com) ----

  it("official: currency conversion since April 6, 2026 is 1.5% of the gross order (C$100 order, US store → 1.50)", () => {
    const r = run(shopify, "us", { ...one, price: 100, shippingCharged: 0, currencyConversion: true });
    expect(line(r, "fx")).toBe(150);
  });

  it("official: Shopify Tax on a $30 T-shirt is $0.11 ($0.08 on Plus), nothing when it's off", () => {
    const base = { ...one, price: 30, shippingCharged: 0, shopifyTax: true };
    expect(line(run(shopify, "us", base), "shopifytax")).toBe(11); // 0.35% × 30 = 0.105
    expect(line(run(shopify, "us", { ...base, plan: "plus" }), "shopifytax")).toBe(8); // 0.25% × 30 = 0.075
    expect(run(shopify, "us", { ...base, shopifyTax: false }).fees.some((l) => l.id === "shopifytax")).toBe(false);
  });

  it("official: card + C$10 store credit on Shopify Payments → transaction fee only on the C$10", () => {
    const r = run(shopify, "ca", { ...one, price: 50, shippingCharged: 5, giftCard: 10 });
    expect(line(r, "giftcard")).toBe(20); // 2% × 10.00 on Basic
    expect(r.fees.some((l) => l.id === "transaction")).toBe(false);
    expect(line(r, "processing")).toBe(156); // 2.8% × 45.00 = 1.26, + 0.30
  });

  it("official: third-party fee = [(products − discounts) + tax + shipping] × plan rate", () => {
    // $80 of products, 12.5% off ($70), $8 shipping, 8% tax on $78 = $6.24 → base $84.24
    const r = run(shopify, "us", { ...one, provider: "other", price: 80, discount: 12.5, shippingCharged: 8, salesTax: 8 });
    expect(line(r, "transaction")).toBe(168); // 2% × 84.24 = 1.6848
    expect(line(r, "provider")).toBe(274); // 2.9% × 84.24 = 2.443 → 2.44, + 0.30
    expect(r.buyerPays).toBe(8424);
    expect(r.saleAmount).toBe(7800);
    expect(line(run(shopify, "us", { ...one, provider: "other", plan: "grow" }), "transaction")).toBe(55); // 1% × 55
    expect(line(run(shopify, "us", { ...one, provider: "other", plan: "advanced" }), "transaction")).toBe(33); // 0.6% × 55
    expect(line(run(shopify, "us", { ...one, provider: "other", plan: "plus" }), "transaction")).toBe(11); // 0.2% × 55
  });

  // ---- Derived examples from the research file ----

  it("D1: US Basic, $50 + $5 shipping + $4.40 tax → $2.02 fee charged on the tax too", () => {
    const r = run(shopify, "us", { ...one, salesTax: 8 });
    expect(r.buyerPays).toBe(5940);
    expect(line(r, "processing")).toBe(202); // 2.9% × 59.40 = 1.7226 → 1.72, + 0.30
    expect(r.payout).toBe(5500 - 202); // the $4.40 tax goes to the state
  });

  it("D2: US premium card (business card or AmEx) on $100 → $3.80", () => {
    expect(line(run(shopify, "us", { ...one, price: 100, shippingCharged: 0, card: "premium" }), "processing")).toBe(380);
  });

  it("D3: US Grow, foreign card paying in its own currency, $100 → $4.00 + $1.50", () => {
    const r = run(shopify, "us", { ...one, plan: "grow", price: 100, shippingCharged: 0, card: "international", currencyConversion: true });
    expect(line(r, "processing")).toBe(400); // (2.7% + 1%) × 100 + 0.30
    expect(line(r, "fx")).toBe(150);
    expect(r.totalFees).toBe(550);
  });

  it("D5: UK Basic, domestic card, £50 → £1.25", () => {
    expect(line(run(shopify, "uk", { ...one, price: 50, shippingCharged: 0 }), "processing")).toBe(125);
  });

  it("D6: Australia Basic (October 2026 rates), A$100 → A$2.00 + A$0.20 GST", () => {
    const r = run(shopify, "au", { ...one, price: 100, shippingCharged: 0 });
    expect(line(r, "processing")).toBe(200);
    expect(line(r, "gst")).toBe(20);
  });

  it("D7: yearly billing saves $312 a year on Grow; the per-order share follows the billing period", () => {
    expect((planMonthly(M.us, "grow", "monthly", "3") - planMonthly(M.us, "grow", "yearly", "3")) * 12).toBe(31200);
    expect(line(run(shopify, "us", { billing: "yearly" }), "plan")).toBe(29);
    expect(line(run(shopify, "us", { plan: "plus" }), "plan")).toBe(2300);
    expect(line(run(shopify, "us", { plan: "plus", plusTerm: "1" }), "plan")).toBe(2500);
    expect(line(run(shopify, "uk", { plan: "advanced", billing: "yearly", ordersPerMonth: 7 }), "plan")).toBe(3700); // £259 ÷ 7
  });

  it("D8: on Shopify Payments, Basic and Grow cost the same at $33,000 a month; Grow and Advanced at $147,000", () => {
    // One order standing for a month's sales, so the whole plan fee lands on it.
    const month = (plan: string, price: number) => run(shopify, "us", { plan, price, shippingCharged: 0, ordersPerMonth: 1 }).totalFees;
    expect(month("basic", 33000)).toBe(month("grow", 33000)); // 2.9% vs 2.7%: $66 plan difference
    expect(month("basic", 33100)).toBeGreaterThan(month("grow", 33100));
    expect(month("grow", 147000)).toBe(month("advanced", 147000)); // 2.7% vs 2.5%: $294 plan difference
    const yearly = (plan: string, price: number) => run(shopify, "us", { plan, billing: "yearly", price, shippingCharged: 0, ordersPerMonth: 1 }).totalFees;
    expect(yearly("basic", 25000)).toBe(yearly("grow", 25000)); // $29 vs $79 billed yearly
    expect(yearly("grow", 110000)).toBe(yearly("advanced", 110000)); // $79 vs $299 billed yearly
  });

  it("D9: with another provider, Grow beats Basic above $6,600 a month (monthly billing)", () => {
    const extra = planMonthly(M.us, "grow", "monthly", "3") - planMonthly(M.us, "basic", "monthly", "3");
    expect(extra / ((THIRD_PARTY.basic - THIRD_PARTY.grow) / 100)).toBe(660000);
  });

  it("other channels and payment methods", () => {
    expect(line(run(shopify, "us", { ...one, channel: "inperson" }), "processing")).toBe(153); // 2.6% × 55 = 1.43 + 0.10
    expect(line(run(shopify, "us", { ...one, channel: "manual" }), "processing")).toBe(203); // 3.5% × 55 = 1.925 → 1.93 + 0.10
    expect(line(run(shopify, "uk", { ...one, channel: "inperson" }), "processing")).toBe(94); // 1.7% × 55 = 0.935, no fixed fee
    expect(line(run(shopify, "ca", { ...one, channel: "interac" }), "processing")).toBe(15);
    expect(line(run(shopify, "ca", { ...one, channel: "interac", plan: "plus" }), "processing")).toBe(10);
    const pp = run(shopify, "us", { ...one, card: "paypal", currencyConversion: true });
    expect(line(pp, "processing")).toBe(241); // 3.49% × 55 = 1.9195 → 1.92 + 0.49
    expect(line(pp, "fx")).toBe(165); // PayPal Wallet conversion 3%
    expect(line(run(shopify, "ca", { ...one, card: "premium" }), "processing")).toBe(223); // 3.5% × 55 = 1.925 → 1.93 + 0.30
    expect(line(run(shopify, "au", { ...one, card: "international", plan: "plus" }), "processing")).toBe(206); // 3.2% × 55 = 1.76 + 0.30
    expect(line(run(shopify, "uk", { ...one, currencyConversion: true }), "fx")).toBe(110); // 2% outside the US
  });

  it("market-specific inputs are ignored where they don't apply", () => {
    // UK/AU prices include VAT/GST: a sales-tax input has no effect there.
    expect(run(shopify, "uk", { salesTax: 20 }).buyerPays).toBe(5500);
    // A US-only payment method falls back to the standard card elsewhere.
    expect(line(run(shopify, "uk", { ...one, card: "paypal" }), "processing")).toBe(135);
    expect(line(run(shopify, "uk", { ...one, channel: "manual" }), "processing")).toBe(135);
  });

  it("PayPal with Shopify Payments as main provider is exempt from the transaction fee", () => {
    const r = run(shopify, "us", { ...one, provider: "other", paypalExempt: true, providerRate: 3.49, providerFixed: 0.49 });
    expect(line(r, "transaction")).toBe(0);
    expect(line(r, "provider")).toBe(241);
  });

  it("gift cards: stores opened before May 12, 2025 pay nothing on that part; fully covered orders have no card fee", () => {
    expect(line(run(shopify, "us", { ...one, giftCard: 10, oldStore: true }), "giftcard")).toBe(0);
    const covered = run(shopify, "us", { ...one, price: 20, shippingCharged: 0, giftCard: 25 });
    expect(line(covered, "giftcard")).toBe(40); // only the $20 order is paid by the card
    expect(line(covered, "processing")).toBe(0);
  });

  it("Shopify Tax cap: $0.99 per order, one cent below and at the edge", () => {
    const at = (price: number) => run(shopify, "us", { ...one, price, shippingCharged: 0, shopifyTax: true }).fees.find((l) => l.id === "shopifytax")!;
    // 0.35% × 284.28 = 0.99498 → $0.99 uncapped; 0.35% × 284.29 = 0.995015 → $1.00, so the cap applies from here.
    expect(at(284.28).amount).toBe(99);
    expect(at(284.28).detail).not.toContain("capped");
    expect(at(284.29).amount).toBe(99);
    expect(at(284.29).detail).toContain("capped");
    expect(at(1000).amount).toBe(99);
    // Plus: 0.25% reaches $0.995 at $398.00 (0.995 → $1.00).
    const plus = (price: number) => run(shopify, "us", { ...one, plan: "plus", price, shippingCharged: 0, shopifyTax: true }).fees.find((l) => l.id === "shopifytax")!;
    expect(plus(397.99).detail).not.toContain("capped"); // 0.994975 → $0.99
    expect(plus(398).detail).toContain("capped");
    // UK/CA rate is 0.25% (Plus 0.15%), cap 0.99 in local currency: £100 → £0.25.
    expect(line(run(shopify, "uk", { ...one, price: 100, shippingCharged: 0, shopifyTax: true }), "shopifytax")).toBe(25);
    expect(line(run(shopify, "ca", { ...one, plan: "plus", price: 100, shippingCharged: 0, shopifyTax: true }), "shopifytax")).toBe(15);
    expect(run(shopify, "au", { shopifyTax: true }).fees.some((l) => l.id === "shopifytax")).toBe(false);
  });

  // ---- Hand-computed cases (worked out from the official rates, not from the module) ----

  it("Canada Grow, American Express, C$120 + C$10 shipping + 13% HST", () => {
    // gross = 130 + 16.90 = 146.90; 3.4% × 146.90 = 4.9946 → 4.99 + 0.30 = 5.29; plan C$132 ÷ 100 = 1.32
    const r = run(shopify, "ca", { plan: "grow", card: "premium", price: 120, shippingCharged: 10, salesTax: 13 });
    expect(r.buyerPays).toBe(14690);
    expect(line(r, "processing")).toBe(529);
    expect(line(r, "plan")).toBe(132);
    expect(r.totalFees).toBe(661);
    expect(r.payout).toBe(13000 - 661);
  });

  it("UK Advanced, foreign card paying in its own currency, £80", () => {
    // 2.5% × 80 + 0.25 = 2.25; conversion 2% × 80 = 1.60; plan £344 ÷ 100 = 3.44
    const r = run(shopify, "uk", { plan: "advanced", card: "international", price: 80, shippingCharged: 0, currencyConversion: true });
    expect(line(r, "processing")).toBe(225);
    expect(line(r, "fx")).toBe(160);
    expect(line(r, "plan")).toBe(344);
    expect(r.payout).toBe(8000 - 729);
  });

  it("Australia Plus 3-year term, in person, A$200 (October 2026 rates)", () => {
    // 1.45% × 200 = 2.90, no fixed fee; GST 10% × 2.90 = 0.29; plan A$3,700 ÷ 100 = 37.00
    const r = run(shopify, "au", { plan: "plus", channel: "inperson", price: 200, shippingCharged: 0 });
    expect(line(r, "processing")).toBe(290);
    expect(line(r, "gst")).toBe(29);
    expect(line(r, "plan")).toBe(3700);
    expect(r.totalFees).toBe(4019);
    // AmEx on Basic, A$99.99: 2.9% × 99.99 = 2.89971 → 2.90 + 0.30 = 3.20; GST 0.32
    const amex = run(shopify, "au", { ...one, card: "premium", price: 99.99, shippingCharged: 0 });
    expect(line(amex, "processing")).toBe(320);
    expect(line(amex, "gst")).toBe(32);
  });

  it("US Plus with another provider and $30 of store credit on a $100 order", () => {
    // store credit: 0.2% × 30 = 0.06; the $70 on the card: 0.2% × 70 = 0.14 to Shopify, 2.9% × 70 + 0.30 = 2.33 to the provider
    const r = run(shopify, "us", { plan: "plus", provider: "other", price: 100, shippingCharged: 0, giftCard: 30 });
    expect(line(r, "giftcard")).toBe(6);
    expect(line(r, "transaction")).toBe(14);
    expect(line(r, "provider")).toBe(233);
    expect(line(r, "plan")).toBe(2300); // $2,300 3-year term ÷ 100
  });

  it("US Grow billed yearly on the default order: 2.7% × 55 = 1.485 rounds to 1.49", () => {
    const r = run(shopify, "us", { plan: "grow", billing: "yearly" });
    expect(line(r, "processing")).toBe(179);
    expect(line(r, "plan")).toBe(79);
    expect(line(run(shopify, "us", { ...one, plan: "plus", channel: "manual" }), "processing")).toBe(197); // 3.4% × 55 = 1.87 + 0.10
  });

  it("warns below Shopify Payments' minimum charge (one cent below and at the edge)", () => {
    const w = (market: string, price: number) => run(shopify, market, { ...one, price, shippingCharged: 0 }).warnings.some((x) => x.includes("can’t charge"));
    expect(w("us", 0.49)).toBe(true);
    expect(w("us", 0.5)).toBe(false);
    expect(w("uk", 0.29)).toBe(true);
    expect(w("uk", 0.3)).toBe(false);
  });

  it("apps and ads show up per order", () => {
    const r = run(shopify, "us", { appsMonthly: 50, adCost: 6 });
    expect(line(r, "apps")).toBe(50);
    expect(line(r, "ads")).toBe(600);
  });

  it("reverse mode finds the lowest price that pays the target", () => {
    const m = M.us;
    const inputs = shopify.defaults(m);
    const s = solvePrice(shopify, inputs, m, "payout", 5000);
    expect(s.price).not.toBeNull();
    expect(s.result!.payout).toBeGreaterThanOrEqual(5000);
    expect(shopify.calculate({ ...inputs, price: (s.price! - 1) / 100 }, m).payout).toBeLessThan(5000);
  });

  it("breakpoints: first price charged to a card, and the Shopify Tax cap", () => {
    const m = M.us;
    const d = shopify.defaults(m);
    expect(shopify.breakpoints!(d, m)).toEqual([]); // $5 shipping: a card is charged from $0.00
    expect(shopify.breakpoints!({ ...d, shippingCharged: 0 }, m)).toEqual([1]);
    expect(shopify.breakpoints!({ ...d, shopifyTax: true }, m)).toEqual([27929]); // $279.29 + $5 = $284.29
    expect(shopify.breakpoints!({ ...d, shippingCharged: 0, shopifyTax: true, plan: "plus" }, m)).toEqual([1, 39800]);
  });

  it("reverse mode across the Shopify Tax cap", () => {
    const m = M.us;
    const inputs = { ...shopify.defaults(m), ...one, shippingCharged: 0, shopifyTax: true };
    // p − (2.9% p + 0.30) − 0.99 = 300 → p = 310.29 (2.9% × 310.29 = 8.998 → 9.00)
    const s = solvePrice(shopify, inputs, m, "payout", 30000);
    expect(s.price).toBe(31029);
    expect(s.result!.payout).toBe(30000);
    expect(shopify.calculate({ ...inputs, price: 310.28 }, m).payout).toBe(29999);
    // Below the cap, at $103.67: 2.9% = 3.00643 → 3.01, + 0.30, Shopify Tax 0.35% = 0.362845 → 0.36 → keeps 100.00;
    // at $103.66: 3.00614 → 3.01 and 0.36281 → 0.36 → keeps 99.99.
    const low = solvePrice(shopify, inputs, m, "payout", 10000);
    expect(low.price).toBe(10367);
    expect(shopify.calculate({ ...inputs, price: 103.66 }, m).payout).toBe(9999);
  });

  it("reverse mode across the gift-card breakpoint (the card fee starts once the order exceeds the gift card)", () => {
    const m = M.us;
    const inputs = { ...shopify.defaults(m), ...one, shippingCharged: 0, giftCard: 20 };
    expect(shopify.breakpoints!(inputs, m)).toEqual([2001]);
    // Below the breakpoint the best payout is $19.60 at $20.00; just above it the $0.30 card fee drops it.
    expect(shopify.calculate({ ...inputs, price: 20 }, m).payout).toBe(1960);
    expect(shopify.calculate({ ...inputs, price: 20.01 }, m).payout).toBe(1931);
    const low = solvePrice(shopify, inputs, m, "payout", 1955);
    expect(low.price).toBe(1995);
    const high = solvePrice(shopify, inputs, m, "payout", 1965);
    expect(high.price).toBeGreaterThan(2001);
    expect(high.result!.payout).toBeGreaterThanOrEqual(1965);
    expect(shopify.calculate({ ...inputs, price: (high.price! - 1) / 100 }, m).payout).toBeLessThan(1965);
  });
});
