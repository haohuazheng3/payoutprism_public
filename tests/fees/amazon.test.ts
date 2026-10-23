import { describe, expect, it } from "vitest";
import amazon, { getCategory, refundAdminFee, referralFee, PROFESSIONAL_MONTHLY, INDIVIDUAL_PER_ITEM } from "@/fees/platforms/amazon";
import { solvePrice } from "@/fees/solve";
import { M } from "@/fees/markets";
import { checkContract, line, run } from "./helpers";

const ref = (cat: string, totalSalesPrice: number) => referralFee(getCategory(cat), Math.round(totalSalesPrice * 100)).amount;

describe("amazon (merchant fulfilled)", () => {
  it("meets the module contract", () => {
    expect(checkContract(amazon)).toEqual([]);
  });

  it("default: $25 item + $5 shipping, Home & Kitchen 15%, Professional over 100 sales", () => {
    const r = run(amazon, "us");
    expect(line(r, "referral")).toBe(450); // 15% × $30.00
    expect(line(r, "subscription")).toBe(40); // $39.99 / 100
    expect(r.totalFees).toBe(490);
    expect(r.payout).toBe(2510);
    expect(r.buyerPays).toBe(3000);
  });

  // Official examples (Seller Central "Referral fees" and "Selling on Amazon fee schedule").
  it("official example 1: toy, $25.00 item + $4.50 delivery + $3.50 gift wrap → $4.95", () => {
    const r = run(amazon, "us", { category: "toys", price: 25, shippingCharged: 4.5, giftWrap: 3.5 });
    expect(r.buyerPays).toBe(3300);
    expect(line(r, "referral")).toBe(495);
  });

  it("official watch examples: $8.00 → $1.28, $1,500 → $240.00, $7,000 → $405.00", () => {
    expect(ref("watches", 8)).toBe(128);
    expect(ref("watches", 1500)).toBe(24000);
    expect(ref("watches", 7000)).toBe(40500);
  });

  it("official refund administration fee examples", () => {
    const cat = getCategory("toys");
    expect(refundAdminFee(cat, ref("toys", 10))).toBe(30); // $10.00 × 15% = $1.50 → $0.30
    expect(refundAdminFee(cat, ref("toys", 345))).toBe(500); // 20% × $51.75 = $10.35 → capped at $5
    expect(refundAdminFee(cat, ref("toys", 57))).toBe(171); // 20% × $8.55 = $1.71
    expect(refundAdminFee(cat, ref("toys", 600))).toBe(500); // two units of item A, one line item: $18 → $5
    expect(refundAdminFee(getCategory("media"), ref("media", 20))).toBe(0);
  });

  it("official per-item and plan figures: $0.99 per unit, $39.99/month, 40 × $0.99 = $39.60", () => {
    const r = run(amazon, "us", { plan: "individual" });
    expect(line(r, "per-item")).toBe(99);
    expect(r.fees.some((l) => l.id === "subscription")).toBe(false);
    expect(2 * INDIVIDUAL_PER_ITEM).toBe(198);
    expect(40 * INDIVIDUAL_PER_ITEM).toBeLessThan(PROFESSIONAL_MONTHLY);
    expect(line(run(amazon, "us", { unitsPerMonth: 1 }), "subscription")).toBe(3999);
  });

  it("closing fee $1.80 on media; Individual book $12 + $3.99 shipping → $5.19 in fees (research D11)", () => {
    const r = run(amazon, "us", { category: "media", plan: "individual", price: 12, shippingCharged: 3.99 });
    expect(line(r, "referral")).toBe(240); // 15% × 15.99 = 2.3985
    expect(line(r, "closing")).toBe(180);
    expect(line(r, "per-item")).toBe(99);
    expect(r.totalFees).toBe(519);
    expect(line(run(amazon, "us", { category: "video-game-consoles" }), "closing")).toBe(180);
    expect(run(amazon, "us", { category: "toys" }).fees.some((l) => l.id === "closing")).toBe(false);
  });

  it("clothing brackets apply to the whole price, shipping included (research D1, D2)", () => {
    expect(line(run(amazon, "us", { category: "clothing", price: 18, shippingCharged: 3 }), "referral")).toBe(357); // $21 → 17%
    expect(line(run(amazon, "us", { category: "clothing", price: 18, shippingCharged: 0 }), "referral")).toBe(180); // $18 → 10%
    expect(ref("clothing", 15)).toBe(75);
    expect(ref("clothing", 15.01)).toBe(150);
    expect(ref("clothing", 20)).toBe(200);
    expect(ref("clothing", 20.01)).toBe(340);
  });

  it("other bracket categories: Baby/Beauty $10, Grocery $15 (no minimum), Lawn Mowers $500 (rate drops)", () => {
    expect(ref("baby", 10)).toBe(80);
    expect(ref("baby", 10.01)).toBe(150);
    expect(ref("beauty", 9.99)).toBe(80); // 8% × 9.99 = 0.7992
    expect(ref("grocery", 15)).toBe(120);
    expect(ref("grocery", 15.01)).toBe(225);
    expect(ref("grocery", 2)).toBe(16); // no $0.30 minimum
    expect(ref("lawn-mowers", 500)).toBe(7500);
    expect(ref("lawn-mowers", 500.01)).toBe(4000);
  });

  it("marginal categories charge each rate only on its band (research D3–D6, D10)", () => {
    expect(ref("furniture", 299)).toBe(3990);
    expect(ref("furniture", 200)).toBe(3000);
    expect(ref("furniture", 200.01)).toBe(3000); // 30.00 + 0.001
    expect(ref("jewelry", 300)).toBe(5250);
    expect(ref("jewelry", 250)).toBe(5000);
    expect(ref("electronics-accessories", 150)).toBe(1900);
    expect(ref("electronics-accessories", 100)).toBe(1500);
    expect(ref("compact-appliances", 400)).toBe(5300);
    expect(ref("fine-art", 6000)).toBe(60500);
    expect(ref("fine-art", 2)).toBe(40); // Seller Central lists no minimum for Fine Art
  });

  it("$0.30 minimum per unit where it applies (research D7)", () => {
    expect(ref("home-kitchen", 1.5)).toBe(30);
    expect(ref("home-kitchen", 2)).toBe(30);
    expect(ref("home-kitchen", 2.1)).toBe(32);
    expect(ref("gift-cards", 1)).toBe(20); // no minimum
    expect(ref("amazon-device-accessories", 10)).toBe(450);
    expect(ref("pet-vet-diets", 10)).toBe(220);
  });

  it("digital services fee: UK 2%, France 3%, Italy/Spain 3% on selling fees (research D12)", () => {
    const uk = run(amazon, "us", { category: "toys", price: 100, shippingCharged: 0, establishment: "uk" });
    expect(line(uk, "referral")).toBe(1500);
    expect(line(uk, "dsf")).toBe(30);
    const fr = run(amazon, "us", { category: "toys", price: 100, shippingCharged: 0, establishment: "fr", plan: "individual" });
    expect(line(fr, "dsf")).toBe(45 + 3); // 3% × $15.00 + 3% × $0.99 rounded up
    expect(run(amazon, "us", { establishment: "other" }).fees.some((l) => l.id === "dsf")).toBe(false);
  });

  it("Handmade: 15% with a $0.30 minimum, Professional fee waived", () => {
    const r = run(amazon, "us", { category: "handmade", price: 40, shippingCharged: 0 });
    expect(line(r, "referral")).toBe(600);
    expect(line(r, "subscription")).toBe(0);
    expect(run(amazon, "us", { category: "handmade", plan: "individual" }).warnings.length).toBe(1);
  });

  it("notes the next clothing bracket and the refund administration fee", () => {
    const r = run(amazon, "us", { category: "clothing", price: 17, shippingCharged: 2 });
    expect(r.notes.some((n) => n.includes("$20.01") && n.includes("17%"))).toBe(true);
    const above = run(amazon, "us", { category: "clothing", price: 18, shippingCharged: 3 });
    expect(above.notes.some((n) => n.includes("$17.00") && n.includes("$2.00"))).toBe(true);
  });

  it("reverse mode finds the lowest price that pays the target", () => {
    const m = M.us;
    const inputs = amazon.defaults(m);
    const s = solvePrice(amazon, inputs, m, "payout", 2000);
    expect(s.result!.payout).toBeGreaterThanOrEqual(2000);
    expect(amazon.calculate({ ...inputs, price: (s.price! - 1) / 100 }, m).payout).toBeLessThan(2000);
  });

  it("reverse mode across the clothing $20 bracket edge", () => {
    const m = M.us;
    const inputs = { ...amazon.defaults(m), category: "clothing", shippingCharged: 0 };
    // At $20.00 the payout is 2000 − 200 − 40 = 1760; one cent more drops it to 1621.
    const atEdge = solvePrice(amazon, inputs, m, "payout", 1760);
    expect(atEdge.price).toBe(2000);
    const past = solvePrice(amazon, inputs, m, "payout", 1761);
    expect(past.price).toBe(2170);
    expect(amazon.calculate({ ...inputs, price: 21.69 }, m).payout).toBeLessThan(1761);
    expect(amazon.breakpoints!(inputs, m)).toEqual([1501, 2001]);
  });
});
