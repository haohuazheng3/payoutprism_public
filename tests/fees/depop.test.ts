import { describe, expect, it } from "vitest";
import depop, { auDepopShippingRequired } from "@/fees/platforms/depop";
import { solvePrice } from "@/fees/solve";
import { pickMarket } from "@/fees/markets";
import type { Inputs } from "@/fees/types";
import { checkContract, line, run } from "./helpers";

const buyer = (r: ReturnType<typeof run>, id: string) => {
  const l = r.buyerFees.find((x) => x.id === id);
  if (!l) throw new Error(`no buyer line ${id}`);
  return l.amount;
};

describe("depop", () => {
  it("meets the module contract in every market", () => {
    expect(checkContract(depop)).toEqual([]);
  });

  /*
   * Official example E1 (Boosted Listings Policy, effective 23 March 2026): a UK boosted item sells for
   * £50 including shipping → 12% boosting fee £6.00. The same example lists processing as
   * "3.3% + £0.45 = £2.10", which is the US rate; the fee table's UK rate is 2.9% + £0.30 = £1.75.
   */
  it("official example E1: UK £50 boosted sale (own shipping) → 12% boost £6.00; processing at the UK rate £1.75", () => {
    const r = run(depop, "uk", { price: 46, shippingMethod: "own", shippingCharged: 4, boosted: true });
    expect(line(r, "boost")).toBe(600);
    expect(line(r, "processing")).toBe(175); // 2.9% × 50.00 + 0.30
    expect(r.totalFees).toBe(775);
    // The example's £2.10 is the US formula: 3.3% × 50.00 + 0.45.
    expect(line(run(depop, "us", { price: 46, shippingMethod: "own", shippingCharged: 4, boosted: true }), "processing")).toBe(210);
  });

  it("official example E2 (policy of 20 March 2024): UK £30 boosted at the old 8% → £2.40 + £1.17 = £3.57", () => {
    const r = run(depop, "uk", { price: 26, shippingMethod: "own", shippingCharged: 4, boosted: true, boostOld: true });
    expect(line(r, "boost")).toBe(240);
    expect(line(r, "processing")).toBe(117);
    expect(r.totalFees).toBe(357);
  });

  it("US D1: $40 item, $6 Depop label, 8% sales tax → processing $2.09, payout $37.91, buyer fee ≤ $3.00", () => {
    const r = run(depop, "us", { price: 40, labelPrice: 6, salesTax: 8 });
    expect(line(r, "selling")).toBe(0);
    expect(line(r, "processing")).toBe(209); // 3.3% × 49.68 + 0.45 = 2.08944
    expect(line(r, "label")).toBe(0); // buyer paid the label, Depop deducted it
    expect(r.saleAmount).toBe(4000);
    expect(r.payout).toBe(3791);
    expect(buyer(r, "marketplace")).toBe(300); // 5% × 40 + 1
    expect(buyer(r, "marketplace-tax")).toBe(24); // sales tax on the marketplace fee
    expect(r.buyerPays).toBe(4000 + 600 + 368 + 300 + 24);
  });

  it("UK D2: £50 item, £4 own shipping, boosted → processing £1.87, boost £6.48, payout £45.65", () => {
    const r = run(depop, "uk", { price: 50, shippingMethod: "own", shippingCharged: 4, boosted: true });
    expect(line(r, "processing")).toBe(187); // 2.9% × 54 + 0.30 = 1.866
    expect(line(r, "boost")).toBe(648); // 12% × 54
    expect(r.totalFees).toBe(835);
    expect(r.payout).toBe(4565);
    expect(buyer(r, "marketplace")).toBe(350);
  });

  it("Australia D3: A$60 item, A$10 Depop label → processing A$2.12, payout A$57.88, listing shows ≤ A$64", () => {
    const r = run(depop, "au", { price: 60, labelPrice: 10 });
    expect(line(r, "processing")).toBe(212); // 2.6% × 70 + 0.30
    expect(r.payout).toBe(5788);
    expect(buyer(r, "marketplace")).toBe(400);
    expect(r.notes.some((n) => n.includes("$64.00"))).toBe(true);
  });

  it("Other countries D4: €30 + €5 own shipping, boosted → 10% selling €3.50 + 8% boost €2.80 (PayPal not published)", () => {
    const r = run(depop, "other", { price: 30, shippingCharged: 5, boosted: true });
    expect(line(r, "selling")).toBe(350);
    expect(line(r, "boost")).toBe(280);
    expect(line(r, "paypal")).toBe(0);
    expect(r.buyerFees).toEqual([]);
    expect(r.payout).toBe(3500 - 630);
  });

  it("Other countries: the PayPal rate the seller enters applies to item + shipping", () => {
    const r = run(depop, "other", { price: 30, shippingCharged: 5, paypalRate: 2.9, paypalFixed: 0.35 });
    expect(line(r, "paypal")).toBe(102 + 35); // 2.9% × 35.00 = 1.015 → 1.02
  });

  it("US D5: $60 + $8 own shipping, boosted → processing $2.69, boost $8.16, payout $57.15", () => {
    const r = run(depop, "us", { price: 60, shippingMethod: "own", shippingCharged: 8, boosted: true });
    expect(line(r, "processing")).toBe(269);
    expect(line(r, "boost")).toBe(816);
    expect(r.payout).toBe(5715);
  });

  it("boosting fee skips a Depop label but includes shipping you arrange yourself", () => {
    expect(line(run(depop, "us", { price: 30, labelPrice: 6, boosted: true }), "boost")).toBe(360);
    expect(line(run(depop, "us", { price: 30, shippingMethod: "own", shippingCharged: 6, boosted: true }), "boost")).toBe(432);
  });

  it("boost rates: 12% US/UK, 8% Australia and elsewhere, 8% for UK/US listings created before the change", () => {
    expect(line(run(depop, "us", { price: 100, boosted: true }), "boost")).toBe(1200);
    expect(line(run(depop, "uk", { price: 100, boosted: true }), "boost")).toBe(1200);
    expect(line(run(depop, "au", { price: 100, boosted: true }), "boost")).toBe(800);
    expect(line(run(depop, "au", { price: 100, boosted: true, boostOld: true }), "boost")).toBe(800);
    expect(line(run(depop, "us", { price: 100, boosted: true, boostOld: true }), "boost")).toBe(800);
  });

  it("US shipping discounts: the seller covers the difference, processing is on what the buyer paid", () => {
    const four = run(depop, "us", { price: 30, labelPrice: 6, shippingDiscount: "4" });
    expect(line(four, "label")).toBe(400);
    expect(line(four, "processing")).toBe(151); // 3.3% × 32.00 + 0.45 = 1.506
    expect(four.payout).toBe(3000 - 400 - 151);
    const free = run(depop, "us", { price: 30, labelPrice: 6, shippingDiscount: "free" });
    expect(line(free, "label")).toBe(600);
    expect(line(free, "processing")).toBe(144); // 3.3% × 30.00 + 0.45
    // A discount larger than the label is capped at the label.
    expect(line(run(depop, "us", { price: 30, labelPrice: 3, shippingDiscount: "4" }), "label")).toBe(300);
    // Not available outside the US.
    expect(line(run(depop, "uk", { shippingDiscount: "4" }), "label")).toBe(0);
  });

  it("processing rounds half away from zero at the cent", () => {
    // UK: 2.9% × £28.50 = 0.8265 → £0.83 (+ £0.30)
    expect(line(run(depop, "uk", { price: 25, labelPrice: 3.5 }), "processing")).toBe(113);
    // US: 3.3% × $15.00 = 0.495 → $0.50 (+ $0.45); one cent less of base → 0.49467 → $0.49
    expect(line(run(depop, "us", { price: 15, labelPrice: 0 }), "processing")).toBe(95);
    expect(line(run(depop, "us", { price: 14.99, labelPrice: 0 }), "processing")).toBe(94);
  });

  it("defaults show a realistic US sale: $30 item, $6 label → $1.64 fees, keep $28.36", () => {
    const r = run(depop, "us");
    expect(r.totalFees).toBe(164);
    expect(r.payout).toBe(2836);
    expect(buyer(r, "marketplace")).toBe(250);
    expect(r.buyerPays).toBe(3850);
  });

  it("own-shipping postage counts as a cost only when you ship yourself", () => {
    expect(run(depop, "us", { itemCost: 10, shippingCost: 5 }).totalCosts).toBe(1000);
    expect(run(depop, "us", { shippingMethod: "own", itemCost: 10, shippingCost: 5 }).totalCosts).toBe(1500);
  });

  it("Australia: Depop Shipping becomes mandatory for existing sellers' new listings on 26 October 2026 (AEDT)", () => {
    expect(auDepopShippingRequired(Date.UTC(2026, 9, 25, 12, 59))).toBe(false);
    expect(auDepopShippingRequired(Date.UTC(2026, 9, 25, 13, 0))).toBe(true);
    expect(auDepopShippingRequired(Date.UTC(2026, 9, 23))).toBe(false);
  });

  it("compare mapping: buyer-paid shipping and postage cost flow through", () => {
    const m = pickMarket(depop.markets, "us", "us");
    const inputs = { ...depop.defaults(m), ...depop.compare!.map({ price: 25, shipping: 5, itemCost: 8, shippingCost: 5 }) } as Inputs;
    const r = depop.calculate(inputs, m);
    expect(line(r, "processing")).toBe(144); // 3.3% × 30.00 + 0.45 = 1.44
    expect(r.payout).toBe(3000 - 144);
    expect(r.profit).toBe(3000 - 144 - 1300);
  });

  /*
   * Reviewer cases, worked by hand (rates from "Seller fees and charges", each line rounded half away
   * from zero at the cent), not copied from the module's output.
   */
  it("hand-worked: US $19.99 + $5.49 label, 7.25% tax → tax $1.85, processing $1.35, keep $18.64", () => {
    // tax 7.25% × 25.48 = 1.8473 → 1.85; base 27.33; 3.3% × 27.33 = 0.90189 → 0.90 + 0.45
    const r = run(depop, "us", { price: 19.99, labelPrice: 5.49, salesTax: 7.25 });
    expect(line(r, "processing")).toBe(135);
    expect(r.payout).toBe(1864);
    expect(buyer(r, "marketplace")).toBe(200); // 5% × 19.99 = 0.9995 → 1.00, + 1.00
    expect(buyer(r, "marketplace-tax")).toBe(15); // 7.25% × 2.00 = 0.145 → 0.15
  });

  it("hand-worked: UK £12 + £2.99 own shipping, boosted → processing £0.73, boost £1.80, keep £12.46", () => {
    // base 14.99: 2.9% = 0.43471 → 0.43 + 0.30; 12% = 1.7988 → 1.80
    const r = run(depop, "uk", { price: 12, shippingMethod: "own", shippingCharged: 2.99, boosted: true });
    expect(line(r, "processing")).toBe(73);
    expect(line(r, "boost")).toBe(180);
    expect(r.payout).toBe(1246);
  });

  it("hand-worked: Australia A$85 + A$12.50 label, boosted → processing A$2.84 (2.535 rounds up), boost A$6.80", () => {
    // 2.6% × 97.50 = 2.535 → 2.54 + 0.30; 8% × 85.00 (label excluded) = 6.80
    const r = run(depop, "au", { price: 85, labelPrice: 12.5, boosted: true });
    expect(line(r, "processing")).toBe(284);
    expect(line(r, "boost")).toBe(680);
    expect(r.payout).toBe(7536);
    expect(buyer(r, "marketplace")).toBe(525);
    // Australian amounts print as A$, not a bare $ that reads as US dollars.
    expect(r.fees.find((l) => l.id === "processing")!.detail).toBe("2.6% × A$97.50 + A$0.30");
  });

  it("hand-worked: other countries €45 + €7, boosted, PayPal 3.4% + €0.35 → €5.20 + €4.16 + €2.12", () => {
    const r = run(depop, "other", { price: 45, shippingCharged: 7, boosted: true, paypalRate: 3.4, paypalFixed: 0.35 });
    expect(line(r, "selling")).toBe(520); // 10% × 52.00
    expect(line(r, "boost")).toBe(416); // 8% × 52.00
    expect(line(r, "paypal")).toBe(212); // 3.4% × 52.00 = 1.768 → 1.77 + 0.35
    expect(r.payout).toBe(4052);
  });

  it("hand-worked: US old listing boosted at 8%, $50 + $7 own shipping → processing $2.33, boost $4.56", () => {
    const r = run(depop, "us", { price: 50, shippingMethod: "own", shippingCharged: 7, boosted: true, boostOld: true });
    expect(line(r, "processing")).toBe(233); // 3.3% × 57 = 1.881 → 1.88 + 0.45
    expect(line(r, "boost")).toBe(456); // 8% × 57
    expect(r.payout).toBe(5011);
  });

  it("reverse mode: keeping $25 takes $26.52 (no boost) and $30.28 (boosted), worked by hand", () => {
    const m = pickMarket(depop.markets, "us", "us");
    // $26.52: 3.3% × 32.52 = 1.07316 → 1.07 + 0.45 = 1.52 → keep 25.00; $26.51 keeps 24.99.
    expect(solvePrice(depop, depop.defaults(m), m, "payout", 2500).price).toBe(2652);
    // $30.28: processing 3.3% × 36.28 = 1.19724 → 1.20 + 0.45 = 1.65; boost 12% × 30.28 = 3.6336 → 3.63.
    expect(solvePrice(depop, { ...depop.defaults(m), boosted: true }, m, "payout", 2500).price).toBe(3028);
  });

  it("reverse mode matches a cent-by-cent scan in every market", () => {
    for (const id of ["us", "uk", "au", "other"]) {
      const m = pickMarket(depop.markets, id, "us");
      for (const extra of [{}, { boosted: true }] as Partial<Inputs>[]) {
        const inputs = { ...depop.defaults(m), ...extra } as Inputs;
        for (const goal of [1000, 2500, 5000]) {
          let lowest = -1;
          for (let c = 0; c <= 10000; c++) {
            if (depop.calculate({ ...inputs, price: c / 100 }, m).payout >= goal) {
              lowest = c;
              break;
            }
          }
          expect(solvePrice(depop, inputs, m, "payout", goal).price).toBe(lowest);
        }
      }
    }
  });

  it("reverse mode finds the lowest price that pays the target", () => {
    for (const id of ["us", "uk", "au", "other"]) {
      const m = pickMarket(depop.markets, id, "us");
      for (const extra of [{}, { boosted: true, shippingMethod: "own" }] as Partial<Inputs>[]) {
        const inputs = { ...depop.defaults(m), ...extra } as Inputs;
        const s = solvePrice(depop, inputs, m, "payout", 2500);
        expect(s.price).not.toBeNull();
        expect(s.result!.payout).toBeGreaterThanOrEqual(2500);
        const below = depop.calculate({ ...inputs, price: (s.price! - 1) / 100 }, m);
        expect(below.payout).toBeLessThan(2500);
      }
    }
  });
});
