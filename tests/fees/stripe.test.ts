import { afterEach, describe, expect, it, vi } from "vitest";
import stripe, { auIntlRate, radarTrialActive } from "@/fees/platforms/stripe";
import { solvePrice } from "@/fees/solve";
import { M } from "@/fees/markets";
import { checkContract, line, run } from "./helpers";

const sum = (r: ReturnType<typeof run>, ids: string[]) => ids.reduce((s, id) => s + (r.fees.find((l) => l.id === id)?.amount ?? 0), 0);

describe("stripe", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("meets the module contract in every market", () => {
    expect(checkContract(stripe)).toEqual([]);
  });

  /* ---------------- official examples (research §6.1) ---------------- */

  it("E1 (dispute partly won): $200 disputed, $50 returned, both $15 fees kept → $180 lost to the dispute", () => {
    const r = run(stripe, "us", { price: 200, dispute: "partial", disputeWon: 50 });
    expect(line(r, "disputeFee")).toBe(1500);
    expect(line(r, "disputeCountered")).toBe(1500);
    expect(line(r, "disputeReversal")).toBe(15000);
    expect(sum(r, ["disputeFee", "disputeCountered", "disputeReversal"])).toBe(18000);
  });

  it("E2 (rounding): each fee rounds to the cent, half up: 0.025 → 0.03, 0.024 → 0.02", () => {
    // Invoicing Starter 0.4%: $6.25 → 2.5¢, $6.00 → 2.4¢
    expect(line(run(stripe, "us", { price: 6.25, product: "invoice" }), "invoicing")).toBe(3);
    expect(line(run(stripe, "us", { price: 6, product: "invoice" }), "invoicing")).toBe(2);
    // 2.9% × $5.00 = 14.5¢ → 15¢, + 30¢
    expect(line(run(stripe, "us", { price: 5 }), "processing")).toBe(45);
  });

  it("E4 (Tax API): $0.50 per transaction, so 1,000 transactions cost $500", () => {
    const r = run(stripe, "us", { stripeTax: "api" });
    expect(line(r, "stripeTax")).toBe(50);
    expect(line(r, "stripeTax") * 1000).toBe(50000);
  });

  it("E5 (manual entry vs alternatives): 3.4% + 30¢ keyed, 2.9% + 30¢ Payment Link, 3.3% + 30¢ invoice, 2.7% + 5¢ Terminal (US and Canada)", () => {
    for (const m of ["us", "ca"]) {
      expect(line(run(stripe, m, { method: "manual" }), "processing")).toBe(340 + 30);
      expect(line(run(stripe, m), "processing")).toBe(290 + 30);
      const inv = run(stripe, m, { product: "invoice" });
      expect(sum(inv, ["processing", "invoicing"])).toBe(330 + 30);
      expect(line(run(stripe, m, { method: "terminal" }), "processing")).toBe(270 + 5);
    }
  });

  /* ---------------- derived examples (research §6.2) ---------------- */

  it("D1/D2: US domestic card $100 → $3.20; $10.25 → $0.60", () => {
    const r = run(stripe, "us");
    expect(line(r, "processing")).toBe(320);
    expect(r.payout).toBe(9680);
    expect(line(run(stripe, "us", { price: 10.25 }), "processing")).toBe(60);
  });

  it("D3: international card + currency conversion on $100 → $4.70 + $1.00", () => {
    const r = run(stripe, "us", { cardFrom: "international", fx: true });
    expect(line(r, "processing")).toBe(470);
    expect(line(r, "fx")).toBe(100);
    expect(r.totalFees).toBe(570);
  });

  it("D4: manually entered $250 → $8.80; keyed international card stacks to 4.9%", () => {
    expect(line(run(stripe, "us", { method: "manual", price: 250 }), "processing")).toBe(880);
    expect(line(run(stripe, "us", { method: "manual", cardFrom: "international" }), "processing")).toBe(490 + 30);
  });

  it("D5: ACH Direct Debit 0.8% capped at $5 (cap reached at $625)", () => {
    expect(line(run(stripe, "us", { method: "ach", price: 400 }), "processing")).toBe(320);
    expect(line(run(stripe, "us", { method: "ach", price: 624.37 }), "processing")).toBe(499);
    expect(line(run(stripe, "us", { method: "ach", price: 625 }), "processing")).toBe(500);
    expect(line(run(stripe, "us", { method: "ach", price: 1000 }), "processing")).toBe(500);
    // USD bank transfer: 0.5%, capped at $5 from $1,000
    expect(line(run(stripe, "us", { method: "bank_transfer", price: 999 }), "processing")).toBe(500);
    expect(line(run(stripe, "us", { method: "bank_transfer", price: 998.99 }), "processing")).toBe(499);
    expect(line(run(stripe, "us", { method: "bank_transfer", price: 5000 }), "processing")).toBe(500);
  });

  it("D6: to keep $100 on a US card you charge $103.30", () => {
    const m = M.us;
    const inputs = stripe.defaults(m);
    const s = solvePrice(stripe, inputs, m, "payout", 10000);
    expect(s.price).toBe(10330);
    expect(s.result!.payout).toBeGreaterThanOrEqual(10000);
    expect(stripe.calculate({ ...inputs, price: 103.29 }, m).payout).toBeLessThan(10000);
  });

  it("D7: Instant Payout 1.5%, minimum $0.50, on the amount paid out", () => {
    // $20.91 card payment nets $20.00 → 1.5% = $0.30 → $0.50 minimum
    const small = run(stripe, "us", { price: 20.91, instantPayout: true });
    expect(small.saleAmount - line(small, "processing")).toBe(2000);
    expect(line(small, "instantPayout")).toBe(50);
    // $1,030.18 nets $1,000.00 → $15.00
    const big = run(stripe, "us", { price: 1030.18, instantPayout: true });
    expect(big.saleAmount - line(big, "processing")).toBe(100000);
    expect(line(big, "instantPayout")).toBe(1500);
    // UK 1%, minimum 40p
    const uk = run(stripe, "uk", { price: 10, instantPayout: true });
    expect(line(uk, "instantPayout")).toBe(40);
  });

  it("D8: $50 subscription with Billing (0.7%) and Radar Standard → $2.10 / $2.15", () => {
    const r = run(stripe, "us", { price: 50, product: "billing" });
    expect(r.totalFees).toBe(210);
    const withRadar = run(stripe, "us", { price: 50, product: "billing", radar: "standard" });
    expect(line(withRadar, "radar")).toBe(5);
    expect(withRadar.totalFees).toBe(215);
  });

  it("D9: $1,000 one-off invoice on Invoicing Starter → $29.30 + $4.00", () => {
    const r = run(stripe, "us", { price: 1000, product: "invoice" });
    expect(line(r, "processing")).toBe(2930);
    expect(line(r, "invoicing")).toBe(400);
    expect(line(run(stripe, "us", { price: 1000, product: "invoice_plus" }), "invoicing")).toBe(500);
  });

  it("D10: Stripe Tax no-code is 0.5% of the total incl. tax ($108 → $0.54), card fee $3.43; tax split out as a cost", () => {
    const r = run(stripe, "us", { price: 108, stripeTax: "nocode", salesTax: 8 });
    expect(line(r, "stripeTax")).toBe(54);
    expect(line(r, "processing")).toBe(343);
    expect(r.costs.find((c) => c.id === "salesTax")?.amount).toBe(800);
    expect(r.profit).toBe(10800 - 397 - 800);
  });

  it("D11: UK £100 standard / premium / EEA / international + conversion → £1.70 / £3.00 / £2.70 / £5.35", () => {
    expect(line(run(stripe, "uk"), "processing")).toBe(170);
    expect(line(run(stripe, "uk", { cardUk: "premium" }), "processing")).toBe(300);
    expect(line(run(stripe, "uk", { cardUk: "eea" }), "processing")).toBe(270);
    expect(run(stripe, "uk", { cardUk: "intl", fx: true }).totalFees).toBe(535);
  });

  it("D12: Australia A$100 domestic A$1.95; international A$3.80 now, A$3.10 from April 1, 2027", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-23T12:00:00Z"));
    expect(line(run(stripe, "au"), "processing")).toBe(195);
    expect(line(run(stripe, "au", { cardFrom: "international" }), "processing")).toBe(380);
    expect(line(run(stripe, "au", { method: "terminal", cardFrom: "international" }), "processing")).toBe(360);
    vi.setSystemTime(new Date("2027-04-01T00:00:00+11:00"));
    expect(line(run(stripe, "au", { cardFrom: "international" }), "processing")).toBe(310);
    expect(line(run(stripe, "au", { method: "terminal", cardFrom: "international" }), "processing")).toBe(290);
  });

  it("AU international rate switches at midnight Sydney time on April 1, 2027", () => {
    expect(auIntlRate(Date.parse("2027-03-31T23:59:00+11:00"))).toBe(3.5);
    expect(auIntlRate(Date.parse("2027-04-01T00:00:00+11:00"))).toBe(2.8);
  });

  it("D13: Canada C$100 domestic / international / international + conversion → 3.20 / 4.00 / 6.00", () => {
    expect(line(run(stripe, "ca"), "processing")).toBe(320);
    expect(line(run(stripe, "ca", { cardFrom: "international" }), "processing")).toBe(400);
    expect(run(stripe, "ca", { cardFrom: "international", fx: true }).totalFees).toBe(600);
  });

  it("D14: a $40 dispute costs $55 unanswered, $15 if won, $70 if lost", () => {
    const accepted = run(stripe, "us", { price: 40, dispute: "accepted" });
    expect(sum(accepted, ["disputeFee", "disputeCountered", "disputeReversal"])).toBe(5500);
    const won = run(stripe, "us", { price: 40, dispute: "won" });
    expect(line(won, "disputeCountered")).toBe(0);
    expect(sum(won, ["disputeFee", "disputeCountered", "disputeReversal"])).toBe(1500);
    const lost = run(stripe, "us", { price: 40, dispute: "lost" });
    expect(sum(lost, ["disputeFee", "disputeCountered", "disputeReversal"])).toBe(7000);
    // Smart Disputes: dispute fee + 30% of the amount when won
    const smart = run(stripe, "us", { price: 40, dispute: "smart" });
    expect(sum(smart, ["disputeFee", "smartDisputes"])).toBe(1500 + 1200);
  });

  /* ---------------- markets, methods, edges ---------------- */

  it("Germany: EEA standard / premium, UK cards 2.5%, international 3.15%, SEPA €0.35 flat, Klarna 2.99% + €0.35", () => {
    expect(line(run(stripe, "de"), "processing")).toBe(175);
    expect(line(run(stripe, "de", { cardEea: "premium" }), "processing")).toBe(305);
    expect(line(run(stripe, "de", { cardEea: "uk" }), "processing")).toBe(275);
    expect(line(run(stripe, "de", { cardEea: "intl" }), "processing")).toBe(340);
    expect(line(run(stripe, "de", { method: "sepa", price: 5000 }), "processing")).toBe(35);
    expect(line(run(stripe, "de", { method: "klarna" }), "processing")).toBe(299 + 35);
    // In person: UK cards are non-EEA → 2.9% + €0.10
    expect(line(run(stripe, "de", { method: "terminal", cardEea: "uk" }), "processing")).toBe(300);
  });

  it("UK Bacs: 1%, min 20p, max £4", () => {
    expect(line(run(stripe, "uk", { method: "bacs", price: 19.99 }), "processing")).toBe(20);
    expect(line(run(stripe, "uk", { method: "bacs", price: 20 }), "processing")).toBe(20);
    expect(line(run(stripe, "uk", { method: "bacs", price: 25 }), "processing")).toBe(25);
    expect(line(run(stripe, "uk", { method: "bacs", price: 399.49 }), "processing")).toBe(399);
    expect(line(run(stripe, "uk", { method: "bacs", price: 400 }), "processing")).toBe(400);
    expect(line(run(stripe, "uk", { method: "bacs", price: 1000 }), "processing")).toBe(400);
  });

  it("Canada PAD 1% + C$0.40 capped at C$5; Australia BECS 1% + A$0.30 capped at A$3.50", () => {
    expect(line(run(stripe, "ca", { method: "pad", price: 459.49 }), "processing")).toBe(499);
    expect(line(run(stripe, "ca", { method: "pad", price: 460 }), "processing")).toBe(500);
    expect(line(run(stripe, "au", { method: "becs", price: 319.49 }), "processing")).toBe(349);
    expect(line(run(stripe, "au", { method: "becs", price: 320 }), "processing")).toBe(350);
  });

  it("Tap to Pay adds a per-authorization fee; Interac is a flat C$0.15", () => {
    const r = run(stripe, "us", { method: "tap" });
    expect(line(r, "processing")).toBe(275);
    expect(line(r, "tapToPay")).toBe(10);
    expect(line(run(stripe, "ca", { method: "interac", price: 250 }), "processing")).toBe(15);
  });

  it("post-payment invoice: 0.4% up to US$2", () => {
    expect(line(run(stripe, "us", { price: 498.74, product: "receipt" }), "postPaymentInvoice")).toBe(199);
    expect(line(run(stripe, "us", { price: 500, product: "receipt" }), "postPaymentInvoice")).toBe(200);
    expect(line(run(stripe, "us", { price: 2000, product: "receipt" }), "postPaymentInvoice")).toBe(200);
  });

  it("BNPL rates by market", () => {
    expect(line(run(stripe, "us", { method: "klarna" }), "processing")).toBe(599 + 30);
    expect(line(run(stripe, "us", { method: "affirm" }), "processing")).toBe(600 + 30);
    expect(line(run(stripe, "us", { method: "affirm_enhanced" }), "processing")).toBe(799 + 30);
    expect(line(run(stripe, "uk", { method: "klarna" }), "processing")).toBe(499 + 35);
    expect(line(run(stripe, "uk", { method: "clearpay" }), "processing")).toBe(600 + 30);
    expect(line(run(stripe, "au", { method: "zip" }), "processing")).toBe(549 + 30);
    expect(line(run(stripe, "au", { method: "klarna" }), "processing")).toBe(499 + 55);
  });

  it("Radar per screened payment by market; the trial note disappears after January 22, 2027", () => {
    expect(line(run(stripe, "uk", { radar: "standard" }), "radar")).toBe(4);
    expect(line(run(stripe, "ca", { radar: "plus" }), "radar")).toBe(10);
    expect(line(run(stripe, "au", { radar: "pro" }), "radar")).toBe(13);
    expect(radarTrialActive(Date.parse("2027-01-21T23:59:00Z"))).toBe(true);
    expect(radarTrialActive(Date.parse("2027-01-22T00:00:00Z"))).toBe(false);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-23T12:00:00Z"));
    expect(run(stripe, "us").notes.some((n) => n.includes("January 22, 2027"))).toBe(true);
    expect(run(stripe, "us", { radar: "standard" }).fees.find((l) => l.id === "radar")!.explain).toContain("free until January 22, 2027");
    vi.setSystemTime(new Date("2027-02-01T12:00:00Z"));
    expect(run(stripe, "us").notes.some((n) => n.includes("January 22, 2027"))).toBe(false);
    expect(run(stripe, "us", { radar: "standard" }).fees.find((l) => l.id === "radar")!.explain).not.toContain("free until");
  });

  it("Radar Plus is not part of the free Standard trial: former Radar for Fraud Teams accounts pay from January 22, 2027", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-23T12:00:00Z"));
    const plus = run(stripe, "us", { radar: "plus" }).fees.find((l) => l.id === "radar")!;
    expect(plus.amount).toBe(7);
    expect(plus.explain).not.toContain("free until");
    expect(plus.explain).toContain("Radar for Fraud Teams");
    const pro = run(stripe, "us", { radar: "pro" }).fees.find((l) => l.id === "radar")!;
    expect(pro.explain).not.toContain("January 22, 2027");
  });

  it("refund note: Stripe keeps the processing fee and the conversion fee", () => {
    // $100 international card in a foreign currency: 4.4% → $4.40 + $0.30 = $4.70; 1% → $1.00
    const r = run(stripe, "us", { cardFrom: "international", fx: true });
    expect(r.notes).toContain("If you refund this payment, Stripe keeps its $4.70 processing fee and the $1.00 conversion fee.");
    expect(run(stripe, "us").notes).toContain("If you refund this payment, Stripe keeps its $3.20 processing fee.");
  });

  it("UK Pay by Bank 0.5% + 20p capped at £5; Australia rounds half up (A$10 → 16.5¢ → 17¢)", () => {
    // £958.99: 479.495p → 479p + 20p = 499p; £959: 479.5p → 480p + 20p = 500p = cap; £2,000 → cap
    expect(line(run(stripe, "uk", { method: "pay_by_bank", price: 958.99 }), "processing")).toBe(499);
    expect(line(run(stripe, "uk", { method: "pay_by_bank", price: 959 }), "processing")).toBe(500);
    expect(line(run(stripe, "uk", { method: "pay_by_bank", price: 2000 }), "processing")).toBe(500);
    expect(line(run(stripe, "au", { price: 10 }), "processing")).toBe(17 + 30);
  });

  it("warns below Stripe's minimum charge", () => {
    expect(run(stripe, "us", { price: 0.49 }).warnings.length).toBe(1);
    expect(run(stripe, "us", { price: 0.5 }).warnings.length).toBe(0);
    expect(run(stripe, "uk", { price: 0.3 }).warnings.length).toBe(0);
  });

  it("an unknown method from an old link falls back to cards", () => {
    expect(line(run(stripe, "uk", { method: "ach" }), "processing")).toBe(170);
  });

  /* ---------------- reverse mode ---------------- */

  it("breakpoints: Instant Payout minimum and a partly won dispute", () => {
    const us = M.us;
    // $34.29: 2.9% = 99.441¢ → 99¢ + 30¢ → nets $33.00, and 1.5% of $33.00 = 49.5¢ → 50¢ = the minimum; $34.28 nets $32.99
    const ip = { ...stripe.defaults(us), instantPayout: true };
    expect(stripe.breakpoints!(ip, us)).toEqual([3429]);
    expect(line(run(stripe, "us", { price: 34.29, instantPayout: true }), "instantPayout")).toBe(50);
    expect(line(run(stripe, "us", { price: 1000, instantPayout: true }), "instantPayout")).toBe(1456); // 1.5% × $970.70 = $14.5605
    const partial = { ...stripe.defaults(us), dispute: "partial", disputeWon: 50 };
    expect(stripe.breakpoints!(partial, us)).toEqual([5000]);
    // Keep $10 after a $50-won dispute: a − round(2.9% a) − 30¢ − $30 ≥ $10 → $41.50 (2.9% = $1.2035 → $1.20)
    const s = solvePrice(stripe, partial, us, "payout", 1000);
    expect(s.price).toBe(4150);
    expect(stripe.calculate({ ...partial, price: 41.49 }, us).payout).toBeLessThan(1000);
  });

  it("reverse mode across the ACH cap and the Bacs minimum", () => {
    const us = M.us;
    const ach = { ...stripe.defaults(us), method: "ach" };
    const high = solvePrice(stripe, ach, us, "payout", 99500);
    expect(high.price).toBe(100000);
    expect(stripe.calculate({ ...ach, price: (high.price! - 1) / 100 }, us).payout).toBeLessThan(99500);
    const low = solvePrice(stripe, ach, us, "payout", 50000);
    expect(low.price).toBe(50403);
    expect(stripe.calculate({ ...ach, price: 504.02 }, us).payout).toBeLessThan(50000);

    const uk = M.uk;
    const bacs = { ...stripe.defaults(uk), method: "bacs" };
    const s = solvePrice(stripe, bacs, uk, "payout", 980);
    expect(s.price).toBe(1000);
    expect(stripe.calculate({ ...bacs, price: 9.99 }, uk).payout).toBeLessThan(980);
  });
});
