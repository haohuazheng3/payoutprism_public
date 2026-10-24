import { describe, expect, it } from "vitest";
import airbnb, { coHostPayouts, keepPayoutFactor } from "@/fees/platforms/airbnb";
import { solvePrice } from "@/fees/solve";
import { M } from "@/fees/markets";
import { checkContract, line, run } from "./helpers";

/** One night at `price`, no cleaning fee: the shape of Airbnb's own resource-center examples. */
const oneNight = (price: number) => ({ nightlyRate: price, nights: 1, cleaningFee: 0 });

describe("airbnb", () => {
  it("meets the module contract in every market", () => {
    expect(checkContract(airbnb)).toEqual([]);
  });

  describe("official examples (resource center 746 / 749 / 761 / 771)", () => {
    it("O1 split fee: $100 → guest sees $115 (guest fee simplified to 15%), host earns $97", () => {
      const r = run(airbnb, "us", { ...oneNight(100), feeStructure: "split", guestFeeRate: 15 });
      expect(line(r, "service")).toBe(300);
      expect(r.buyerFees.find((l) => l.id === "guest-fee")!.amount).toBe(1500);
      expect(r.buyerPays).toBe(11500);
      expect(r.payout).toBe(9700);
    });

    it("O2 single fee after adjusting: $115 → $17.83 fee, host earns $97.17 (Airbnb rounds to $97)", () => {
      const r = run(airbnb, "us", oneNight(115));
      expect(line(r, "service")).toBe(1783); // 15.5% × 115.00 = 17.825
      expect(r.buyerPays).toBe(11500);
      expect(r.payout).toBe(9717);
    });

    it("O3 single fee without adjusting: $100 → host earns $84.50", () => {
      const r = run(airbnb, "us", oneNight(100));
      expect(line(r, "service")).toBe(1550);
      expect(r.payout).toBe(8450);
    });

    it("O4 20% VAT, not registered: $115 × 15.5% = $17.83, VAT $17.83 × 20% = $3.57", () => {
      const at115 = run(airbnb, "uk", { ...oneNight(115), vatOnFees: true });
      expect(line(at115, "service")).toBe(1783);
      expect(line(at115, "vat")).toBe(357);
      // Airbnb then prices at $119 but keeps the fee on $115 ("payout $97.60"); charged on $119 the
      // fee and VAT are $18.45 + $3.69 and the payout is $96.86 (see research O4).
      const at119 = run(airbnb, "uk", { ...oneNight(119), vatOnFees: true });
      expect(line(at119, "service")).toBe(1845);
      expect(line(at119, "vat")).toBe(369);
      expect(at119.payout).toBe(9686);
    });

    it("O5 VAT registered and self-assessing: guest sees $115, host earns $97.17, no VAT line", () => {
      const r = run(airbnb, "uk", { ...oneNight(115), vatOnFees: false });
      expect(r.fees.some((l) => l.id === "vat")).toBe(false);
      expect(r.payout).toBe(9717);
    });
  });

  describe("official co-host payout examples (help 3389)", () => {
    const setup = [
      { type: "cleaningPlus" as const, pct: 5 },
      { type: "pctExcl" as const, pct: 20 },
      { type: "pctExcl" as const, pct: 10 },
      { type: "fixed" as const, fixed: 3500 },
    ];

    it("scenario 1: $500 potential earnings ($400 + $100 cleaning) → $120 / $80 / $40 / $35, host $225", () => {
      expect(coHostPayouts(50000, 10000, setup)).toEqual({ coHosts: [12000, 8000, 4000, 3500], host: 22500 });
    });

    it("scenario 2: $200 potential earnings ($100 + $100 cleaning) → $105 / $20 / $10 / $35, host $30", () => {
      expect(coHostPayouts(20000, 10000, setup)).toEqual({ coHosts: [10500, 2000, 1000, 3500], host: 3000 });
    });

    it("payouts above the earnings: co-hosts are paid in order, the last gets what is left, host $0", () => {
      const over = [
        { type: "cleaningPlus" as const, pct: 40 },
        { type: "pctExcl" as const, pct: 30 },
        { type: "pctExcl" as const, pct: 20 },
        { type: "fixed" as const, fixed: 5000 },
      ];
      expect(coHostPayouts(50000, 10000, over)).toEqual({ coHosts: [26000, 12000, 8000, 4000], host: 0 });
    });

    it("the order does not depend on how the co-hosts are listed", () => {
      expect(coHostPayouts(20000, 10000, [...setup].reverse())).toEqual({ coHosts: [3500, 1000, 2000, 10500], host: 3000 });
    });
  });

  describe("derived examples (research 6.3)", () => {
    it("D1 US default: 3 nights × $150 + $80 cleaning → $82.15 fee, $447.85 payout", () => {
      const r = run(airbnb, "us");
      expect(r.saleAmount).toBe(53000);
      expect(line(r, "service")).toBe(8215);
      expect(r.buyerPays).toBe(53000);
      expect(r.buyerFees).toEqual([]);
      expect(r.payout).toBe(44785);
    });

    it("D1 with Fast Pay: 1.5% × $447.85 = $6.72 → $441.13", () => {
      const r = run(airbnb, "us", { payoutMethod: "fastpay" });
      expect(line(r, "fastpay")).toBe(672);
      expect(r.payout).toBe(44113);
    });

    it("D2 the same booking under the split fee: host 3% = $15.90, guest 14.1% = $74.73 (16.5% = $87.45)", () => {
      const r = run(airbnb, "us", { feeStructure: "split" });
      expect(line(r, "service")).toBe(1590);
      expect(r.payout).toBe(51410);
      expect(r.buyerPays).toBe(60473);
      const high = run(airbnb, "us", { feeStructure: "split", guestFeeRate: 16.5 });
      expect(high.buyerPays).toBe(61745);
      expect(high.payout).toBe(51410);
    });

    it("D3 Germany, no VAT number: €82.15 fee + 19% VAT €15.61 → €432.24", () => {
      const r = run(airbnb, "de", { nightlyRate: 150, nights: 3, cleaningFee: 80, vatOnFees: true });
      expect(line(r, "service")).toBe(8215);
      expect(line(r, "vat")).toBe(1561);
      expect(r.payout).toBe(43224);
    });

    it("D4 Mexico: 16% single fee, 4% split host fee, 16% VAT whatever the tax status", () => {
      const r = run(airbnb, "mx", { nightlyRate: 150, nights: 3, cleaningFee: 80, vatOnFees: false });
      expect(line(r, "service")).toBe(8480);
      expect(line(r, "vat")).toBe(1357);
      expect(r.payout).toBe(53000 - 8480 - 1357);
      const split = run(airbnb, "mx", { nightlyRate: 150, nights: 3, cleaningFee: 80, feeStructure: "split" });
      expect(line(split, "service")).toBe(2120);
    });

    it("D5 Italy, non-professional host without a VAT number: 22% VAT and 21% withheld on the gross €530", () => {
      const r = run(airbnb, "it", { nightlyRate: 150, nights: 3, cleaningFee: 80, vatOnFees: true, itWithholding: true });
      expect(line(r, "service")).toBe(8215);
      expect(line(r, "vat")).toBe(1807);
      expect(line(r, "withholding")).toBe(11130);
      expect(r.payout).toBe(31848);
    });

    it("D7 price rise to keep the split-fee payout: ×1.14793 (3% → 15.5%), ×1.142857 (4% → 16%)", () => {
      expect(keepPayoutFactor(M.us, false)).toBeCloseTo(0.97 / 0.845, 6);
      expect(keepPayoutFactor(M.mx, false)).toBeCloseTo(0.96 / 0.84, 6);
      // With VAT on both the old and the new fee (UK, 20%): 0.964 / 0.814.
      expect(keepPayoutFactor(M.uk, true)).toBeCloseTo(0.964 / 0.814, 6);
    });
  });

  describe("bases, options and edges", () => {
    it("the fee is charged on the cleaning fee and other host fees, never on occupancy taxes", () => {
      const r = run(airbnb, "us", { nightlyRate: 100, nights: 2, cleaningFee: 50, extraFees: 30, occupancyTax: 12 });
      expect(r.saleAmount).toBe(28000);
      expect(line(r, "service")).toBe(4340);
      expect(r.buyerFees.find((l) => l.id === "occupancy-tax")!.amount).toBe(3360);
      expect(r.buyerPays).toBe(28000 + 3360);
      expect(r.payout).toBe(28000 - 4340);
    });

    it("hosts on a different single rate (14%–16%) can enter it", () => {
      expect(line(run(airbnb, "us", { ...oneNight(100), hostRate: 14 }), "service")).toBe(1400);
      expect(line(run(airbnb, "us", { ...oneNight(100), hostRate: 16 }), "service")).toBe(1600);
    });

    it("Ireland and Switzerland pay VAT on the fee even with a VAT number", () => {
      expect(line(run(airbnb, "ie", { ...oneNight(100), vatOnFees: false }), "vat")).toBe(357); // 23% × 15.50
      expect(line(run(airbnb, "ch", { ...oneNight(100), vatOnFees: false }), "vat")).toBe(126); // 8.1% × 15.50 = 1.2555
    });

    it("the US has no VAT line; Canada adds 5% GST unless turned off", () => {
      expect(run(airbnb, "us").fees.some((l) => l.id === "vat")).toBe(false);
      expect(line(run(airbnb, "ca", oneNight(100)), "vat")).toBe(78); // 5% × 15.50 = 0.775
      expect(run(airbnb, "ca", { ...oneNight(100), vatOnFees: false }).fees.some((l) => l.id === "vat")).toBe(false);
    });

    it("Fast Pay: 1.5% of the payout up to $15, one cent below and at the $1,000 edge", () => {
      const at = (p: number) => run(airbnb, "us", { ...oneNight(p), hostRate: 0, payoutMethod: "fastpay" });
      expect(line(at(999.66), "fastpay")).toBe(1499); // 14.9949
      expect(line(at(1000), "fastpay")).toBe(1500);
      expect(line(at(1000.34), "fastpay")).toBe(1500); // 15.0051 → capped
      expect(line(at(5000), "fastpay")).toBe(1500);
    });

    it("Fast Pay is US only", () => {
      expect(run(airbnb, "uk", { payoutMethod: "fastpay" }).fees.some((l) => l.id === "fastpay")).toBe(false);
    });

    it("a co-host share comes out of the earnings after Airbnb's fee", () => {
      const r = run(airbnb, "us", { coHost: "pctIncl", coHostPct: 20 });
      expect(line(r, "cohost")).toBe(8957); // 20% × 447.85
      expect(r.payout).toBe(44785 - 8957);
      const fixed = run(airbnb, "us", { ...oneNight(50), coHost: "fixed", coHostFixed: 60 });
      expect(line(fixed, "cohost")).toBe(4225); // only $42.25 of earnings to share
      expect(fixed.payout).toBe(0);
    });

    it("split-fee guest fee covers 14.1% to 16.5% and never changes the payout", () => {
      const lo = run(airbnb, "us", { ...oneNight(200), feeStructure: "split", guestFeeRate: 14.1 });
      const hi = run(airbnb, "us", { ...oneNight(200), feeStructure: "split", guestFeeRate: 16.5 });
      expect(lo.buyerPays).toBe(20000 + 2820);
      expect(hi.buyerPays).toBe(20000 + 3300);
      expect(lo.payout).toBe(hi.payout);
    });
  });

  describe("reverse mode", () => {
    it("finds the lowest nightly rate that nets the target", () => {
      const m = M.us;
      const inputs = airbnb.defaults(m);
      const s = solvePrice(airbnb, inputs, m, "payout", 50000);
      expect(s.price).not.toBeNull();
      expect(s.result!.payout).toBeGreaterThanOrEqual(50000);
      const below = airbnb.calculate({ ...inputs, nightlyRate: (s.price! - 1) / 100 }, m);
      expect(below.payout).toBeLessThan(50000);
    });

    it("$97 from one night needs $114.79, not Airbnb's rounded $115", () => {
      const m = M.us;
      const inputs = { ...airbnb.defaults(m), ...oneNight(100) };
      expect(solvePrice(airbnb, inputs, m, "payout", 9700).price).toBe(11479);
    });

    it("works across the Fast Pay cap breakpoint", () => {
      const m = M.us;
      const inputs = { ...airbnb.defaults(m), payoutMethod: "fastpay" };
      const bps = airbnb.breakpoints!(inputs, m);
      expect(bps.length).toBe(1);
      for (const goal of [98000, 150000]) {
        const s = solvePrice(airbnb, inputs, m, "payout", goal);
        expect(s.result!.payout).toBeGreaterThanOrEqual(goal);
        expect(airbnb.calculate({ ...inputs, nightlyRate: (s.price! - 1) / 100 }, m).payout).toBeLessThan(goal);
      }
    });
  });
});
