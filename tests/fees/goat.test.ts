import { describe, expect, it } from "vitest";
import goat from "@/fees/platforms/goat";
import { solvePrice } from "@/fees/solve";
import { M } from "@/fees/markets";
import type { Inputs } from "@/fees/types";
import { checkContract, line, run } from "./helpers";

/*
 * GOAT and alias publish no worked examples with inputs and outputs, so every case below is
 * derived from the official rules (research/fees/goat.md §6), one cent at a time.
 */
describe("goat", () => {
  it("meets the module contract", () => {
    expect(checkContract(goat)).toEqual([]);
  });

  it("defaults: US seller, $200, prepaid label, rating 90+, cashed out (research example 1)", () => {
    const r = run(goat, "us");
    expect(line(r, "commission")).toBe(1900); // 9.5% × 200
    expect(line(r, "seller-fee")).toBe(500);
    expect(line(r, "cash-out")).toBe(580); // 2.9% × the $200 selling price, not × $176
    expect(r.totalFees).toBe(2980);
    expect(r.payout).toBe(17020);
    expect(r.fees.some((l) => l.id === "cross-border")).toBe(false);
  });

  it("US drop-off at rating 70–89 (research example 2)", () => {
    const r = run(goat, "us", { price: 350, method: "dropoff", rating: "70" });
    expect(line(r, "commission")).toBe(5250); // 15% × 350
    expect(line(r, "seller-fee")).toBe(0);
    expect(line(r, "cash-out")).toBe(1015);
    expect(r.payout).toBe(28735);
  });

  it("Canada: 12.4% commission and no cash-out fee, landing on the same payout as a US seller (research example 3)", () => {
    const r = run(goat, "us", { location: "ca" });
    expect(line(r, "commission")).toBe(2480);
    expect(line(r, "seller-fee")).toBe(500);
    expect(line(r, "cash-out")).toBe(0);
    expect(r.payout).toBe(17020);
    expect(r.payout).toBe(run(goat, "us").payout);
  });

  it("Canada ignores a leftover 'spend it on GOAT' choice (the field is hidden there)", () => {
    expect(run(goat, "us", { location: "ca", cashOut: "spend" }).payout).toBe(17020);
  });

  it("UK drop-off, cashing out in US dollars adds 0.6% on the cash-out (research example 4)", () => {
    const r = run(goat, "us", { price: 150, location: "uk", method: "dropoff", cashOutCurrency: "usd" });
    expect(line(r, "commission")).toBe(1425);
    expect(line(r, "seller-fee")).toBe(200);
    expect(line(r, "cash-out")).toBe(435);
    expect(line(r, "cross-border")).toBe(78); // 0.6% × 129.40 = 0.7764
    expect(r.payout).toBe(12862);
  });

  it("local-currency cash-out has no cross-border line", () => {
    const r = run(goat, "us", { price: 150, location: "uk", method: "dropoff" });
    expect(r.fees.some((l) => l.id === "cross-border")).toBe(false);
    expect(r.payout).toBe(12940);
  });

  it("US sellers never get the cross-border fee, even with a stale USD choice", () => {
    expect(run(goat, "us", { cashOutCurrency: "usd" }).payout).toBe(17020);
  });

  it("rounds each line half away from zero (research example 5, $75)", () => {
    const r = run(goat, "us", { price: 75 });
    expect(line(r, "commission")).toBe(713); // 7.125
    expect(line(r, "cash-out")).toBe(218); // 2.175
    expect(r.payout).toBe(6069);
  });

  it("every commission tier, for everyone else and for Canada", () => {
    const tiers: [string, number, number][] = [
      ["90", 1900, 2480],
      ["70", 3000, 3580],
      ["50", 4000, 4580],
      ["0", 5000, 5580],
    ];
    for (const [rating, other, canada] of tiers) {
      expect(line(run(goat, "us", { rating }), "commission")).toBe(other);
      expect(line(run(goat, "us", { rating, location: "ca" }), "commission")).toBe(canada);
    }
  });

  it("spending the balance on GOAT skips the cash-out fee", () => {
    const r = run(goat, "us", { cashOut: "spend" });
    expect(line(r, "cash-out")).toBe(0);
    expect(r.payout).toBe(17600);
  });

  it("3.1% cash-out applies only outside the US when chosen", () => {
    expect(line(run(goat, "us", { location: "fr", cashOutRate: "3.1" }), "cash-out")).toBe(620);
    expect(line(run(goat, "us", { location: "fr" }), "cash-out")).toBe(580);
    expect(line(run(goat, "us", { cashOutRate: "3.1" }), "cash-out")).toBe(580);
  });

  it("seller fees follow the Fee Policy table by location and method", () => {
    const fee = (o: Record<string, string>) => line(run(goat, "us", o), "seller-fee");
    expect(fee({ location: "us", method: "dropoff" })).toBe(0);
    expect(fee({ location: "us", method: "consign" })).toBe(500);
    expect(fee({ location: "de", method: "dropoff" })).toBe(200);
    expect(fee({ location: "nl", method: "prepaid" })).toBe(600);
    expect(fee({ location: "jp", method: "consign" })).toBe(1000);
    expect(fee({ location: "cn", method: "prepaid" })).toBe(1000);
    expect(fee({ location: "cn", method: "consign" })).toBe(500);
    expect(fee({ location: "hk", method: "dropoff" })).toBe(500);
    expect(fee({ location: "ph", method: "dropoff" })).toBe(800);
    expect(fee({ location: "ph", method: "prepaid" })).toBe(1000);
    expect(fee({ location: "au" })).toBe(800);
    expect(fee({ location: "fr", method: "dropoff" })).toBe(600); // single-rate countries ignore the method
    expect(fee({ location: "mt" })).toBe(2400);
    expect(fee({ location: "as" })).toBe(3500);
    expect(fee({ location: "pr" })).toBe(800);
    expect(fee({ location: "other" })).toBe(3000);
  });

  it("buyer shipping and tax never enter the calculation: sale = listing price", () => {
    const r = run(goat, "us", { price: 123.45 });
    expect(r.saleAmount).toBe(12345);
    expect(r.buyerPays).toBe(12345);
  });

  it("profit uses your item and packaging costs", () => {
    const r = run(goat, "us", { itemCost: 110, otherCost: 2 });
    expect(r.profit).toBe(17020 - 11200);
  });

  it("rounds at the half cent: $5.00 → 47.5¢ commission rounds up, $4.99 doesn't", () => {
    const at = run(goat, "us", { price: 5 });
    expect(line(at, "commission")).toBe(48); // 9.5% × 500 = 47.5
    expect(line(at, "cash-out")).toBe(15); // 2.9% × 500 = 14.5
    const below = run(goat, "us", { price: 4.99 });
    expect(line(below, "commission")).toBe(47); // 47.405
    expect(line(below, "cash-out")).toBe(14); // 14.471
  });

  it("Mainland China cashes out in US dollars only, so the 0.6% never applies there", () => {
    const r = run(goat, "us", { location: "cn", cashOutCurrency: "usd" });
    expect(r.fees.some((l) => l.id === "cross-border")).toBe(false);
    expect(r.payout).toBe(20000 - 1900 - 1000 - 580); // prepaid label $10
    const field = goat.fields.find((f) => f.id === "cashOutCurrency")!;
    const inputs = { ...goat.defaults(M.us), location: "cn" } as Inputs;
    expect(field.showIf!(inputs, M.us)).toBe(false);
    expect(field.showIf!({ ...inputs, location: "jp" }, M.us)).toBe(true);
  });

  it("Canada can still choose US dollars: 0.6% of the $170.20 cashed out", () => {
    const r = run(goat, "us", { location: "ca", cashOutCurrency: "usd" });
    expect(line(r, "cross-border")).toBe(102); // 0.6% × 17020 = 102.12
    expect(r.payout).toBe(16918);
  });

  it("notes: drop-off saving for a prepaid label, the consignment rule for consigned items", () => {
    expect(run(goat, "us").notes[0]).toContain("costs $0 instead of $5");
    const consign = run(goat, "us", { method: "consign" }).notes;
    expect(consign[0]).toContain("Consigned items pay $5 even when you drop them off");
    expect(consign.some((n) => n.includes("instead of $5, if there is one near you"))).toBe(false);
    expect(run(goat, "us", { method: "dropoff" }).notes.some((n) => n.includes("drop-off"))).toBe(false);
  });

  it("a low rating note survives for sellers abroad", () => {
    const notes = run(goat, "us", { location: "uk", rating: "70" }).notes;
    expect(notes.length).toBeLessThanOrEqual(3);
    expect(notes.some((n) => n.includes("adds 2 points"))).toBe(true);
  });

  it("changes are dated, newest first, and include the 2024 penalty fees", () => {
    const dates = goat.changes.map((c) => c.date);
    expect([...dates].sort().reverse()).toEqual(dates);
    expect(dates).toContain("2025-06-27");
    expect(dates).not.toContain("2025-07-22");
    expect(goat.changes.find((c) => c.date === "2024-06-03")!.text).toContain("$15 for a replica");
  });

  it("reverse mode matches a brute-force search", () => {
    const m = M.us;
    const inputs = { ...goat.defaults(m) } as Inputs;
    for (const goal of [1, 5000, 15000, 17020]) {
      let first = 0;
      while (goat.calculate({ ...inputs, price: first / 100 }, m).payout < goal) first++;
      expect(solvePrice(goat, inputs, m, "payout", goal).price).toBe(first);
    }
    expect(solvePrice(goat, inputs, m, "payout", 17020).price).toBe(20000);
    expect(solvePrice(goat, inputs, m, "payout", 15000).price).toBe(17694); // $176.94, as the article says
  });

  it("reverse mode finds the lowest price that pays the target", () => {
    const m = M.us;
    const cases: Partial<Inputs>[] = [{}, { location: "uk", cashOutCurrency: "usd" }, { location: "ca", method: "dropoff" }];
    for (const extra of cases) {
      const inputs = { ...goat.defaults(m), ...extra } as Inputs;
      const s = solvePrice(goat, inputs, m, "payout", 15000);
      expect(s.price).not.toBeNull();
      expect(s.result!.payout).toBeGreaterThanOrEqual(15000);
      const below = goat.calculate({ ...inputs, price: (s.price! - 1) / 100 }, m);
      expect(below.payout).toBeLessThan(15000);
    }
  });
});
