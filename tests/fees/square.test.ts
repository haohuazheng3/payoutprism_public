import { describe, expect, it } from "vitest";
import square, { bitcoinRate } from "@/fees/platforms/square";
import { solvePrice } from "@/fees/solve";
import { M } from "@/fees/markets";
import { checkContract, line, run } from "./helpers";

describe("square", () => {
  it("meets the module contract in every market", () => {
    expect(checkContract(square)).toEqual([]);
  });

  it("official example (developer docs): US $100 card-present, Canadian card → $2.75 + $1.50 = $4.25", () => {
    const r = run(square, "us", { price: 100, paymentType: "in_person", plan: "free", intlCard: true });
    expect(line(r, "processing")).toBe(275);
    expect(line(r, "intl")).toBe(150);
    expect(r.totalFees).toBe(425);
  });

  it("default: $50 in person on Square Free is 2.6% + 15¢", () => {
    const r = run(square, "us");
    expect(line(r, "processing")).toBe(145);
    expect(r.payout).toBe(4855);
  });

  it("research D1: the fee is on the whole charge, sales tax and tip included", () => {
    // $40 sale + 10% tax ($4) + $6 tip = $50 charged → 2.6% × 50 + 0.15
    const r = run(square, "us", { price: 40, salesTax: 10, tip: 6 });
    expect(r.buyerPays).toBe(5000);
    expect(line(r, "processing")).toBe(145);
    // The sales tax is passed on to the state, so it isn't part of what the seller keeps.
    expect(r.saleAmount).toBe(4600);
    expect(r.payout).toBe(4600 - 145);
  });

  it("research D2: online order $80 incl. shipping, Free 3.3% + 30¢ vs Plus 2.9% + 30¢", () => {
    const free = run(square, "us", { price: 72, shippingCharged: 8, paymentType: "online", plan: "free" });
    const plus = run(square, "us", { price: 72, shippingCharged: 8, paymentType: "online", plan: "plus" });
    expect(line(free, "processing")).toBe(294);
    expect(line(plus, "processing")).toBe(262);
    expect(line(run(square, "us", { price: 80, paymentType: "invoice_card", plan: "premium" }), "processing")).toBe(262);
  });

  it("shipping only counts for payment types where it is part of the charge", () => {
    expect(line(run(square, "us", { price: 50, shippingCharged: 10, paymentType: "in_person" }), "processing")).toBe(145);
    expect(line(run(square, "us", { price: 50, shippingCharged: 10, paymentType: "keyed" }), "processing")).toBe(225); // 3.5% × 60 + 0.15
  });

  it("in-person rates by plan: Plus 2.5% + 15¢, Premium 2.4% + 15¢ (Tap to Pay the same)", () => {
    expect(line(run(square, "us", { price: 100, plan: "plus" }), "processing")).toBe(265);
    expect(line(run(square, "us", { price: 100, plan: "premium" }), "processing")).toBe(255);
    expect(line(run(square, "us", { price: 100, plan: "premium", paymentType: "tap_to_pay" }), "processing")).toBe(255);
  });

  it("research D3: ACH invoice is 1% with a $1 minimum; $10 cap only on Plus and Premium", () => {
    expect(line(run(square, "us", { price: 2500, paymentType: "ach", plan: "free" }), "processing")).toBe(2500);
    expect(line(run(square, "us", { price: 2500, paymentType: "ach", plan: "plus" }), "processing")).toBe(1000);
    expect(line(run(square, "us", { price: 60, paymentType: "ach" }), "processing")).toBe(100);
  });

  it("ACH edges: minimum below $100, cap from $1,000 (Plus), $5 cap via the API, $0 into Square Checking", () => {
    expect(line(run(square, "us", { price: 99.99, paymentType: "ach" }), "processing")).toBe(100);
    expect(line(run(square, "us", { price: 100, paymentType: "ach" }), "processing")).toBe(100);
    expect(line(run(square, "us", { price: 150, paymentType: "ach" }), "processing")).toBe(150);
    expect(line(run(square, "us", { price: 999, paymentType: "ach", plan: "plus" }), "processing")).toBe(999);
    expect(line(run(square, "us", { price: 1000, paymentType: "ach", plan: "plus" }), "processing")).toBe(1000);
    expect(line(run(square, "us", { price: 1000.5, paymentType: "ach", plan: "plus" }), "processing")).toBe(1000);
    expect(line(run(square, "us", { price: 1000.5, paymentType: "ach", plan: "free" }), "processing")).toBe(1001);
    expect(line(run(square, "us", { price: 499, paymentType: "ach_api" }), "processing")).toBe(499);
    expect(line(run(square, "us", { price: 600, paymentType: "ach_api" }), "processing")).toBe(500);
    expect(line(run(square, "us", { price: 2500, paymentType: "ach", squareChecking: true }), "processing")).toBe(0);
  });

  it("research D4: Plus in person $200 with a foreign card = $5.15 + $3.00", () => {
    const r = run(square, "us", { price: 200, plan: "plus", intlCard: true });
    expect(line(r, "processing")).toBe(515);
    expect(line(r, "intl")).toBe(300);
    expect(r.payout).toBe(19185);
  });

  it("research D5 / D6: keyed $120 = $4.35; Afterpay $300 = $18.30 with no international fee", () => {
    expect(line(run(square, "us", { price: 120, paymentType: "keyed" }), "processing")).toBe(435);
    const r = run(square, "us", { price: 300, paymentType: "afterpay", intlCard: true });
    expect(line(r, "processing")).toBe(1830);
    expect(r.fees.some((l) => l.id === "intl")).toBe(false);
  });

  it("research D7: instant transfer is 1.95% of the amount transferred", () => {
    // ACH into Square Checking has no processing fee, so the whole $1,000 is transferred.
    const r = run(square, "us", { price: 1000, paymentType: "ach", squareChecking: true, payout: "instant" });
    expect(line(r, "instant")).toBe(1950);
    expect(r.payout).toBe(98050);
    // On a card payment it applies to the balance after processing: 1.95% × 48.55
    expect(line(run(square, "us", { payout: "instant" }), "instant")).toBe(95);
  });

  it("US: single payments over $10,000 can’t go out instantly, so no instant fee", () => {
    expect(line(run(square, "us", { price: 10000, payout: "instant" }), "instant")).toBeGreaterThan(0);
    expect(line(run(square, "us", { price: 10000.01, payout: "instant" }), "instant")).toBe(0);
  });

  it("Online API is 2.9% + 30¢ on every plan; EBT 1.8% + 5¢", () => {
    expect(line(run(square, "us", { price: 100, paymentType: "api", plan: "free" }), "processing")).toBe(320);
    expect(line(run(square, "us", { price: 100, paymentType: "ebt" }), "processing")).toBe(185);
  });

  it("bitcoin payments: 0% through December 31, 2026, 1% from January 1, 2027", () => {
    expect(bitcoinRate(Date.UTC(2026, 9, 23))).toBe(0);
    expect(bitcoinRate(Date.UTC(2027, 0, 1, 7, 59))).toBe(0);
    expect(bitcoinRate(Date.UTC(2027, 0, 1, 8, 0))).toBe(1);
  });

  it("UK: 1.75% in person; online 1.4% + 25p, non-UK cards 2.5% + 25p with no extra 1.5%", () => {
    expect(line(run(square, "uk"), "processing")).toBe(88); // 1.75% × £50 = 87.5p
    expect(line(run(square, "uk", { paymentType: "online" }), "processing")).toBe(95);
    const nonUk = run(square, "uk", { paymentType: "online", intlCard: true });
    expect(line(nonUk, "processing")).toBe(150);
    expect(nonUk.fees.some((l) => l.id === "intl")).toBe(false);
  });

  it("UK: invoices and keyed 2.5% plus 1.5% for non-UK cards; Clearpay 6% + 30p", () => {
    const r = run(square, "uk", { paymentType: "invoice_card", intlCard: true });
    expect(line(r, "processing")).toBe(125);
    expect(line(r, "intl")).toBe(75);
    expect(line(run(square, "uk", { price: 100, paymentType: "afterpay" }), "processing")).toBe(630);
  });

  it("Canada: credit 2.5%, Interac debit 0.75% + 7¢ (no international fee), online 2.8% + 30¢, keyed 3.3% + 15¢", () => {
    expect(line(run(square, "ca"), "processing")).toBe(125);
    const debit = run(square, "ca", { paymentType: "debit", intlCard: true });
    expect(line(debit, "processing")).toBe(45);
    expect(debit.fees.some((l) => l.id === "intl")).toBe(false);
    expect(line(run(square, "ca", { paymentType: "online" }), "processing")).toBe(170);
    expect(line(run(square, "ca", { paymentType: "keyed" }), "processing")).toBe(180);
    expect(line(run(square, "ca", { intlCard: true }), "intl")).toBe(75);
  });

  it("Australia: 1.6% (1.9% older accounts), 2.2% online, no international fee, Afterpay plus GST", () => {
    expect(line(run(square, "au"), "processing")).toBe(80);
    expect(line(run(square, "au", { auRate: "1.9" }), "processing")).toBe(95);
    expect(line(run(square, "au", { auRate: "1.9", paymentType: "online" }), "processing")).toBe(110);
    expect(run(square, "au", { intlCard: true }).fees.some((l) => l.id === "intl")).toBe(false);
    const ap = run(square, "au", { price: 100, paymentType: "afterpay" });
    expect(line(ap, "processing")).toBe(630);
    expect(line(ap, "gst")).toBe(63);
  });

  it("instant transfers cost 1.95% in every market", () => {
    for (const m of ["uk", "ca", "au"]) {
      const r = run(square, m, { payout: "instant" });
      expect(line(r, "instant")).toBe(Math.round((0.0195 * (5000 - line(r, "processing"))) as number));
    }
  });

  it("reverse mode finds the lowest price that pays the target", () => {
    const m = M.us;
    const inputs = square.defaults(m);
    const s = solvePrice(square, inputs, m, "payout", 2000);
    expect(s.price).not.toBeNull();
    expect(s.result!.payout).toBeGreaterThanOrEqual(2000);
    expect(square.calculate({ ...inputs, price: (s.price! - 1) / 100 }, m).payout).toBeLessThan(2000);
  });

  it("reverse mode across the ACH minimum and cap breakpoints", () => {
    const m = M.us;
    const inputs = { ...square.defaults(m), paymentType: "ach", plan: "plus" };
    expect(square.breakpoints!(inputs, m)).toEqual([10000, 100000]);
    for (const goal of [9800, 50000, 99000, 150000]) {
      const s = solvePrice(square, inputs, m, "payout", goal);
      expect(s.result!.payout).toBeGreaterThanOrEqual(goal);
      expect(square.calculate({ ...inputs, price: (s.price! - 1) / 100 }, m).payout).toBeLessThan(goal);
    }
    // Keep $98: the $1 minimum applies → charge $99.00
    expect(solvePrice(square, inputs, m, "payout", 9800).price).toBe(9900);
  });
});
