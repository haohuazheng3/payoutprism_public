import { describe, expect, it } from "vitest";
import gumroad, { chargeFees, partnerCredit, payoutFee, splitInstallments } from "@/fees/platforms/gumroad";
import { solvePrice } from "@/fees/solve";
import { pickMarket } from "@/fees/markets";
import type { Inputs } from "@/fees/types";
import { checkContract, line, run } from "./helpers";

const m = pickMarket(gumroad.markets, "us", "us");

describe("gumroad", () => {
  it("meets the module contract", () => {
    expect(checkContract(gumroad)).toEqual([]);
  });

  /* ---------- Official examples ---------- */

  it("affiliate on 30% pays 30% of the fees (help article 66 / 333)", () => {
    const r = run(gumroad, "us", { price: 100, partner: "own", partnerPct: 30 });
    const fees = line(r, "gumroad") + line(r, "processing");
    expect(fees).toBe(1370);
    // 30% × $100 − 30% × $13.70 = $30.00 − $4.11, rounded down
    expect(line(r, "partner")).toBe(2589);
    expect(r.payout).toBe(10000 - 1370 - 2589);
  });

  it("collaborator on 25% has 25% of the fees taken from their share (help article 341)", () => {
    const r = run(gumroad, "us", { price: 100, partner: "collab", partnerPct: 25 });
    expect(line(r, "partner")).toBe(Math.floor(2500 - 0.25 * 1370)); // 2157
    expect(r.payout).toBe(10000 - 1370 - 2157);
  });

  it("collaborator shipping stays with the creator", () => {
    const r = run(gumroad, "us", { price: 40, shipping: 10, partner: "collab", partnerPct: 50 });
    const fees = line(r, "gumroad") + line(r, "processing"); // on $50
    expect(fees).toBe(Math.round(5000 * 0.129) + 80);
    expect(line(r, "partner")).toBe(Math.floor(0.5 * 4000 - 0.5 * fees));
  });

  it("installments: $100 in 3 is $33.34 + $33.33 + $33.33, each charged full fees (help article 346)", () => {
    expect(splitInstallments(10000, 3)).toEqual([3334, 3333, 3333]);
    const r = run(gumroad, "us", { price: 100, installments: 3 });
    expect(line(r, "gumroad") + line(r, "processing")).toBe(3 * 510); // research D9: 3 × $5.10
    const once = run(gumroad, "us", { price: 100 });
    expect(r.totalFees - once.totalFees).toBe(160); // two extra $0.80 fixed fees
  });

  it("Gumroad Affiliate: $10 sale at a 10% payout rate is a $1 Affiliate Fee before the fee share (Terms §6)", () => {
    const r = run(gumroad, "us", { price: 10, partner: "gumroad" });
    const fees = line(r, "gumroad") + line(r, "processing");
    expect(fees).toBe(209);
    expect(r.fees.find((l) => l.id === "partner")!.detail).toContain("10% × $10.00");
    expect(line(r, "partner")).toBe(Math.floor(100 - 0.1 * 209)); // 79
  });

  it("free products pay no fee (help article 133)", () => {
    const r = run(gumroad, "us", { price: 0 });
    expect(r.totalFees).toBe(0);
    expect(r.payout).toBe(0);
  });

  /* ---------- Derived examples (research §6.2) ---------- */

  it("D1: $10 direct sale costs $2.09 (12.9% + $0.80), split into Gumroad and processing lines", () => {
    const r = run(gumroad, "us", { price: 10 });
    expect(line(r, "gumroad")).toBe(150); // 10% + $0.50
    expect(line(r, "processing")).toBe(59); // 2.9% + $0.30
    expect(r.totalFees).toBe(209);
    expect(r.payout).toBe(791);
  });

  it("D2 / default: $50 and $25 direct sales", () => {
    expect(run(gumroad, "us", { price: 50 }).totalFees).toBe(725);
    const d = run(gumroad, "us");
    expect(d.totalFees).toBe(Math.round(2500 * 0.129) + 80); // 323 + 80 = 403
    expect(d.payout).toBe(2097);
    expect(line(d, "payout")).toBe(0); // bank payout, no fee
  });

  it("D3: $50 Discover sale is a flat 30%, processing included, no fixed fee", () => {
    const r = run(gumroad, "us", { price: 50, source: "discover" });
    expect(line(r, "discover")).toBe(1500);
    expect(line(r, "processing")).toBe(0);
    expect(r.totalFees).toBe(1500);
    expect(r.payout).toBe(3500);
  });

  it("D4: $1.15 direct sale rounds 14.835¢ half away from zero once, then adds $0.80", () => {
    const r = run(gumroad, "us", { price: 1.15 });
    expect(r.totalFees).toBe(95);
    expect(r.payout).toBe(20);
  });

  it("D5: VAT is added on top for the buyer and never touches the fees", () => {
    const r = run(gumroad, "us", { price: 100, taxRate: 20 });
    expect(r.buyerPays).toBe(12000);
    expect(r.buyerFees.find((l) => l.id === "tax")!.amount).toBe(2000);
    expect(r.totalFees).toBe(1370);
    expect(r.payout).toBe(8630);
  });

  it("D7: high-volume rate is 5% + $0.50 plus processing on direct sales only", () => {
    const r = run(gumroad, "us", { price: 100, highVolume: true });
    expect(line(r, "gumroad")).toBe(550);
    expect(r.totalFees).toBe(870);
    const disc = run(gumroad, "us", { price: 100, highVolume: true, source: "discover" });
    expect(disc.totalFees).toBe(3000);
  });

  it("D8: connected Stripe/PayPal account pays only Gumroad's part", () => {
    const r = run(gumroad, "us", { price: 50, connected: true });
    expect(line(r, "gumroad")).toBe(550);
    expect(r.fees.some((l) => l.id === "processing")).toBe(false);
    const disc = run(gumroad, "us", { price: 50, connected: true, source: "discover" });
    expect(disc.totalFees).toBe(1500);
  });

  it("D10 / D11: PayPal payouts take 2% rounded up; instant payouts send balance ÷ 1.03", () => {
    expect(payoutFee(100000, "paypal")).toBe(2000);
    expect(payoutFee(103000, "instant")).toBe(3000);
    expect(payoutFee(4275, "paypal")).toBe(86); // 85.5 → rounded up
    expect(payoutFee(5000, "bank")).toBe(0);
    const r = run(gumroad, "us", { price: 25, payout: "instant" });
    expect(line(r, "payout")).toBe(2097 - Math.floor((2097 * 100) / 103));
    const p = run(gumroad, "us", { price: 25, payout: "paypal" });
    expect(line(p, "payout")).toBe(42); // 2% × $20.97 = 41.94 → 42
    expect(p.payout).toBe(2097 - 42);
  });

  it("helpers: combined rounding and partner credit floor", () => {
    expect(chargeFees(1000, "direct")).toEqual({ gumroad: 150, processing: 59 });
    expect(chargeFees(0, "direct")).toEqual({ gumroad: 0, processing: 0 });
    expect(partnerCredit(10000, 1370, 30)).toBe(2589);
    expect(partnerCredit(50, 87, 30)).toBe(0); // fees larger than the price never make the credit negative
  });

  it("clamps affiliate and collaborator cuts to Gumroad's limits with a warning", () => {
    const own = run(gumroad, "us", { price: 100, partner: "own", partnerPct: 90 });
    expect(own.fees.find((l) => l.id === "partner")!.label).toContain("75%");
    expect(own.warnings.length).toBe(1);
    const col = run(gumroad, "us", { price: 100, partner: "collab", partnerPct: 60 });
    expect(line(col, "partner")).toBe(Math.floor(5000 - 0.5 * 1370));
  });

  it("shipping is part of the fee base and turns installments off", () => {
    const r = run(gumroad, "us", { price: 30, shipping: 5, installments: 3 });
    expect(r.saleAmount).toBe(3500);
    expect(r.totalFees).toBe(Math.round(3500 * 0.129) + 80);
  });

  /* ---------- Reverse mode ---------- */

  it("reverse mode finds the lowest price that pays the target", () => {
    const cases: Partial<Inputs>[] = [{}, { source: "discover" }, { partner: "own", partnerPct: 30, payout: "paypal" }];
    for (const extra of cases) {
      const inputs = { ...gumroad.defaults(m), ...extra } as Inputs;
      const s = solvePrice(gumroad, inputs, m, "payout", 2000);
      expect(s.price).not.toBeNull();
      expect(s.result!.payout).toBeGreaterThanOrEqual(2000);
      const below = gumroad.calculate({ ...inputs, price: (s.price! - 1) / 100 }, m);
      expect(below.payout).toBeLessThan(2000);
    }
  });
});
