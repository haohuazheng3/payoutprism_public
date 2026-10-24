import { describe, expect, it } from "vitest";
import fiverr from "@/fees/platforms/fiverr";
import { solvePrice } from "@/fees/solve";
import { pickMarket } from "@/fees/markets";
import type { Result } from "@/fees/types";
import { checkContract, line, run } from "./helpers";

const buyer = (r: Result, id: string) => r.buyerFees.find((x) => x.id === id)?.amount ?? 0;
const has = (r: Result, id: string) => r.fees.some((l) => l.id === id);
const market = (id: string) => pickMarket(fiverr.markets, id, fiverr.defaultMarket);

describe("fiverr", () => {
  it("meets the module contract in every market", () => {
    expect(checkContract(fiverr)).toEqual([]);
  });

  it("every market is a US-dollar market (Fiverr balances are always in USD)", () => {
    for (const m of fiverr.markets) expect(m.currency).toBe("USD");
  });

  /* ---------------- official worked example ---------------- */

  it("Fiverr Pro help article: a $1000 Gig pays $800 for a completed order", () => {
    const r = run(fiverr, "us", { price: 1000 });
    expect(line(r, "commission")).toBe(20000);
    expect(line(r, "withdrawal")).toBe(0); // PayPal is free
    expect(r.payout).toBe(80000);
  });

  /* ---------------- derived examples (research file, section 6) ---------------- */

  it("default: $100 order → seller keeps $80.00; buyer pays $100 + $5.50 + $3.50 = $109.00", () => {
    const r = run(fiverr, "us");
    expect(r.saleAmount).toBe(10000);
    expect(r.payout).toBe(8000);
    expect(buyer(r, "service")).toBe(550);
    expect(buyer(r, "small-order")).toBe(350);
    expect(r.buyerPays).toBe(10900);
  });

  it("D1: a $10 Gig → buyer pays $14.05, seller gets $8.00", () => {
    const r = run(fiverr, "us", { price: 10 });
    expect(buyer(r, "service")).toBe(55);
    expect(buyer(r, "small-order")).toBe(350);
    expect(r.buyerPays).toBe(1405);
    expect(r.payout).toBe(800);
  });

  it("D2: the $200 edge — $199.99 pays the small order fee ($214.49), $200.00 doesn't ($211.00)", () => {
    const below = run(fiverr, "us", { price: 199.99 });
    expect(buyer(below, "service")).toBe(1100); // 10.99945 → 11.00
    expect(buyer(below, "small-order")).toBe(350);
    expect(below.buyerPays).toBe(21449);
    expect(below.payout).toBe(15999); // 159.992 → 159.99
    const at = run(fiverr, "us", { price: 200 });
    expect(buyer(at, "small-order")).toBe(0);
    expect(at.buyerFees.some((l) => l.id === "small-order")).toBe(false);
    expect(at.buyerPays).toBe(21100);
    expect(at.payout).toBe(16000);
    expect(below.notes.some((n) => n.includes("$211.00") && n.includes("$214.49"))).toBe(true);
  });

  it("D3: hourly $30 × 10 h → client pays $5 once + $316.50; freelancer gets $240, $237 via Payoneer local bank", () => {
    const r = run(fiverr, "intl", { billing: "hourly", price: 30, hours: 10 });
    expect(r.saleAmount).toBe(30000);
    expect(line(r, "commission")).toBe(6000);
    expect(buyer(r, "service")).toBe(1650);
    expect(buyer(r, "initiation")).toBe(500);
    expect(buyer(r, "small-order")).toBe(0); // no small order fee on hourly contracts
    expect(r.buyerPays).toBe(30000 + 1650 + 500);
    expect(line(r, "withdrawal")).toBe(300);
    expect(r.payout).toBe(23700);
    expect(has(run(fiverr, "us", { billing: "hourly", earlyPayout: true }), "early-payout")).toBe(false); // hourly can't use Early Payout
  });

  it("D4: a $20 tip on a $100 order → seller keeps $16 of it; the tip carries its own service fee", () => {
    const r = run(fiverr, "us", { tip: 20 });
    expect(line(r, "tip-commission")).toBe(400);
    expect(r.payout).toBe(8000 + 1600);
    expect(buyer(r, "tip-service")).toBe(110 + 350); // 5.5% + $3.50 (payment under $200)
    expect(r.buyerPays).toBe(10900 + 2000 + 460);
  });

  it("D6: Early Payout on a $500 order → 1% of the $400 earned = $4.00, $396.00 left", () => {
    const r = run(fiverr, "us", { price: 500, earlyPayout: true });
    expect(line(r, "early-payout")).toBe(400);
    expect(r.payout).toBe(39600);
  });

  /* ---------------- further derived checks ---------------- */

  it("seller coupons: the 20% is charged on the discounted price (10% off $100 → $72.00)", () => {
    const r = run(fiverr, "us", { discount: 10 });
    expect(r.saleAmount).toBe(9000);
    expect(line(r, "commission")).toBe(1800);
    expect(r.payout).toBe(7200);
    expect(buyer(r, "service")).toBe(495);
  });

  it("extras bought mid-order: 20% again, and a second service fee for the buyer", () => {
    const r = run(fiverr, "us", { extras: 30 });
    expect(line(r, "extras-commission")).toBe(600);
    expect(r.payout).toBe(8000 + 2400);
    expect(buyer(r, "extras-service")).toBe(165 + 350);
  });

  it("other countries: Payoneer local bank transfer $3, USD transfer $1, Payoneer account $3", () => {
    expect(run(fiverr, "intl").payout).toBe(7700);
    expect(line(run(fiverr, "intl", { withdraw: "usdbank" }), "withdrawal")).toBe(100);
    expect(line(run(fiverr, "intl", { withdraw: "payoneer" }), "withdrawal")).toBe(300);
    expect(line(run(fiverr, "intl", { withdraw: "card2h" }), "withdrawal")).toBe(300);
    expect(has(run(fiverr, "intl", { withdraw: "none" }), "withdrawal")).toBe(false);
  });

  it("US: direct deposit via Payoneer $1, Revenue Card $1 (2 days) / $3 (2 hours)", () => {
    expect(line(run(fiverr, "us", { withdraw: "ach" }), "withdrawal")).toBe(100);
    expect(line(run(fiverr, "us", { withdraw: "card2d" }), "withdrawal")).toBe(100);
    expect(line(run(fiverr, "us", { withdraw: "card2h" }), "withdrawal")).toBe(300);
  });

  it("India: 0.5% GST TCS + 0.1% TDS on the full $100 (5% TDS without a PAN); no Revenue Card", () => {
    const r = run(fiverr, "in");
    expect(line(r, "tcs")).toBe(50);
    expect(line(r, "tds")).toBe(10);
    expect(line(r, "withdrawal")).toBe(300);
    expect(r.payout).toBe(10000 - 2000 - 50 - 10 - 300);
    expect(line(run(fiverr, "in", { pan: false }), "tds")).toBe(500);
    expect(has(run(fiverr, "in", { tcs: false }), "tcs")).toBe(false);
    const opts = fiverr.fields.find((f) => f.id === "withdraw")!;
    const list = opts.kind === "select" && typeof opts.options === "function" ? opts.options({}, market("in")) : [];
    expect(list.some((o) => o.value.startsWith("card"))).toBe(false);
  });

  it("withdrawals are capped at $5,000: one cent over takes a second withdrawal fee", () => {
    // $6,250.00 order → $5,000.00 balance → one withdrawal; $6,250.01 → $5,000.01 → two.
    const one = run(fiverr, "intl", { price: 6250 });
    expect(line(one, "withdrawal")).toBe(300);
    const two = run(fiverr, "intl", { price: 6250.01 });
    expect(line(two, "withdrawal")).toBe(600);
    expect(two.payout).toBeLessThan(one.payout);
  });

  it("warns about Fiverr's minimums: $5 Gig, $7.25/h, $5 tip, 30% coupon", () => {
    expect(run(fiverr, "us", { price: 4.99 }).warnings.length).toBeGreaterThan(0);
    expect(run(fiverr, "us", { price: 5 }).warnings).toEqual([]);
    expect(run(fiverr, "us", { billing: "hourly", price: 7.24 }).warnings.length).toBeGreaterThan(0);
    expect(run(fiverr, "us", { billing: "hourly", price: 7.25 }).warnings).toEqual([]);
    expect(run(fiverr, "us", { tip: 4.99 }).warnings.length).toBeGreaterThan(0);
    expect(run(fiverr, "us", { discount: 35 }).warnings.length).toBeGreaterThan(0);
  });

  it("notes when the balance is under the withdrawal minimum ($20 for bank transfers)", () => {
    expect(run(fiverr, "intl", { price: 20 }).notes.some((n) => n.includes("$20.00"))).toBe(true);
    expect(run(fiverr, "intl", { price: 25 }).notes.some((n) => n.includes("start at"))).toBe(false);
  });

  /* ---------------- reverse mode ---------------- */

  it("reverse: to receive $100 charge $125 (PayPal) or $128.75 (Payoneer local bank)", () => {
    for (const [id, want] of [
      ["us", 12500],
      ["intl", 12875],
    ] as const) {
      const m = market(id);
      const inputs = fiverr.defaults(m);
      const s = solvePrice(fiverr, inputs, m, "payout", 10000);
      expect(s.price).toBe(want);
      expect(s.result!.payout).toBeGreaterThanOrEqual(10000);
      expect(fiverr.calculate({ ...inputs, price: (s.price! - 1) / 100 }, m).payout).toBeLessThan(10000);
    }
  });

  it("reverse: finds the lowest price across the $5,000 withdrawal breakpoint", () => {
    const m = market("intl");
    const inputs = fiverr.defaults(m);
    expect(fiverr.breakpoints!(inputs, m)).toContain(625001);
    // $4,997.01 needs a balance of $5,003.01 after two $3 fees → price $6,253.76 (not $6,250.01).
    const goal = 499701;
    const s = solvePrice(fiverr, inputs, m, "payout", goal);
    expect(s.result!.payout).toBeGreaterThanOrEqual(goal);
    expect(fiverr.calculate({ ...inputs, price: (s.price! - 1) / 100 }, m).payout).toBeLessThan(goal);
    expect(s.price).toBe(625376);
  });
});
