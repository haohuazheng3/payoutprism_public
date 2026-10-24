import { describe, expect, it } from "vitest";
import swappa from "@/fees/platforms/swappa";
import { solvePrice } from "@/fees/solve";
import { M } from "@/fees/markets";
import type { Result } from "@/fees/types";
import { checkContract, line, run } from "./helpers";

function buyerLine(r: Result, id: string): number {
  return r.buyerFees.find((l) => l.id === id)?.amount ?? 0;
}

describe("swappa", () => {
  it("meets the module contract", () => {
    expect(checkContract(swappa)).toEqual([]);
  });

  it("defaults show a realistic sale: $300 Ask, PayPal, no tax (Swappa's own Galaxy example)", () => {
    const r = run(swappa, "us");
    expect(r.payout).toBe(27973);
    expect(r.notes.length).toBeGreaterThan(0);
    expect(r.notes.length).toBeLessThanOrEqual(3);
  });

  // Fair Fees page, "Compare to eBay Fees": Buyer Fee | Seller Fee | PayPal | Seller Payout.
  it.each([
    { ask: 500, buyer: 1500, seller: 1500, paypal: 1846, payout: 46654, total: 51500 }, // "iPhone purchased for $515"
    { ask: 300, buyer: 900, seller: 900, paypal: 1127, payout: 27973, total: 30900 }, // "Samsung Galaxy purchased for $309"
    { ask: 900, buyer: 2700, seller: 2700, paypal: 3284, payout: 84016, total: 92700 }, // "MacBook Pro purchased for $927"
    { ask: 600, buyer: 1800, seller: 1800, paypal: 2206, payout: 55994, total: 61800 }, // "PlayStation 5 purchased for $618"
  ])("official Fair Fees example: Ask $$ask", ({ ask, buyer, seller, paypal, payout, total }) => {
    const r = run(swappa, "us", { ask });
    expect(buyerLine(r, "buyer")).toBe(buyer);
    expect(line(r, "seller")).toBe(seller);
    expect(line(r, "processing")).toBe(paypal);
    expect(r.payout).toBe(payout);
    expect(r.buyerPays).toBe(total);
  });

  it("official FAQ: $100 Ask → $103 listing price, $3 seller fee, $97 before PayPal", () => {
    const r = run(swappa, "us", { ask: 100 });
    expect(r.buyerPays).toBe(10300);
    expect(line(r, "seller")).toBe(300);
    expect(10000 - line(r, "seller")).toBe(9700);
  });

  // Marketplace Selling Fees blog table (List price | Swappa fee | PayPal fee | Estimated net), 0 tax.
  it.each([
    [100, 300, 408, 9292],
    [200, 600, 768, 18632],
    [300, 900, 1127, 27973],
    [400, 1200, 1487, 37313],
    [500, 1500, 1846, 46654],
  ])("official selling-fees table: $%i Ask", (ask, fee, paypal, net) => {
    const r = run(swappa, "us", { ask });
    expect(line(r, "seller")).toBe(fee);
    expect(line(r, "processing")).toBe(paypal);
    expect(r.payout).toBe(net);
  });

  it("official Partner Fee example: $300 Ask, 8% tax → PayPal $12.14, payout $278.86", () => {
    const r = run(swappa, "us", { ask: 300, buyerState: "custom", salesTax: 8 });
    expect(buyerLine(r, "buyer")).toBe(900);
    expect(buyerLine(r, "tax")).toBe(2472); // 8% of $309
    expect(r.buyerPays).toBe(33372);
    expect(line(r, "seller") + buyerLine(r, "buyer") + buyerLine(r, "tax")).toBe(4272); // Partner Fee
    expect(line(r, "processing")).toBe(1214);
    expect(r.payout).toBe(27886);
    expect(r.notes.some((n) => n.includes("$42.72"))).toBe(true);
  });

  it("official sales tax example: $100 Ask, 8% → $8.24 tax, $111.24 total", () => {
    const r = run(swappa, "us", { ask: 100, buyerState: "custom", salesTax: 8 });
    expect(buyerLine(r, "tax")).toBe(824);
    expect(r.buyerPays).toBe(11124);
    expect(line(r, "processing")).toBe(437); // derived: 3.49% × 111.24 + 0.49
    expect(r.payout).toBe(9263);
  });

  it("official Stripe example: $100 Ask → $3.29 Stripe fee, $93.71 vs $92.92 on PayPal; $3.22 gap at $500", () => {
    const s100 = run(swappa, "us", { ask: 100, payment: "stripe" });
    expect(line(s100, "processing")).toBe(329);
    expect(s100.payout).toBe(9371);
    const gap = run(swappa, "us", { ask: 500, payment: "stripe" }).payout - run(swappa, "us", { ask: 500 }).payout;
    expect(gap).toBe(322);
    expect(s100.notes.some((n) => n.includes("Partner Fee"))).toBe(false);
  });

  it("Swappa-confirmed sale SZMK57478: Ask $729, buyer paid $750.87, one PayPal fee of $37.96, payout $669.17", () => {
    const r = run(swappa, "us", { ask: 729, payment: "paypal-intl" });
    expect(r.buyerPays).toBe(75087);
    expect(line(r, "seller")).toBe(2187);
    expect(line(r, "processing")).toBe(3796); // 4.99% × 750.87 = 37.4684 → 37.47, + 0.49
    expect(r.fees.map((l) => l.id)).toEqual(["seller", "processing"]);
    expect(r.payout).toBe(66917);
    // Domestic fee would be 26.21 + 0.49 = 26.70, so the buyer owes $11.26 back: 669.17 + 11.26 = 680.43.
    expect(r.notes[0]).toContain("$11.26");
    expect(r.notes[0]).toContain("$680.43");
  });

  it("non-US PayPal is one fee rounded once: $60 Ask → $3.57, of which $0.92 (not 1.5% × $61.80 = $0.93) is repaid", () => {
    const r = run(swappa, "us", { ask: 60, payment: "paypal-intl" });
    // 4.99% × 61.80 = 3.08382 → 3.08 + 0.49 = 3.57; domestic 3.49% × 61.80 = 2.15682 → 2.16 + 0.49 = 2.65.
    expect(line(r, "processing")).toBe(357);
    expect(r.fees.find((l) => l.id === "processing")!.detail).toContain("4.99% × $61.80 + $0.49");
    expect(r.payout).toBe(5463); // 60.00 − 1.80 − 3.57
    expect(r.notes[0]).toContain("$0.92");
    expect(r.notes[0]).toContain("$55.55"); // = the domestic payout 60.00 − 1.80 − 2.65
    expect(run(swappa, "us", { ask: 60 }).payout).toBe(5555);
  });

  it("derived D1: $250 Ask, no tax → $233.02; listing shows $258", () => {
    const r = run(swappa, "us", { ask: 250 });
    expect(line(r, "processing")).toBe(948);
    expect(r.payout).toBe(23302);
    expect(r.buyerFees.find((l) => l.id === "buyer")!.detail).toContain("$258");
  });

  it("derived D2: $799.99 Ask, 6.25% tax, Stripe → $750.30 (PayPal $744.95)", () => {
    const r = run(swappa, "us", { ask: 799.99, buyerState: "custom", salesTax: 6.25, payment: "stripe" });
    expect(line(r, "seller")).toBe(2400);
    expect(buyerLine(r, "tax")).toBe(5150);
    expect(r.buyerPays).toBe(87549);
    expect(line(r, "processing")).toBe(2569);
    expect(r.payout).toBe(75030);
    expect(run(swappa, "us", { ask: 799.99, buyerState: "custom", salesTax: 6.25 }).payout).toBe(74495);
  });

  it("derived D3: $1,000 Ask, non-US PayPal → $918.11, $933.56 once the buyer pays back $15.45", () => {
    const r = run(swappa, "us", { ask: 1000, payment: "paypal-intl" });
    expect(line(r, "processing")).toBe(5189); // 4.99% × 1,030 = 51.397 → 51.40, + 0.49 (domestic part 36.44)
    expect(r.payout).toBe(91811);
    expect(r.notes[0]).toContain("$15.45");
    expect(r.notes[0]).toContain("$933.56");
  });

  it("derived D4: $100 Ask with a $5 Featured listing → $87.92", () => {
    const r = run(swappa, "us", { ask: 100, featured: true });
    expect(line(r, "featured")).toBe(500);
    expect(r.payout).toBe(8792);
  });

  it("derived D5: $386 Ask, 9.5% tax → $358.74", () => {
    const r = run(swappa, "us", { ask: 386, buyerState: "custom", salesTax: 9.5 });
    expect(buyerLine(r, "tax")).toBe(3777);
    expect(line(r, "processing")).toBe(1568);
    expect(r.payout).toBe(35874);
  });

  it("state picker uses Swappa's published state average (California 8.26%)", () => {
    const r = run(swappa, "us", { ask: 300, buyerState: "CA" });
    expect(buyerLine(r, "tax")).toBe(2552); // 8.26% × $309.00 = 25.5234
    expect(line(r, "processing")).toBe(1216);
    expect(r.payout).toBe(27884);
    // The typed rate is ignored unless "I know the exact rate" is picked.
    expect(run(swappa, "us", { ask: 300, buyerState: "none", salesTax: 8 }).payout).toBe(27973);
  });

  it("shipping is the seller's cost: it unlocks profit without changing the payout", () => {
    const r = run(swappa, "us", { ask: 300, shippingCost: 12, itemCost: 200 });
    expect(r.payout).toBe(27973);
    expect(r.profit).toBe(27973 - 1200 - 20000);
  });

  it("a typed exact rate above 20% is capped at 20%: $300 Ask → $61.80 tax, $13.43 PayPal, $277.57", () => {
    const r = run(swappa, "us", { ask: 300, buyerState: "custom", salesTax: 25 });
    expect(buyerLine(r, "tax")).toBe(6180);
    expect(line(r, "processing")).toBe(1343); // 3.49% × 370.80 = 12.94092 → 12.94, + 0.49
    expect(r.payout).toBe(27757);
  });

  it("a one-cent Ask can't cover the $0.49 fixed fee and warns", () => {
    const r = run(swappa, "us", { ask: 0.01 });
    expect(r.payout).toBe(-48);
    expect(r.warnings.length).toBe(1);
  });

  it("half-cent fees round half up: $100.50 Ask → $3.02 seller fee", () => {
    const r = run(swappa, "us", { ask: 100.5 });
    expect(line(r, "seller")).toBe(302); // 3% × 100.50 = 3.015
    expect(r.buyerPays).toBe(10050 + 302);
  });

  it("reverse mode: $270 target needs a $289.59 Ask ($289.58 nets $269.99)", () => {
    const m = M.us;
    const inputs = swappa.defaults(m);
    const s = solvePrice(swappa, inputs, m, "payout", 27000);
    expect(s.price).toBe(28959);
    expect(s.result!.payout).toBeGreaterThanOrEqual(27000);
    expect(swappa.calculate({ ...inputs, ask: 289.58 }, m).payout).toBe(26999);
  });

  // Minimum Ask prices found by a brute-force scan of an independent integer model, not by the module.
  it.each([
    { target: 50000, payment: "stripe", buyerState: "CA", ask: 53356 },
    { target: 100000, payment: "paypal-intl", buyerState: "none", ask: 108914 },
    { target: 10000, payment: "paypal", buyerState: "TN", ask: 10798 },
  ])("reverse mode: $target cents payout ($payment, $buyerState) needs $ask cents", ({ target, payment, buyerState, ask }) => {
    const m = M.us;
    const inputs = { ...swappa.defaults(m), payment, buyerState };
    const s = solvePrice(swappa, inputs, m, "payout", target);
    expect(s.price).toBe(ask);
    expect(s.result!.payout).toBe(target);
    expect(swappa.calculate({ ...inputs, ask: (ask - 1) / 100 }, m).payout).toBe(target - 1);
  });

  it("reverse mode with tax, Stripe and costs reaches the target at the lowest cent", () => {
    const m = M.us;
    const inputs = { ...swappa.defaults(m), buyerState: "TN", payment: "stripe", shippingCost: 10, itemCost: 150 };
    const s = solvePrice(swappa, inputs, m, "profit", 10000);
    expect(s.price).not.toBeNull();
    expect(s.result!.profit!).toBeGreaterThanOrEqual(10000);
    const below = swappa.calculate({ ...inputs, ask: (s.price! - 1) / 100 }, m);
    expect(below.profit!).toBeLessThan(10000);
  });
});
