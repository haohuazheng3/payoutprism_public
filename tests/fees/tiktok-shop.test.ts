import { describe, expect, it } from "vitest";
import tiktokShop, { auctionReductionActive, referralFee, refundAdminFee, TIER_EDGE } from "@/fees/platforms/tiktok-shop";
import { solvePrice } from "@/fees/solve";
import { M } from "@/fees/markets";
import { checkContract, line, run } from "./helpers";

const preOwnedCards = "preowned-collectible-trading-cards";
const tradingCards = "collectibles-trading-cards-accessories";

describe("tiktok-shop", () => {
  it("meets the module contract", () => {
    expect(checkContract(tiktokShop)).toEqual([]);
  });

  it("official referral fee example: 6% × ($102 + $5 − $2) = $6.30", () => {
    // Customer Payment $102 = $100 paid before tax + $2 tax; TikTok-funded discount $5 → item price $105.
    const r = run(tiktokShop, "us", { price: 105, shippingCharged: 0, platformDiscount: 5, salesTax: 2 });
    expect(r.buyerPays).toBe(10200);
    expect(line(r, "referral")).toBe(630);
    expect(referralFee(10200 + 500 - 200, 6)).toBe(630);
  });

  it("official partial refund example: 6% × ($102 − $51 + $5 − $2.5 − $2 + $1) = $3.15, admin fee $6.30 × 50% × 20% = $0.63", () => {
    expect(referralFee(10200 - 5100 + 500 - 250 - 200 + 100, 6)).toBe(315);
    expect(refundAdminFee(630 * 0.5)).toBe(63);
  });

  it("official full refund example: admin fee $6.30 × 20% = $1.26", () => {
    expect(refundAdminFee(630)).toBe(126);
  });

  it("official refund administration fee scenarios A–D (capped at $5 per SKU)", () => {
    const sku = (price: number) => refundAdminFee(referralFee(price * 100, 6));
    expect(sku(10)).toBe(12); // A: $10 × 6% × 20%
    expect(sku(500)).toBe(500); // B: $6 reduced to $5
    expect(sku(10) * 2).toBe(24); // C: two SKUs at $10
    expect(sku(500) + sku(10)).toBe(512); // D: $5 + $0.12
  });

  it("official campaign service fee example: 1% × ($90 + $5) = $0.95, TikTok's $20 discount not deducted", () => {
    const r = run(tiktokShop, "us", { price: 100, sellerDiscount: 10, platformDiscount: 20, shippingCharged: 5, campaignFee: 1 });
    expect(line(r, "campaign")).toBe(95);
    expect(line(r, "referral")).toBe(570); // 6% × ($90 + $5): the platform discount is added back
    expect(r.buyerPays).toBe(7500);
  });

  it("default: $25 item + $5 shipping pays 6% on $30 and no separate processing fee", () => {
    const r = run(tiktokShop, "us");
    expect(line(r, "referral")).toBe(180);
    expect(line(r, "processing")).toBe(0);
    expect(r.totalFees).toBe(180);
    expect(r.payout).toBe(2820);
  });

  it("derived D1: $40 + $5.99 shipping; sales tax stays out of the base", () => {
    const r = run(tiktokShop, "us", { price: 40, shippingCharged: 5.99, salesTax: 8 });
    expect(line(r, "referral")).toBe(276); // 6% × 45.99 = 2.7594
    expect(r.buyerPays).toBe(4599 + 368);
    expect(refundAdminFee(276)).toBe(55);
  });

  it("derived D2: Gold jewelry 5%, seller discount lowers the base, TikTok coupon doesn't", () => {
    const r = run(tiktokShop, "us", { price: 200, sellerDiscount: 5, platformDiscount: 20, shippingCharged: 0, category: "jewelry-gold" });
    expect(line(r, "referral")).toBe(950);
    expect(r.buyerPays).toBe(17000);
    expect(r.payout).toBe(19000 - 950);
    // Other jewelry sub-categories stay at 6%
    expect(line(run(tiktokShop, "us", { price: 200, shippingCharged: 0, category: "jewelry-other" }), "referral")).toBe(1200);
  });

  it("derived D3: Collectibles $12,500 pays 6% on $10,000 and 3% on $2,500 = $675; refund admin capped at $5", () => {
    const r = run(tiktokShop, "us", { price: 12500, shippingCharged: 0, category: tradingCards });
    expect(line(r, "referral")).toBe(67500);
    expect(refundAdminFee(67500)).toBe(500);
  });

  it("$10,000 tier edge: one cent below, at, and above (Pre-Owned 5% → 3%)", () => {
    expect(line(run(tiktokShop, "us", { price: 9999.99, shippingCharged: 0, category: preOwnedCards }), "referral")).toBe(50000); // 499.9995
    expect(line(run(tiktokShop, "us", { price: 10000, shippingCharged: 0, category: preOwnedCards }), "referral")).toBe(50000);
    expect(line(run(tiktokShop, "us", { price: 10000.01, shippingCharged: 0, category: preOwnedCards }), "referral")).toBe(50000);
    expect(line(run(tiktokShop, "us", { price: 11000, shippingCharged: 0, category: preOwnedCards }), "referral")).toBe(53000);
    // Shipping counts toward the $10,000 sale
    expect(line(run(tiktokShop, "us", { price: 9900, shippingCharged: 200, category: preOwnedCards }), "referral")).toBe(50000 + 300);
    // Standard categories have no tier
    expect(line(run(tiktokShop, "us", { price: 11000, shippingCharged: 0 }), "referral")).toBe(66000);
    expect(TIER_EDGE).toBe(1_000_000);
  });

  it("refund administration fee cap edge: $5 is reached at a $25.00 referral fee", () => {
    expect(refundAdminFee(2499)).toBe(500); // 4.998 → 5.00
    expect(refundAdminFee(2475)).toBe(495);
    expect(refundAdminFee(2500)).toBe(500);
    expect(refundAdminFee(2600)).toBe(500);
  });

  it("creator commission is on the item price; Smart Promotion on item + shipping (research D5 stack)", () => {
    const r = run(tiktokShop, "us", { price: 25, shippingCharged: 0, affiliate: 15, smartPromo: "3.5", shippingCost: 4.7 });
    expect(line(r, "referral")).toBe(150);
    expect(line(r, "affiliate")).toBe(375);
    expect(line(r, "smartpromo")).toBe(88); // 0.875
    expect(r.totalFees + r.totalCosts).toBe(1083);
    expect(r.profit).toBe(1417);
    const s = run(tiktokShop, "us", { affiliate: 15, smartPromo: "3.5" });
    expect(line(s, "affiliate")).toBe(375);
    expect(line(s, "smartpromo")).toBe(105);
    expect(s.payout).toBe(2340);
  });

  it("Smart Promotion campaign periods add 1.0–2.0 points", () => {
    expect(line(run(tiktokShop, "us", { smartPromo: "4.5" }), "smartpromo")).toBe(135);
    expect(line(run(tiktokShop, "us", { smartPromo: "5.5" }), "smartpromo")).toBe(165);
  });

  it("Texas / West Virginia sellers pay sales tax on the referral fee only", () => {
    const r = run(tiktokShop, "us", { feeTax: true, feeTaxRate: 6.25, affiliate: 10 });
    expect(line(r, "feetax")).toBe(11); // 6.25% × 1.80 = 0.1125
    expect(line(run(tiktokShop, "us", { price: 100, shippingCharged: 0, feeTax: true, feeTaxRate: 6 }), "feetax")).toBe(36);
    expect(run(tiktokShop, "us").fees.some((l) => l.id === "feetax")).toBe(false);
  });

  it("multi-quantity orders pay the fee on every unit", () => {
    expect(line(run(tiktokShop, "us", { price: 20, quantity: 3, shippingCharged: 0 }), "referral")).toBe(360);
  });

  it("LIVE auction reduced fee runs Oct 1 – Dec 31, 2026 (PT)", () => {
    expect(auctionReductionActive(Date.UTC(2026, 8, 30, 12))).toBe(false);
    expect(auctionReductionActive(Date.UTC(2026, 9, 1, 7, 0))).toBe(true);
    expect(auctionReductionActive(Date.UTC(2026, 11, 31, 23))).toBe(true); // 3 p.m. PST
    expect(auctionReductionActive(Date.UTC(2027, 0, 1, 7, 59))).toBe(true); // 11:59 p.m. PST
    expect(auctionReductionActive(Date.UTC(2027, 0, 1, 8, 0))).toBe(false);
    const active = auctionReductionActive();
    const r = run(tiktokShop, "us", { auction: "new" });
    expect(line(r, "referral")).toBe(active ? 120 : 180);
    const h = run(tiktokShop, "us", { price: 600, shippingCharged: 0, auction: "highvalue" });
    expect(line(h, "referral")).toBe(active ? 1800 : 3600);
  });

  it("3% high-value auction rate starts at $500 ($1,500 for jewelry); below it the category rate applies", () => {
    const active = auctionReductionActive();
    const hv = (price: number, category = "standard") => line(run(tiktokShop, "us", { price, shippingCharged: 0, auction: "highvalue", category }), "referral");
    expect(hv(499.99)).toBe(3000); // 6% × $499.99 = 29.9994
    expect(hv(500)).toBe(active ? 1500 : 3000); // 3% × $500
    expect(hv(1499.99, "jewelry-gold")).toBe(7500); // 5% × $1,499.99 = 74.9995
    expect(hv(1500, "jewelry-gold")).toBe(active ? 4500 : 7500); // 3% × $1,500
    const below = run(tiktokShop, "us", { price: 499.99, shippingCharged: 0, auction: "highvalue" });
    expect(below.notes.some((n) => n.includes("high-value orders"))).toBe(active);
    const inputs = { ...tiktokShop.defaults(M.us), auction: "highvalue" };
    expect(tiktokShop.breakpoints!(inputs, M.us)).toEqual(active ? [50_000] : []);
  });

  it("Collectibles $10,000 edge counts shipping: one cent below, at, and above", () => {
    const c = (price: number) => line(run(tiktokShop, "us", { price, shippingCharged: 20, category: "collectibles-sports-collectibles" }), "referral");
    expect(c(9979.99)).toBe(60000); // 6% × $9,999.99 = 599.9994
    expect(c(9980)).toBe(60000); // 6% × $10,000
    expect(c(9990)).toBe(60030); // 6% × $10,000 + 3% × $10
  });

  it("warns against counting a campaign service fee on top of Smart Promotion", () => {
    const r = run(tiktokShop, "us", { smartPromo: "4.5", campaignFee: 2 });
    expect(line(r, "campaign")).toBe(60); // 2% × $30
    expect(r.notes.some((n) => n.includes("Fee Policy"))).toBe(true);
    expect(run(tiktokShop, "us", { campaignFee: 2 }).notes.some((n) => n.includes("Fee Policy"))).toBe(false);
  });

  it("reverse mode finds the lowest price that pays the target", () => {
    const m = M.us;
    const inputs = tiktokShop.defaults(m);
    const s = solvePrice(tiktokShop, inputs, m, "payout", 2000);
    expect(s.price).not.toBeNull();
    expect(s.result!.payout).toBeGreaterThanOrEqual(2000);
    expect(tiktokShop.calculate({ ...inputs, price: (s.price! - 1) / 100 }, m).payout).toBeLessThan(2000);
  });

  it("reverse mode jumps to the $500 high-value auction price when that is the cheapest way to reach the target", () => {
    const m = M.us;
    const inputs = { ...tiktokShop.defaults(m), shippingCharged: 0, auction: "highvalue" };
    // $480 payout: at $499.99 you keep $469.99 (6%); at $500.00 you keep $485.00 (3%).
    const s = solvePrice(tiktokShop, inputs, m, "payout", 48000);
    expect(s.price).toBe(auctionReductionActive() ? 50000 : 51064); // without the reduction: 48000 / 0.94 = 51,063.8
  });

  it("reverse mode with several items and a seller discount across the $10,000 tier", () => {
    const m = M.us;
    const inputs = { ...tiktokShop.defaults(m), category: preOwnedCards, quantity: 2, sellerDiscount: 10, shippingCharged: 5 };
    const goal = 960_000;
    const s = solvePrice(tiktokShop, inputs, m, "payout", goal);
    expect(s.price).not.toBeNull();
    expect(s.result!.payout).toBeGreaterThanOrEqual(goal);
    expect(tiktokShop.calculate({ ...inputs, price: (s.price! - 1) / 100 }, m).payout).toBeLessThan(goal);
  });

  it("reverse mode across the $10,000 Pre-Owned breakpoint", () => {
    const m = M.us;
    const inputs = { ...tiktokShop.defaults(m), category: preOwnedCards, shippingCharged: 0 };
    expect(tiktokShop.breakpoints!(inputs, m)).toEqual([1_000_000]);
    const goal = 1_100_000; // $11,000 payout needs a sale above $10,000
    const s = solvePrice(tiktokShop, inputs, m, "payout", goal);
    expect(s.price).not.toBeNull();
    expect(s.result!.payout).toBeGreaterThanOrEqual(goal);
    expect(tiktokShop.calculate({ ...inputs, price: (s.price! - 1) / 100 }, m).payout).toBeLessThan(goal);
  });
});
