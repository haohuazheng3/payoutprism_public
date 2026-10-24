import { describe, expect, it } from "vitest";
import cashApp, { bankers, instantFee } from "@/fees/platforms/cash-app";
import { solvePrice } from "@/fees/solve";
import { M } from "@/fees/markets";
import { checkContract, line, run } from "./helpers";

describe("cash-app", () => {
  it("meets the module contract", () => {
    expect(checkContract(cashApp)).toEqual([]);
  });

  it("official example (TOS §XVIII.4): deposit $10 of paper money, $1 fee, $9 credited", () => {
    const r = run(cashApp, "us", { payType: "paper", amount: 10 });
    expect(line(r, "paper")).toBe(100);
    expect(r.payout).toBe(900);
    expect(r.warnings).toEqual([]);
  });

  it("banker's rounding: halves go to the even cent", () => {
    expect(bankers(250, 2.6)).toBe(6); // 6.5¢ → 6¢
    expect(bankers(750, 2.6)).toBe(20); // 19.5¢ → 20¢
    expect(bankers(50, 3)).toBe(2); // 1.5¢ → 2¢
    expect(bankers(150, 3)).toBe(4); // 4.5¢ → 4¢
    expect(bankers(9725, 2.5)).toBe(243); // 243.125¢
    expect(bankers(5148, 2.6)).toBe(134); // 133.848¢
  });

  it("default: $100 to a Business account costs 2.6% + $0.15 = $2.75 (research D1)", () => {
    const r = run(cashApp, "us");
    expect(line(r, "business")).toBe(275);
    expect(line(r, "deposit")).toBe(0);
    expect(r.totalFees).toBe(275);
    expect(r.payout).toBe(9725);
  });

  it("Business account: small and large payments (research D2, D3)", () => {
    expect(line(run(cashApp, "us", { amount: 10 }), "business")).toBe(41);
    expect(line(run(cashApp, "us", { amount: 5 }), "business")).toBe(28); // 13¢ + 15¢
    expect(line(run(cashApp, "us", { amount: 1 }), "business")).toBe(18); // 2.6¢ → 3¢ + 15¢
    const big = run(cashApp, "us", { amount: 1000 });
    expect(line(big, "business")).toBe(2615);
    expect(big.payout).toBe(97385);
  });

  it("Business account: half-cent cases round to even before the 15¢ (research D4) and say so", () => {
    const a = run(cashApp, "us", { amount: 2.5 });
    expect(line(a, "business")).toBe(21);
    expect(a.notes.some((n) => n.includes("half a cent"))).toBe(true);
    expect(line(run(cashApp, "us", { amount: 7.5 }), "business")).toBe(35);
    expect(run(cashApp, "us", { amount: 100 }).notes.some((n) => n.includes("half a cent"))).toBe(false);
  });

  it("Business account: shipping and sales tax are part of the payment, so they're charged too", () => {
    const r = run(cashApp, "us", { amount: 100, shipping: 5, salesTax: 8 });
    // 2.6% × $113.40 = 294.84¢ → 295¢, + 15¢
    expect(line(r, "business")).toBe(310);
    expect(r.buyerPays).toBe(11340);
    expect(r.saleAmount).toBe(10500);
    expect(r.payout).toBe(10500 - 310);
  });

  it("Tap to Pay: flat 3%, no fixed fee (research D5)", () => {
    const r = run(cashApp, "us", { payType: "tap", amount: 45 });
    expect(line(r, "tap")).toBe(135);
    expect(r.payout).toBe(4365);
  });

  it("personal payment: free to receive; a credit-card sender pays 3% on top (research D9)", () => {
    const r = run(cashApp, "us", { payType: "personal", amount: 200, cardSender: true });
    expect(r.totalFees).toBe(0);
    expect(r.payout).toBe(20000);
    expect(r.buyerFees.find((l) => l.id === "sender-card")!.amount).toBe(600);
    expect(r.buyerPays).toBe(20600);
    expect(run(cashApp, "us", { payType: "personal", amount: 200 }).buyerFees).toEqual([]);
  });

  it("Earn in P2P pilot: no fee", () => {
    const r = run(cashApp, "us", { payType: "earn", amount: 100 });
    expect(line(r, "earn")).toBe(0);
    expect(r.payout).toBe(10000);
  });

  it("instant deposit after a Business payment is charged on what's left in the balance", () => {
    const r = run(cashApp, "us", { cashOut: "instant" });
    expect(line(r, "instant")).toBe(243); // 2.5% × $97.25
    expect(r.payout).toBe(10000 - 275 - 243);
    expect(r.notes[0]).toContain("$0.49 to $2.43");
  });

  it("cashing out $200 instantly costs $1.00–$5.00 (research D6)", () => {
    expect(line(run(cashApp, "us", { payType: "transfer", amount: 200, cashOut: "instant" }), "instant")).toBe(500);
    expect(line(run(cashApp, "us", { payType: "transfer", amount: 200, cashOut: "instant", instantRate: 0.5, instantMin: 0.25 }), "instant")).toBe(100);
    const std = run(cashApp, "us", { payType: "transfer", amount: 200 });
    expect(std.totalFees).toBe(0);
    expect(std.payout).toBe(20000);
  });

  it("instant minimum: $1 at 2.5% below $40, $0.25 at 0.5% below $50 (research D7)", () => {
    expect(instantFee(2000, 2.5, 100)).toBe(100);
    expect(instantFee(2000, 0.5, 25)).toBe(25);
    expect(instantFee(3900, 2.5, 100)).toBe(100); // 97.5¢ → minimum
    expect(instantFee(4000, 2.5, 100)).toBe(100); // at the edge
    expect(instantFee(4040, 2.5, 100)).toBe(101);
    expect(instantFee(4999, 0.5, 25)).toBe(25); // 24.995¢ → 25¢
    expect(instantFee(5100, 0.5, 25)).toBe(26); // 25.5¢ → 26¢ (even)
  });

  it("instant maximum: $75 from $3,000 at 2.5% (research D8)", () => {
    const at = (amount: number) => line(run(cashApp, "us", { payType: "transfer", amount, cashOut: "instant" }), "instant");
    expect(at(2999)).toBe(7498); // 7497.5¢ → 7498¢
    expect(at(3000)).toBe(7500);
    expect(at(4000)).toBe(7500);
    expect(instantFee(1_500_000, 0.5, 25)).toBe(7500);
    expect(instantFee(1_499_900, 0.5, 25)).toBe(7500); // 7499.5¢ → 7500¢ (even)
  });

  it("instant rate and minimum are held inside Cash App's published range", () => {
    expect(line(run(cashApp, "us", { payType: "transfer", amount: 100, cashOut: "instant", instantRate: 5 }), "instant")).toBe(250);
    expect(line(run(cashApp, "us", { payType: "transfer", amount: 100, cashOut: "instant", instantRate: 1.75, instantMin: 0.25 }), "instant")).toBe(175);
    expect(line(run(cashApp, "us", { payType: "transfer", amount: 5, cashOut: "instant", instantRate: 0.5, instantMin: 0 }), "instant")).toBe(25);
  });

  it("paper money deposits: $5 to $500 each", () => {
    expect(run(cashApp, "us", { payType: "paper", amount: 4.99 }).warnings.length).toBe(1);
    expect(run(cashApp, "us", { payType: "paper", amount: 5 }).warnings).toEqual([]);
    expect(run(cashApp, "us", { payType: "paper", amount: 500 }).warnings).toEqual([]);
    expect(run(cashApp, "us", { payType: "paper", amount: 500.01 }).warnings.length).toBe(1);
    expect(run(cashApp, "us", { payType: "paper", amount: 500 }).payout).toBe(49900);
  });

  it("Cash App Pay through Square and Stripe uses the processor's rate", () => {
    expect(line(run(cashApp, "us", { payType: "capSquareCp", amount: 50 }), "processing")).toBe(145);
    expect(line(run(cashApp, "us", { payType: "capSquareCp", amount: 50, squarePlan: "premium" }), "processing")).toBe(135);
    expect(line(run(cashApp, "us", { payType: "capSquareOnline", amount: 50 }), "processing")).toBe(195);
    expect(line(run(cashApp, "us", { payType: "capSquareOnline", amount: 50, squarePlan: "plus" }), "processing")).toBe(175);
    const stripe = run(cashApp, "us", { payType: "capStripe", amount: 50, cashOut: "instant" });
    expect(line(stripe, "processing")).toBe(175);
    expect(stripe.fees.some((l) => l.id === "instant")).toBe(false);
  });

  it("reverse mode: $51.49 nets $50 in a Business account (research D12)", () => {
    const m = M.us;
    const inputs = cashApp.defaults(m);
    const s = solvePrice(cashApp, inputs, m, "payout", 5000);
    expect(s.price).toBe(5149);
    expect(s.result!.payout).toBe(5000);
    expect(cashApp.calculate({ ...inputs, amount: 51.48 }, m).payout).toBeLessThan(5000);
  });

  it("reverse mode with an instant deposit, across the minimum-fee edge", () => {
    const m = M.us;
    const inputs = { ...cashApp.defaults(m), cashOut: "instant" };
    const bps = cashApp.breakpoints!(inputs, m);
    expect(bps.length).toBe(2);
    for (const goal of [3800, 3900, 3950, 100_000]) {
      const s = solvePrice(cashApp, inputs, m, "payout", goal);
      expect(s.price).not.toBeNull();
      expect(s.result!.payout).toBeGreaterThanOrEqual(goal);
      expect(cashApp.calculate({ ...inputs, amount: (s.price! - 1) / 100 }, m).payout).toBeLessThan(goal);
    }
  });

  // Independent review (2026-10-23): values worked by hand from the official rates, with
  // banker's rounding (TOS fee-table footnote; Business Terms §6).
  it("review: instant fee edges at the top rate, one cent apart", () => {
    const at = (amount: number) => line(run(cashApp, "us", { payType: "transfer", amount, cashOut: "instant" }), "instant");
    expect(at(40.2)).toBe(100); // 2.5% × $40.20 = 100.5¢ → 100¢ (even) = the $1 minimum
    expect(at(40.21)).toBe(101); // 100.525¢ → 101¢
    expect(at(2999.79)).toBe(7499); // 7,499.475¢ → $74.99, just under the cap
    expect(at(2999.99)).toBe(7500); // 7,499.975¢ → $75.00
    expect(at(3000.01)).toBe(7500); // capped
  });

  it("review: shipping and 8.25% sales tax in a Business payment", () => {
    // tax = 8.25% × $110.00 = $9.075 → $9.08; customer sends $119.08
    // fee = 2.6% × $119.08 = 309.608¢ → 310¢, + 15¢ = $3.25
    const r = run(cashApp, "us", { amount: 100, shipping: 10, salesTax: 8.25 });
    expect(r.buyerPays).toBe(11908);
    expect(line(r, "business")).toBe(325);
    expect(r.payout).toBe(11000 - 325);
  });

  it("review: Business payment then an instant deposit, below and above the $75 cap", () => {
    // $1,000: fee $26.15, balance $973.85, 2.5% = 2,434.625¢ → $24.35
    const a = run(cashApp, "us", { amount: 1000, cashOut: "instant" });
    expect(line(a, "instant")).toBe(2435);
    expect(a.payout).toBe(100000 - 2615 - 2435);
    // $5,000: fee $130.15, balance $4,869.85, 2.5% = $121.75 → capped at $75
    const b = run(cashApp, "us", { amount: 5000, cashOut: "instant" });
    expect(line(b, "business")).toBe(13015);
    expect(line(b, "instant")).toBe(7500);
    expect(b.payout).toBe(500000 - 13015 - 7500);
    expect(b.fees.find((l) => l.id === "instant")!.detail).toContain("capped at $75.00");
  });

  it("review: half-cent 3% fees round to the even cent", () => {
    expect(line(run(cashApp, "us", { payType: "tap", amount: 1.5 }), "tap")).toBe(4); // 4.5¢ → 4¢
    expect(line(run(cashApp, "us", { payType: "tap", amount: 0.5 }), "tap")).toBe(2); // 1.5¢ → 2¢
    expect(run(cashApp, "us", { payType: "personal", amount: 0.5, cardSender: true }).buyerPays).toBe(52); // 50¢ + 2¢
  });

  it("review: a payment too small to leave a balance has no instant fee", () => {
    const r = run(cashApp, "us", { amount: 0.1, cashOut: "instant" }); // 0.26¢ → 0¢ + 15¢ > 10¢
    expect(line(r, "instant")).toBe(0);
    expect(r.fees.find((l) => l.id === "instant")!.detail).toBe("Nothing left to move");
    expect(r.warnings.length).toBe(1);
  });

  it("review: reverse mode returns the exact minimum found by brute force", () => {
    const m = M.us;
    const biz = cashApp.defaults(m);
    const inst = { ...biz, cashOut: "instant" };
    const tr = { ...inst, payType: "transfer" };
    const cases: [typeof biz, number, number][] = [
      [biz, 100000, 102685], // 2.6% × $1,026.85 = 2,669.81¢ → $26.70 + 15¢ → $1,000.00
      [inst, 3800, 4019], // fee $1.19, balance $39.00, $1 minimum → $38.00
      [inst, 3950, 4175], // fee $1.24, balance $40.51, 2.5% = 101.275¢ → $1.01 → $39.50
      [inst, 10000, 10545], // fee $2.89, balance $102.56, $2.56 → $100.00
      [inst, 292500, 308024], // fee $80.24, balance $3,000.00, $75 cap → $2,925.00
      [inst, 293000, 308537], // past the cap edge
      [tr, 292500, 300000], // $3,000 − $75
      [tr, 3900, 4000], // $40 − $1 minimum
    ];
    for (const [inputs, goal, want] of cases) {
      const s = solvePrice(cashApp, inputs, m, "payout", goal);
      expect(s.price).toBe(want);
      expect(s.result!.payout).toBeGreaterThanOrEqual(goal);
      expect(cashApp.calculate({ ...inputs, amount: (want - 1) / 100 }, m).payout).toBeLessThan(goal);
    }
  });
});
