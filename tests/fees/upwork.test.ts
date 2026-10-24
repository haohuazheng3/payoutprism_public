import { describe, expect, it } from "vitest";
import upwork from "@/fees/platforms/upwork";
import { solvePrice } from "@/fees/solve";
import { pickMarket } from "@/fees/markets";
import type { Result } from "@/fees/types";
import { checkContract, line, run } from "./helpers";

const buyer = (r: Result, id: string) => {
  const l = r.buyerFees.find((x) => x.id === id);
  if (!l) throw new Error(`no buyer line ${id}`);
  return l.amount;
};
const has = (r: Result, id: string) => r.fees.some((l) => l.id === id);
const NO_WITHDRAWAL = { withdraw: "none" };

describe("upwork", () => {
  it("meets the module contract in every market", () => {
    expect(checkContract(upwork)).toEqual([]);
  });

  it("every market is a US-dollar market (Upwork pays and charges in USD everywhere)", () => {
    for (const m of upwork.markets) expect(m.currency).toBe("USD");
  });

  /* ---------------- official worked examples ---------------- */

  it("Help Center O1: 12 h × $22.22 at 10% → fee $26.664 rounds to $26.66, net $239.98", () => {
    const r = run(upwork, "us", { billing: "hourly", amount: 22.22, hours: 12, feeRate: 10, ...NO_WITHDRAWAL });
    expect(r.saleAmount).toBe(26664);
    expect(line(r, "service")).toBe(2666);
    expect(r.payout).toBe(23998);
  });

  it("Help Center O2: 12 h × $27.78 at 10% → fee $33.336 rounds to $33.34, net $300.02", () => {
    const r = run(upwork, "us", { billing: "hourly", amount: 27.78, hours: 12, feeRate: 10, ...NO_WITHDRAWAL });
    expect(r.saleAmount).toBe(33336);
    expect(line(r, "service")).toBe(3334);
    expect(r.payout).toBe(30002);
  });

  it("Pricing page O4: billing $500 on a 10% contract pays out $450 (free US bank withdrawal)", () => {
    const r = run(upwork, "us");
    expect(line(r, "service")).toBe(5000);
    expect(line(r, "withdrawal")).toBe(0);
    expect(r.payout).toBe(45000);
  });

  it("Pricing page O5: $100 of earnings → between $85 and $100 depending on the fee", () => {
    expect(run(upwork, "us", { amount: 100, feeRate: 15 }).payout).toBe(8500);
    expect(run(upwork, "us", { amount: 100, feeRate: 0 }).payout).toBe(10000);
  });

  it("Help Center O6: Direct Contract earnings of $100 → $5 fee; Freelancer Plus members pay 0%", () => {
    expect(line(run(upwork, "us", { amount: 100, contract: "dc" }), "service")).toBe(500);
    expect(line(run(upwork, "us", { amount: 100, contract: "dc", plus: true }), "service")).toBe(0);
  });

  it("Pricing page O7: a $100 contract costs a Basic client $105 (5%) or $103 by US bank (3%)", () => {
    const card = run(upwork, "us", { amount: 100 });
    expect(buyer(card, "client-fee")).toBe(500);
    expect(card.buyerPays).toBe(10500);
    const ach = run(upwork, "us", { amount: 100, clientPlan: "basic3" });
    expect(ach.buyerPays).toBe(10300);
    expect(ach.payout).toBe(card.payout); // client fees never reduce the freelancer's pay
  });

  it("Pricing page O8: Business Plus $110 (10%) or $108 (8%), plus an initiation fee only when entered", () => {
    expect(run(upwork, "us", { amount: 100, clientPlan: "bplus10" }).buyerPays).toBe(11000);
    expect(run(upwork, "us", { amount: 100, clientPlan: "bplus8" }).buyerPays).toBe(10800);
    const withCif = run(upwork, "us", { amount: 100, clientPlan: "bplus10", cif: 4.99 });
    expect(buyer(withCif, "client-cif")).toBe(499);
    expect(withCif.buyerPays).toBe(11499);
  });

  it("UK VAT article: $100 of service fees → $20 VAT (no VAT number); none with a VAT number", () => {
    const r = run(upwork, "uk", { amount: 1000, ...NO_WITHDRAWAL });
    expect(line(r, "service")).toBe(10000);
    expect(line(r, "tax-vat")).toBe(2000);
    expect(r.payout).toBe(100000 - 10000 - 2000);
    expect(has(run(upwork, "uk", { amount: 1000, taxOnFees: false }), "tax-vat")).toBe(false);
  });

  it("Australia GST article: $100 of service fees → $10 GST", () => {
    expect(line(run(upwork, "au", { amount: 1000 }), "tax-gst")).toBe(1000);
  });

  it("India GST article: $100 of service fees → $18 GST", () => {
    expect(line(run(upwork, "in", { amount: 1000 }), "tax-gst")).toBe(1800);
  });

  it("India TDS is withheld on the gross amount, before the service fee: 0.1% with a linked PAN, 5% without", () => {
    expect(line(run(upwork, "in", { amount: 1000 }), "tds")).toBe(100);
    expect(line(run(upwork, "in", { amount: 1000, panLinked: false }), "tds")).toBe(5000);
  });

  it("withdrawal fees from Upwork's help pages", () => {
    expect(line(run(upwork, "us", { withdraw: "usbank" }), "withdrawal")).toBe(0);
    expect(line(run(upwork, "us", { withdraw: "instant" }), "withdrawal")).toBe(200);
    expect(line(run(upwork, "intl", { withdraw: "local" }), "withdrawal")).toBe(99);
    expect(line(run(upwork, "intl", { withdraw: "usbank" }), "withdrawal")).toBe(299);
    expect(line(run(upwork, "uk", { withdraw: "wire" }), "withdrawal")).toBe(5000);
    // PayPal / Payoneer / wallets: Upwork doesn't publish the fee, so it is whatever the user enters.
    const other = run(upwork, "intl", { withdraw: "other" });
    expect(line(other, "withdrawal")).toBe(0);
    expect(other.notes.some((n) => n.includes("doesn’t publish"))).toBe(true);
    expect(line(run(upwork, "intl", { withdraw: "other", withdrawOther: 1.5 }), "withdrawal")).toBe(150);
    // A US-only method is not offered outside the US: falls back to the market's first option.
    expect(line(run(upwork, "uk", { withdraw: "instant" }), "withdrawal")).toBe(99);
    expect(has(run(upwork, "us", NO_WITHDRAWAL), "withdrawal")).toBe(false);
  });

  /* ---------------- derived examples (research section 6) ---------------- */

  it("D1: $40/h × 25 h at 12% → $880; client $1,050 at 5%, $1,079.90 on a flat 7.99% account; local bank $879.01", () => {
    const base = { billing: "hourly", amount: 40, hours: 25, feeRate: 12 };
    const us = run(upwork, "us", { ...base, ...NO_WITHDRAWAL });
    expect(line(us, "service")).toBe(12000);
    expect(us.payout).toBe(88000);
    expect(us.buyerPays).toBe(105000);
    expect(run(upwork, "us", { ...base, clientPlan: "flat799" }).buyerPays).toBe(107990);
    expect(run(upwork, "intl", base).payout).toBe(87901);
  });

  it("D2: $850 (milestone + bonus) at 15%, one $50 wire → $672.50; a US-bank client pays $875.50", () => {
    const r = run(upwork, "intl", { amount: 850, feeRate: 15, withdraw: "wire", clientPlan: "basic3" });
    expect(line(r, "service")).toBe(12750);
    expect(r.payout).toBe(67250);
    expect(r.buyerPays).toBe(87550);
  });

  it("D5: $500 to a US bank from outside the US costs $2.99 (since 2026-09-01) → $497.01", () => {
    expect(run(upwork, "intl", { amount: 500, contract: "zero", withdraw: "usbank" }).payout).toBe(49701);
    expect(run(upwork, "us", { amount: 500, contract: "zero", withdraw: "usbank" }).payout).toBe(50000);
  });

  it("D6: India, $1,000 at 10% with linked PAN, no GSTIN → TDS $1 + fee $100 + GST $18 → $881", () => {
    const r = run(upwork, "in", { amount: 1000, ...NO_WITHDRAWAL });
    expect(line(r, "tds")).toBe(100);
    expect(line(r, "service")).toBe(10000);
    expect(line(r, "tax-gst")).toBe(1800);
    expect(r.payout).toBe(88100);
  });

  it("D7: 16 Connects cost $2.40, and VAT/GST applies to Connects purchases too", () => {
    expect(line(run(upwork, "us", { connects: 16 }), "connects")).toBe(240);
    const uk = run(upwork, "uk", { amount: 500, connects: 16 });
    expect(line(uk, "tax-vat")).toBe(Math.round(0.2 * (5000 + 240)));
  });

  it("contract types: pre-May-2025 10%, Enterprise 10%, Any Hire / client Direct Contracts 0%", () => {
    expect(line(run(upwork, "us", { contract: "legacy", feeRate: 15 }), "service")).toBe(5000);
    const ent = run(upwork, "us", { contract: "enterprise" });
    expect(line(ent, "service")).toBe(5000);
    expect(ent.buyerFees).toEqual([]);
    const zero = run(upwork, "us", { contract: "zero" });
    expect(line(zero, "service")).toBe(0);
    expect(zero.payout).toBe(50000);
    expect(zero.buyerPays).toBe(50000);
  });

  it("the variable fee is limited to Upwork's 0–15% range, with a warning", () => {
    const r = run(upwork, "us", { feeRate: 20 });
    expect(line(r, "service")).toBe(7500);
    expect(r.warnings.length).toBe(1);
    expect(run(upwork, "us", { feeRate: 15 }).warnings).toEqual([]);
  });

  it("states the 0%–15% range in money for the amount entered", () => {
    const note = run(upwork, "us").notes[0];
    expect(note).toContain("$425.00 at 15%");
    expect(note).toContain("$500.00 at 0%");
  });

  it("Canada: tax on fees by province; PST in BC/MB/SK stays when a GST/HST number is on file", () => {
    expect(line(run(upwork, "ca", { amount: 100 }), "tax-hst")).toBe(130); // Ontario 13% × $10
    const qc = run(upwork, "ca", { province: "QC" });
    expect(line(qc, "tax-gst")).toBe(250);
    expect(line(qc, "tax-qst")).toBe(499); // 9.975% × $50.00 = 4.9875
    const bc = run(upwork, "ca", { province: "BC", taxOnFees: false });
    expect(has(bc, "tax-gst")).toBe(false);
    expect(line(bc, "tax-pst")).toBe(350);
    expect(run(upwork, "ca", { province: "AB", taxOnFees: false }).fees.filter((l) => l.kind === "tax")).toEqual([]);
  });

  it("other countries: VAT/GST at the rate the user enters, none by default", () => {
    expect(run(upwork, "intl").fees.some((l) => l.kind === "tax")).toBe(false);
    expect(line(run(upwork, "intl", { otherTax: 19 }), "tax-vat")).toBe(950);
  });

  it("Instant Pay: one $2.00 transfer up to $2,999, two from $2,999.01 (edge at the cent)", () => {
    const at = (amount: number) => line(run(upwork, "us", { amount, contract: "zero", withdraw: "instant" }), "withdrawal");
    expect(at(2999)).toBe(200);
    expect(at(2999.01)).toBe(400);
    expect(at(5998)).toBe(400);
    expect(at(5998.01)).toBe(600);
  });

  it("Business Plus: no initiation fee on hourly contracts, up to $4.99 on fixed-price ≤ $100", () => {
    const hourly = run(upwork, "us", { billing: "hourly", amount: 30, clientPlan: "bplus10" });
    expect(hourly.notes.some((n) => n.includes("no contract initiation fee on hourly"))).toBe(true);
    const fixed = run(upwork, "us", { amount: 80, clientPlan: "bplus10" });
    expect(fixed.notes.some((n) => n.includes("up to $4.99"))).toBe(true);
  });

  it("warns below Upwork's minimums ($5 fixed price, $3 an hour)", () => {
    expect(run(upwork, "us", { amount: 4 }).warnings.some((w) => w.includes("$5.00"))).toBe(true);
    expect(run(upwork, "us", { billing: "hourly", amount: 2.5 }).warnings.some((w) => w.includes("$3.00"))).toBe(true);
  });

  /* ---------------- reverse mode ---------------- */

  it("reverse mode finds the lowest amount that pays the target (default inputs)", () => {
    const m = pickMarket(upwork.markets, "us", "us");
    const inputs = upwork.defaults(m);
    const s = solvePrice(upwork, inputs, m, "payout", 100000);
    expect(s.price).not.toBeNull();
    expect(s.result!.payout).toBeGreaterThanOrEqual(100000);
    expect(upwork.calculate({ ...inputs, amount: (s.price! - 1) / 100 }, m).payout).toBeLessThan(100000);
  });

  it("D3: to take home $1,200 for 40 hours at 8%, charge $32.61 an hour (net $1,200.05)", () => {
    const m = pickMarket(upwork.markets, "us", "us");
    const inputs = { ...upwork.defaults(m), billing: "hourly", hours: 40, feeRate: 8, withdraw: "none" };
    const s = solvePrice(upwork, inputs, m, "payout", 120000);
    expect(s.price).toBe(3261);
    expect(s.result!.payout).toBe(120005);
    expect(upwork.calculate({ ...inputs, amount: 32.6 }, m).payout).toBeLessThan(120000);
  });

  it("reverse mode across the Instant Pay $2,999 breakpoint picks the true lowest amount", () => {
    const m = pickMarket(upwork.markets, "us", "us");
    const inputs = { ...upwork.defaults(m), contract: "zero", withdraw: "instant" };
    expect(upwork.breakpoints!(inputs, m).slice(0, 2)).toEqual([299901, 599801]);
    // Reachable just below the edge: $2,998.00 − $2.00 = $2,996.00.
    const below = solvePrice(upwork, inputs, m, "payout", 299600);
    expect(below.price).toBe(299800);
    // Not reachable below the edge (max $2,997.00 there): needs two transfers.
    const above = solvePrice(upwork, inputs, m, "payout", 299750);
    expect(above.price).toBe(300150);
    expect(upwork.calculate({ ...inputs, amount: 3001.49 }, m).payout).toBeLessThan(299750);
  });
});
