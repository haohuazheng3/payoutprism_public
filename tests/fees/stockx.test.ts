import { describe, expect, it } from "vitest";
import stockx from "@/fees/platforms/stockx";
import { solvePrice } from "@/fees/solve";
import { M } from "@/fees/markets";
import { checkContract, line, run } from "./helpers";

describe("stockx", () => {
  it("meets the module contract in every market", () => {
    expect(checkContract(stockx)).toEqual([]);
  });

  it("official example (Updates to the StockX Seller Program): $100 Flex sale, Level 1 → 9% + 3%, no fulfillment fee, payout $88", () => {
    const r = run(stockx, "us", { price: 100, level: "1", fulfillment: "flex" });
    expect(line(r, "transaction")).toBe(900);
    expect(line(r, "processing")).toBe(300);
    expect(line(r, "shipping")).toBe(0);
    expect(r.payout).toBe(8800);
  });

  it("US default: $200, Level 1, shipped by the seller → $18 + $6 + $5, keeps $171 (research D1)", () => {
    const r = run(stockx, "us");
    expect(line(r, "transaction")).toBe(1800);
    expect(line(r, "processing")).toBe(600);
    expect(line(r, "shipping")).toBe(500);
    expect(r.totalFees).toBe(2900);
    expect(r.payout).toBe(17100);
    expect(r.buyerFees).toEqual([]);
  });

  it("US Level 5 at $350 → $24.50 + $10.50 + $5, keeps $310 (research D2)", () => {
    const r = run(stockx, "us", { price: 350, level: "5" });
    expect(line(r, "transaction")).toBe(2450);
    expect(line(r, "processing")).toBe(1050);
    expect(r.payout).toBe(31000);
  });

  it("every Seller Level rate on a $100 sale", () => {
    const rates = { "1": 900, "2": 850, "3": 800, "4": 750, "5": 700 };
    for (const [level, fee] of Object.entries(rates)) expect(line(run(stockx, "us", { price: 100, level }), "transaction")).toBe(fee);
  });

  it("US minimum seller fee: $40 at Level 1 pays $5.00, not $3.60 (research D3, reading A)", () => {
    const r = run(stockx, "us", { price: 40 });
    expect(line(r, "transaction")).toBe(500);
    expect(line(r, "processing")).toBe(120);
    expect(r.payout).toBe(2880);
    expect(r.notes.some((n) => n.includes("$1.20 more"))).toBe(true);
  });

  it("minimum fee edge at Level 1: $55.56 is the first price where 9% ≥ $5.00; below $55.50 the minimum applies", () => {
    expect(line(run(stockx, "us", { price: 55.56 }), "transaction")).toBe(500); // 9% × 55.56 = 5.0004
    expect(line(run(stockx, "us", { price: 55.62 }), "transaction")).toBe(501); // 5.0058
    const below = run(stockx, "us", { price: 55.49 }); // 9% = 4.9941 → $4.99, raised to $5.00
    expect(line(below, "transaction")).toBe(500);
    expect(below.fees.find((l) => l.id === "transaction")!.detail).toContain("minimum");
    expect(run(stockx, "us", { price: 55.56 }).fees.find((l) => l.id === "transaction")!.detail).not.toContain("minimum");
    expect(stockx.breakpoints!(stockx.defaults(M.us), M.us)).toEqual([5556]);
  });

  it("UK Level 2 at £150 → £12.75 + £4.50 + £4.00, keeps £128.75 (research D4)", () => {
    const r = run(stockx, "uk", { price: 150, level: "2" });
    expect(r.currency).toBe("GBP");
    expect(line(r, "transaction")).toBe(1275);
    expect(line(r, "processing")).toBe(450);
    expect(line(r, "shipping")).toBe(400);
    expect(r.payout).toBe(12875);
  });

  it("regional minimums and shipping fees: UK £4.50, Canada C$7.00 / C$6.00, Germany €5.00 / €5.00, Greece €17.00", () => {
    expect(line(run(stockx, "uk", { price: 30 }), "transaction")).toBe(450);
    expect(line(run(stockx, "uk", { price: 50 }), "transaction")).toBe(450); // 9% × 50 = 4.50 exactly
    const ca = run(stockx, "ca", { price: 50 });
    expect(line(ca, "transaction")).toBe(700);
    expect(line(ca, "shipping")).toBe(600);
    expect(line(run(stockx, "ca", { price: 77.78 }), "transaction")).toBe(700); // 7.0002
    expect(line(run(stockx, "ca", { price: 100 }), "transaction")).toBe(900);
    const de = run(stockx, "de", { price: 40 });
    expect(line(de, "transaction")).toBe(500);
    expect(line(de, "shipping")).toBe(500);
    expect(line(run(stockx, "gr"), "shipping")).toBe(1700);
    expect(line(run(stockx, "es"), "shipping")).toBe(800);
  });

  it("Flex at Level 3, $100 → $8 + $3, keeps $89 and gets a storage note (research D5)", () => {
    const r = run(stockx, "us", { price: 100, level: "3", fulfillment: "flex" });
    expect(r.payout).toBe(8900);
    expect(r.notes.some((n) => n.includes("free for the first 30 days, then $1.00 a month"))).toBe(true);
  });

  it("NYC drop-off refunds the shipping fee", () => {
    const r = run(stockx, "us", { price: 200, dropOff: true });
    expect(line(r, "shipping")).toBe(0);
    expect(r.payout).toBe(17600);
  });

  it("No Fee Resale removes every StockX fee, but not on Flex", () => {
    expect(run(stockx, "us", { price: 200, noFeeResale: true }).payout).toBe(20000);
    expect(run(stockx, "us", { price: 200, noFeeResale: true, fulfillment: "flex" }).payout).toBe(17600);
  });

  it("debit card cash-out: 2% with $1.95 minimum and $9.95 maximum (research D6)", () => {
    expect(line(run(stockx, "us", { price: 200, cashOut: "debit" }), "cashout")).toBe(342); // 2% × 171.00
    expect(run(stockx, "us", { price: 200, cashOut: "debit" }).payout).toBe(16758);
    expect(line(run(stockx, "us", { price: 60, cashOut: "debit" }), "cashout")).toBe(195); // 2% × 47.80 = 0.96 → min
    expect(line(run(stockx, "us", { price: 1000, cashOut: "debit" }), "cashout")).toBe(995); // 2% × 875 = 17.50 → max
  });

  it("bank transfer: about $2 per payout in the US, converted elsewhere", () => {
    expect(line(run(stockx, "us", { cashOut: "bank" }), "cashout")).toBe(200);
    expect(line(run(stockx, "uk", { cashOut: "bank" }), "cashout")).toBe(Math.round(200 * (0.8377 / 1.1205)));
  });

  it("hand-computed edges (reviewer, 2026-10-23): rounding at the US edge, UK £50, Canada C$77.78, Greece, Flex minimum", () => {
    // US $55.55: 9% = 4.9995 → $5.00 (half up), so the percentage itself reaches the minimum; 3% = 1.6665 → $1.67.
    const us5555 = run(stockx, "us", { price: 55.55 });
    expect(line(us5555, "transaction")).toBe(500);
    expect(line(us5555, "processing")).toBe(167);
    expect(us5555.payout).toBe(4388);
    // UK £49.00: 9% = £4.41 → minimum £4.50; 3% = £1.47; shipping £4.00 → £39.03.
    const uk49 = run(stockx, "uk", { price: 49 });
    expect(line(uk49, "transaction")).toBe(450);
    expect(uk49.payout).toBe(3903);
    // UK £49.99: 9% = 4.4991 → £4.50 on its own; 3% = 1.4997 → £1.50 → £39.99.
    expect(run(stockx, "uk", { price: 49.99 }).payout).toBe(3999);
    // Canada C$60: 9% = C$5.40 → minimum C$7.00; 3% = C$1.80; shipping C$6.00 → C$45.20. Reading B (minimum on 9% + 3% = C$7.20) keeps C$1.60 more.
    const ca60 = run(stockx, "ca", { price: 60 });
    expect(ca60.payout).toBe(4520);
    expect(ca60.notes.some((n) => n.includes("$1.60 more"))).toBe(true);
    // Canada C$77.77: 9% = 6.9993 → C$7.00; 3% = 2.3331 → C$2.33 → C$62.44.
    expect(run(stockx, "ca", { price: 77.77 }).payout).toBe(6244);
    // Greece, Level 3, €180: 8% = €14.40, 3% = €5.40, shipping €17.00 → €143.20.
    expect(run(stockx, "gr", { price: 180, level: "3" }).payout).toBe(14320);
    // Flex $40 at Level 1: minimum $5.00 + 3% $1.20, no shipping → $33.80.
    expect(run(stockx, "us", { price: 40, fulfillment: "flex" }).payout).toBe(3380);
    // Level 4 $1,000 dropped off in NYC: 7.5% = $75, 3% = $30, shipping refunded → $895.
    expect(run(stockx, "us", { price: 1000, level: "4", dropOff: true }).payout).toBe(89500);
  });

  it("debit-card cash-out edges: 2% of the amount withdrawn, at the $1.95 floor and the $9.95 cap", () => {
    // $570.46: 9% = 51.34, 3% = 17.11, shipping 5 → $497.01 withdrawn; 2% = 9.9402 → $9.94 (under the cap).
    expect(line(run(stockx, "us", { price: 570.46, cashOut: "debit" }), "cashout")).toBe(994);
    // $571.03: 51.39 + 17.13 + 5 → $497.51 withdrawn; 2% = 9.9502 → capped at $9.95 → $487.56.
    const cap = run(stockx, "us", { price: 571.03, cashOut: "debit" });
    expect(line(cap, "cashout")).toBe(995);
    expect(cap.payout).toBe(48756);
    // $116.48: 10.48 + 3.49 + 5 → $97.51 withdrawn; 2% = 1.9502 → $1.95 → $95.56.
    expect(run(stockx, "us", { price: 116.48, cashOut: "debit" }).payout).toBe(9556);
    // $150: $127.00 withdrawn; 2% = $2.54 (between floor and cap).
    expect(line(run(stockx, "us", { price: 150, cashOut: "debit" }), "cashout")).toBe(254);
    expect(stockx.breakpoints!({ ...stockx.defaults(M.us), cashOut: "debit" }, M.us)).toEqual([5556, 11648, 57103]);
  });

  it("reverse mode: true minimum prices checked by brute force (below, across and above the minimum-fee edge, and the debit cap)", () => {
    const m = M.us;
    const base = stockx.defaults(m);
    // $40.00 payout: under the minimum, 0.97p − $10 ≥ $40 → $51.55 (3% = 1.5465 → $1.55).
    expect(solvePrice(stockx, base, m, "payout", 4000).price).toBe(5155);
    // $45.00 payout: unreachable below $55.56 (max $43.83), so 0.88p − $5 ≥ $45 → $56.81 (511 + 170 + 500).
    expect(solvePrice(stockx, base, m, "payout", 4500).price).toBe(5681);
    // Level 5, $44.00: 7% stays under $5.00 until $71.43 → 0.97p − $10 ≥ $44 → $55.67.
    expect(solvePrice(stockx, { ...base, level: "5" }, m, "payout", 4400).price).toBe(5567);
    // Debit card, $487.56 after the capped $9.95 withdrawal fee → $571.03.
    expect(solvePrice(stockx, { ...base, cashOut: "debit" }, m, "payout", 48756).price).toBe(57103);
  });

  it("reverse mode finds the lowest price that pays the target, across the minimum-fee edge", () => {
    const m = M.us;
    const inputs = stockx.defaults(m);
    for (const goal of [2000, 4300, 17100]) {
      const s = solvePrice(stockx, inputs, m, "payout", goal);
      expect(s.price).not.toBeNull();
      expect(s.result!.payout).toBeGreaterThanOrEqual(goal);
      const below = stockx.calculate({ ...inputs, price: (s.price! - 1) / 100 }, m);
      expect(below.payout).toBeLessThan(goal);
    }
    expect(solvePrice(stockx, inputs, m, "payout", 17100).price).toBe(20000);
  });
});
