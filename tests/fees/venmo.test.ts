import { describe, expect, it } from "vitest";
import venmo, { DEBIT_INTL_START, debitIntlRate, instantFee, instantFees } from "@/fees/platforms/venmo";
import { solvePrice } from "@/fees/solve";
import { M } from "@/fees/markets";
import { checkContract, line, run } from "./helpers";

const buyerLine = (r: ReturnType<typeof run>, id: string) => {
  const l = r.buyerFees.find((x) => x.id === id);
  if (!l) throw new Error(`no buyer line ${id}`);
  return l.amount;
};

describe("venmo", () => {
  it("meets the module contract (Venmo is US-only, so one market)", () => {
    expect(checkContract(venmo)).toEqual([]);
    expect(venmo.markets.map((m) => m.id)).toEqual(["us"]);
  });

  /* ------------------------------------------------------------ official worked examples */

  it("official O1 (venmo.com/business/profiles): business profile receives $100 → $2 fee, $98", () => {
    const r = run(venmo, "us", { payType: "business", amount: 100 });
    expect(line(r, "business")).toBe(200); // 1.9% × 100.00 + 0.10
    expect(r.payout).toBe(9800);
  });

  it("official O3 (Charity Profile Donation Fees): $100.00 donation → $2.00 fee, charity receives $98.00", () => {
    const r = run(venmo, "us", { payType: "charity", amount: 100 });
    expect(line(r, "charity")).toBe(200);
    expect(r.payout).toBe(9800);
  });

  it("official O2 conflict: Tap to Pay $100 uses the fee schedule's 2.29% + $0.09 ($2.38), and the note shows the marketing page's $2.99", () => {
    const r = run(venmo, "us", { payType: "tap", amount: 100 });
    expect(line(r, "tap")).toBe(238); // 2.29% × 100.00 + 0.09; venmo.com/business/profiles says 2.9% + 9¢ = $2.99
    expect(r.payout).toBe(9762);
    expect(r.notes.some((n) => n.includes("$2.99"))).toBe(true);
  });

  it("official O4 is outdated: a $100 goods & services payment now leaves $97.01 (2.99%), not the help center's $98", () => {
    const r = run(venmo, "us", { amount: 100 });
    expect(line(r, "seller")).toBe(299);
    expect(r.payout).toBe(9701);
  });

  /* ------------------------------------------------------------------ derived examples */

  it("default case is a $100 goods & services payment with a free standard transfer (research D1)", () => {
    const r = run(venmo, "us");
    expect(r.saleAmount).toBe(10000);
    expect(line(r, "seller")).toBe(299);
    expect(line(r, "standard")).toBe(0);
    expect(r.totalFees).toBe(299);
    expect(r.buyerPays).toBe(10000);
  });

  it("research D2: goods & services $100 then Instant Transfer of the $97.01 → $1.70, $95.31 reaches the bank", () => {
    const r = run(venmo, "us", { amount: 100, withdraw: "instant" });
    expect(line(r, "seller")).toBe(299);
    expect(line(r, "instant")).toBe(170); // 1.75% × 97.01 = 1.697675
    expect(r.payout).toBe(9531);
  });

  it("research D4 / D5: business $25 → $0.58 fee; Tap to Pay $100 → $2.38", () => {
    expect(line(run(venmo, "us", { payType: "business", amount: 25 }), "business")).toBe(58); // 0.475 + 0.10 = 0.575
    expect(run(venmo, "us", { payType: "business", amount: 25 }).payout).toBe(2442);
    expect(line(run(venmo, "us", { payType: "tap", amount: 100 }), "tap")).toBe(238);
  });

  it("research D6: Instant Transfer $10 / $500 / $2,000 → $0.25 (min) / $8.75 / $25 (cap)", () => {
    const at = (amount: number) => run(venmo, "us", { payType: "balance", amount, withdraw: "instant" });
    expect(line(at(10), "instant")).toBe(25);
    expect(at(10).payout).toBe(975);
    expect(line(at(500), "instant")).toBe(875);
    expect(at(500).payout).toBe(49125);
    expect(line(at(2000), "instant")).toBe(2500);
    expect(at(2000).payout).toBe(197500);
  });

  it("research D11: a friend paying $100 by credit card pays $3.00 on top; you still receive $100", () => {
    const r = run(venmo, "us", { payType: "friends", amount: 100, senderFunding: "credit" });
    expect(buyerLine(r, "sender-card")).toBe(300);
    expect(r.buyerPays).toBe(10300);
    expect(r.totalFees).toBe(0);
    expect(r.payout).toBe(10000);
  });

  it("the 3% credit card fee also applies to a goods & services payment, but never to business profiles", () => {
    const gs = run(venmo, "us", { payType: "gs", amount: 100, senderFunding: "credit" });
    expect(buyerLine(gs, "sender-card")).toBe(300);
    expect(gs.payout).toBe(9701);
    const biz = run(venmo, "us", { payType: "business", amount: 100, senderFunding: "credit" });
    expect(biz.buyerFees).toEqual([]);
    expect(biz.buyerPays).toBe(10000);
  });

  it("friends & family payments are free to receive", () => {
    const r = run(venmo, "us", { payType: "friends", amount: 250 });
    expect(r.totalFees).toBe(0);
    expect(r.payout).toBe(25000);
  });

  it("business fees are charged on the payment total, tip/tax included", () => {
    const r = run(venmo, "us", { payType: "business", amount: 40, tip: 8 });
    expect(r.saleAmount).toBe(4800);
    expect(line(r, "business")).toBe(101); // 1.9% × 48.00 = 0.912 → 0.91 + 0.10
    expect(r.payout).toBe(4699);
  });

  /* ------------------------------------------------------------------------- edges */

  it("business and charity fees start at a $1.00 payment (one cent below: free)", () => {
    for (const payType of ["business", "charity"]) {
      const id = payType === "business" ? "business" : "charity";
      expect(line(run(venmo, "us", { payType, amount: 0.99 }), id)).toBe(0);
      expect(line(run(venmo, "us", { payType, amount: 1 }), id)).toBe(12); // 1.9% × 1.00 = 0.019 → 0.02 + 0.10
    }
  });

  it("Instant Transfer minimum edge: $0.25 floor applies below $14.00", () => {
    expect(instantFee(1399)).toEqual({ fee: 25, raw: 24, hit: "min" });
    expect(instantFee(1400)).toEqual({ fee: 25, raw: 25, hit: null }); // 24.5 rounds to 25
    expect(instantFee(1457)).toEqual({ fee: 25, raw: 25, hit: null });
    expect(instantFee(1458).fee).toBe(26);
  });

  it("Instant Transfer cap edge: $25 maximum", () => {
    expect(instantFee(142828).fee).toBe(2499);
    expect(instantFee(142829).fee).toBe(2500);
    expect(instantFee(142885)).toEqual({ fee: 2500, raw: 2500, hit: null });
    expect(instantFee(142886)).toEqual({ fee: 2500, raw: 2501, hit: "max" });
    expect(instantFee(1_000_000).fee).toBe(2500);
  });

  it("Instant Transfer warnings: below the $0.26 minimum, and over $5,000 per transfer on a personal profile", () => {
    expect(run(venmo, "us", { payType: "balance", amount: 0.25, withdraw: "instant" }).warnings.some((w) => w.includes("$0.26"))).toBe(true);
    expect(run(venmo, "us", { payType: "balance", amount: 5000, withdraw: "instant" }).warnings).toEqual([]);
    expect(run(venmo, "us", { payType: "balance", amount: 5000.01, withdraw: "instant" }).warnings.some((w) => w.includes("$5,000.00"))).toBe(true);
  });

  it("a personal profile moves at most $5,000 per transfer (vhel314), so a bigger Instant Transfer pays one fee per transfer", () => {
    const at = (amount: number, payType = "balance") => run(venmo, "us", { payType, amount, withdraw: "instant" });
    // $5,000.00 fits in one transfer: 1.75% = $87.50 → capped at $25.
    expect(line(at(5000), "instant")).toBe(2500);
    // $5,000.01 needs two: $25 + the $0.25 minimum on the extra cent.
    expect(line(at(5000.01), "instant")).toBe(2525);
    expect(at(5000.01).payout).toBe(497476);
    // $10,000 = two capped transfers = $50.
    expect(line(at(10000), "instant")).toBe(5000);
    expect(at(10000).payout).toBe(995000);
    // Goods & services $10,000: $299.00 seller fee leaves $9,701.00 = $5,000 ($25) + $4,701 (1.75% = $82.27 → $25).
    const gs = at(10000, "gs");
    expect(line(gs, "seller")).toBe(29900);
    expect(line(gs, "instant")).toBe(5000);
    expect(gs.payout).toBe(965100);
    // A business profile can move up to $50,000 per Instant Transfer to a bank (vhel236): one $25 fee.
    expect(line(at(10000, "business"), "instant")).toBe(2500);
    expect(instantFees(1_000_000, 500_000)).toMatchObject({ fee: 5000, transfers: 2, full: 2, rem: 0 });
    expect(instantFees(1_000_000)).toMatchObject({ fee: 2500, transfers: 1, full: 0, rem: 1_000_000 });
  });

  it("over $19,999.99 a week a personal profile can't move everything at once", () => {
    expect(run(venmo, "us", { payType: "friends", amount: 19999.99 }).warnings).toEqual([]);
    expect(run(venmo, "us", { payType: "friends", amount: 20000 }).warnings.some((w) => w.includes("$19,999.99"))).toBe(true);
    // Business profile: $49,999.99 a week (vhel236). $51,000 − (1.9% = $969.00 + $0.10) = $50,030.90 left.
    expect(run(venmo, "us", { payType: "business", amount: 50000 }).warnings).toEqual([]);
    expect(run(venmo, "us", { payType: "business", amount: 51000 }).warnings.some((w) => w.includes("$49,999.99"))).toBe(true);
  });

  it("article claim: a business profile is cheaper than goods & services on every payment from $10 up", () => {
    // Every cent from $10.00 to $20.00 (where rounding could tie them), then every $7.77 up to $10,000.
    const cents = [...Array.from({ length: 1001 }, (_, i) => 1000 + i), ...Array.from({ length: 1287 }, (_, i) => 2000 + i * 777)];
    for (const c of cents) {
      const amount = c / 100;
      expect(line(run(venmo, "us", { payType: "business", amount }), "business")).toBeLessThan(line(run(venmo, "us", { amount }), "seller"));
    }
    // $5: 1.9% × 5.00 = 0.095 → $0.10 + $0.10 = $0.20 against 2.99% × 5.00 = 0.1495 → $0.15.
    expect(line(run(venmo, "us", { payType: "business", amount: 5 }), "business")).toBe(20);
    expect(line(run(venmo, "us", { amount: 5 }), "seller")).toBe(15);
  });

  it("goods & services note compares a business profile, and the refund note shows the fee Venmo keeps", () => {
    const r = run(venmo, "us", { amount: 100 });
    expect(r.notes[0]).toContain("$2.00, $0.99 less");
    expect(r.notes[1]).toContain("costs you $2.99");
    expect(r.notes.length).toBeLessThanOrEqual(3);
  });

  it("Venmo Debit Card international fee switches on November 4, 2026", () => {
    expect(debitIntlRate(Date.UTC(2026, 9, 23))).toBe(0);
    expect(debitIntlRate(DEBIT_INTL_START - 1)).toBe(0);
    expect(debitIntlRate(DEBIT_INTL_START)).toBe(2.5);
    expect(debitIntlRate(Date.UTC(2026, 11, 1))).toBe(2.5);
    expect(venmo.changes.find((c) => c.date === "2026-11-04")?.upcoming).toBe(true);
  });

  /* ---------------------------------------------------------------------- reverse mode */

  it("reverse D3: to keep $100 from a goods & services payment, request $103.08", () => {
    const m = M.us;
    const inputs = venmo.defaults(m);
    const s = solvePrice(venmo, inputs, m, "payout", 10000);
    expect(s.price).toBe(10308);
    expect(s.result!.payout).toBeGreaterThanOrEqual(10000);
    expect(venmo.calculate({ ...inputs, amount: 103.07 }, m).payout).toBeLessThan(10000);
  });

  it("reverse with an Instant Transfer finds the lowest amount that lands $100 in the bank", () => {
    const m = M.us;
    const inputs = { ...venmo.defaults(m), withdraw: "instant" };
    const s = solvePrice(venmo, inputs, m, "payout", 10000);
    expect(s.result!.payout).toBeGreaterThanOrEqual(10000);
    expect(venmo.calculate({ ...inputs, amount: (s.price! - 1) / 100 }, m).payout).toBeLessThan(10000);
  });

  it("reverse across the $5,000 per-transfer drop: landing $4,975.01 by Instant Transfer needs $5,000.26", () => {
    const m = M.us;
    const inputs = { ...venmo.defaults(m), payType: "balance", withdraw: "instant" };
    expect(venmo.breakpoints!(inputs, m)).toContain(500001);
    // $5,000.00 → $4,975.00; $5,000.01 → two transfers ($25.25) → $4,974.76; the extra transfer pays the $0.25 minimum,
    // so the remainder must be at least $0.26: $5,000.26 − $25.25 = $4,975.01.
    const s = solvePrice(venmo, inputs, m, "payout", 497501);
    expect(s.price).toBe(500026);
    expect(venmo.calculate({ ...inputs, amount: 5000.25 }, m).payout).toBeLessThan(497501);
    // Goods & services + Instant: $100 in the bank needs $104.92 (the article's figure).
    expect(solvePrice(venmo, { ...venmo.defaults(m), withdraw: "instant" }, m, "payout", 10000).price).toBe(10492);
  });

  it("reverse across the business $1.00 breakpoint: what you keep drops at $1.00", () => {
    const m = M.us;
    const inputs = { ...venmo.defaults(m), payType: "business" };
    expect(venmo.breakpoints!(inputs, m)).toContain(100);
    // $0.95 is reachable below the fee threshold.
    expect(solvePrice(venmo, inputs, m, "payout", 95).price).toBe(95);
    // Keeping $1.00 needs $1.12, because a $1.00 payment pays $0.12.
    const s = solvePrice(venmo, inputs, m, "payout", 100);
    expect(s.price).toBe(112);
    expect(venmo.calculate({ ...inputs, amount: 1.11 }, m).payout).toBeLessThan(100);
  });
});
