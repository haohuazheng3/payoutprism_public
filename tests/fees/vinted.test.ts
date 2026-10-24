import { describe, expect, it } from "vitest";
import vinted, { vintedFee } from "@/fees/platforms/vinted";
import { solvePrice } from "@/fees/solve";
import { M } from "@/fees/markets";
import type { Inputs } from "@/fees/types";
import { checkContract, line, run } from "./helpers";

const buyer = (r: ReturnType<typeof run>, id: string) => {
  const l = r.buyerFees.find((x) => x.id === id);
  if (!l) throw new Error(`no buyer line ${id} in ${r.buyerFees.map((x) => x.id).join(",")}`);
  return l.amount;
};
const hasBuyer = (r: ReturnType<typeof run>, id: string) => r.buyerFees.some((x) => x.id === id);

describe("vinted", () => {
  it("meets the module contract in every market", () => {
    expect(checkContract(vinted)).toEqual([]);
  });

  // Vinted publishes no worked examples (research §6). The cases below are the research's derived
  // examples D1–D7, each matching a price Vinted's own listings showed "incl." the fee on 2026-10-23.

  it("D1 UK: £10.00 item → Vinted fee £1.20 (listing shows £11.20 incl.), seller keeps £10.00", () => {
    const r = run(vinted, "uk", { price: 10 });
    expect(buyer(r, "vinted-fee")).toBe(120);
    expect(r.buyerPays).toBe(1120);
    expect(line(r, "selling")).toBe(0);
    expect(r.totalFees).toBe(0);
    expect(r.payout).toBe(1000);
  });

  it("D2 UK Kids catalogue: £20.00 → 8% + £0.30 = £1.90 (£21.90 incl.)", () => {
    const r = run(vinted, "uk", { price: 20, category: "kids" });
    expect(buyer(r, "vinted-fee")).toBe(190);
    expect(r.buyerPays).toBe(2190);
    expect(r.payout).toBe(2000);
  });

  it("D3 UK: £2,000 item → 5% + £0.70 would be £100.70; listings cap it at £75.00", () => {
    const r = run(vinted, "uk", { price: 2000 });
    expect(buyer(r, "vinted-fee")).toBe(7500);
    expect(r.buyerPays).toBe(207500);
  });

  it("D4 UK rounding, half up: £4.99 → 0.9495 → £0.95; £5.30 → 0.965 → £0.97; £1.50 → 0.775 → £0.78", () => {
    expect(vintedFee(499, M.uk).amount).toBe(95);
    expect(vintedFee(530, M.uk).amount).toBe(97);
    expect(vintedFee(150, M.uk).amount).toBe(78);
    expect(vintedFee(999, M.uk).amount).toBe(120); // £9.99 → £11.19 incl.
  });

  it("D5 France: €1,500 → €75.70, no cap (€3,000 → €150.70)", () => {
    expect(buyer(run(vinted, "fr", { price: 1500 }), "vinted-fee")).toBe(7570);
    expect(buyer(run(vinted, "fr", { price: 3000 }), "vinted-fee")).toBe(15070);
  });

  it("D6 Poland: 10 zł → 3,40 zł", () => {
    expect(buyer(run(vinted, "pl", { price: 10 }), "vinted-fee")).toBe(340);
  });

  it("D7 Australia: A$100 → A$6.00 at the 5% + A$1.00 listings charge (help page’s A$1.20 would give A$6.20)", () => {
    expect(buyer(run(vinted, "au", { price: 100 }), "vinted-fee")).toBe(600);
    expect(buyer(run(vinted, "au", { price: 10 }), "vinted-fee")).toBe(150); // A$10 → A$11.50 incl.
  });

  it("US default: $20 item → buyer pays $21.70, seller keeps $20.00; no cap at $4,000 ($200.70)", () => {
    const r = run(vinted, "us", {});
    expect(buyer(r, "vinted-fee")).toBe(170);
    expect(r.buyerPays).toBe(2170);
    expect(r.payout).toBe(2000);
    expect(buyer(run(vinted, "us", { price: 1495 }), "vinted-fee")).toBe(7545);
    expect(buyer(run(vinted, "us", { price: 4000 }), "vinted-fee")).toBe(20070);
  });

  it("Sweden and Denmark use their own fixed parts (7,50 SEK, 5 kr)", () => {
    expect(buyer(run(vinted, "se", { price: 100 }), "vinted-fee")).toBe(1250);
    expect(buyer(run(vinted, "dk", { price: 15 }), "vinted-fee")).toBe(575); // 15,00 kr → 20,75 kr incl.
  });

  it("UK cap edge: £1,485.99 and £1,486.00 both £75.00 by formula; £1,486.10 would be £75.01 → capped", () => {
    expect(vintedFee(148500, M.uk).amount).toBe(7495); // £1,485 → £1,559.95 incl.
    expect(vintedFee(148599, M.uk).amount).toBe(7500);
    expect(vintedFee(148600, M.uk).amount).toBe(7500);
    expect(vintedFee(148610, M.uk)).toMatchObject({ amount: 7500, raw: 7501, capped: true });
  });

  it("UK Kids: uncapped below £1,486 (£950 → £76.30, £1,453 → £116.54), £75.00 from £1,486", () => {
    expect(vintedFee(95000, M.uk, "kids").amount).toBe(7630);
    expect(vintedFee(145300, M.uk, "kids").amount).toBe(11654);
    expect(vintedFee(148599, M.uk, "kids").amount).toBe(11918);
    expect(vintedFee(148600, M.uk, "kids").amount).toBe(7500);
    expect(vintedFee(149500, M.uk, "kids").amount).toBe(7500); // £1,495 → £1,570.00 incl.
  });

  it("the Kids rate only exists in the UK", () => {
    expect(buyer(run(vinted, "us", { price: 20, category: "kids" }), "vinted-fee")).toBe(170);
    expect(buyer(run(vinted, "fr", { price: 1.49, category: "kids" }), "vinted-fee")).toBe(77); // €1,49 → 2,26 € incl.
  });

  it("Vinted fee is charged on the item price only, never on shipping", () => {
    const r = run(vinted, "uk", { price: 10, shippingPaid: 2.89 });
    expect(buyer(r, "vinted-fee")).toBe(120);
    expect(buyer(r, "shipping")).toBe(289);
    expect(r.buyerPays).toBe(1000 + 120 + 289);
    expect(r.payout).toBe(1000);
  });

  it("Bump and a Showcase share are the seller’s only costs", () => {
    const r = run(vinted, "uk", { price: 25, bump: 1.6, showcase: 6.95, showcaseSales: 3 });
    expect(line(r, "bump")).toBe(160);
    expect(line(r, "showcase")).toBe(232); // £6.95 ÷ 3 = 2.3167
    expect(r.totalFees).toBe(392);
    expect(r.payout).toBe(2500 - 392);
    expect(buyer(r, "vinted-fee")).toBe(195); // 5% × 25 + 0.70
  });

  it("Item Verification: UK £10 from an £85 item price (one cent below: not offered)", () => {
    expect(hasBuyer(run(vinted, "uk", { price: 84.99, itemVerification: true }), "item-verification")).toBe(false);
    const r = run(vinted, "uk", { price: 85, itemVerification: true });
    expect(buyer(r, "item-verification")).toBe(1000);
    expect(buyer(r, "vinted-fee")).toBe(495);
    expect(r.buyerPays).toBe(8500 + 495 + 1000);
    expect(r.payout).toBe(8500);
    expect(buyer(run(vinted, "de", { price: 100, itemVerification: true }), "item-verification")).toBe(1000);
    expect(buyer(run(vinted, "pl", { price: 450, itemVerification: true }), "item-verification")).toBe(4500);
    expect(hasBuyer(run(vinted, "us", { price: 500, itemVerification: true }), "item-verification")).toBe(false);
  });

  it("Electronics Verification: £5 UK, €5 euro countries, 20 zł Poland; not offered in the US or Australia", () => {
    expect(buyer(run(vinted, "uk", { electronicsVerification: true }), "electronics-verification")).toBe(500);
    expect(buyer(run(vinted, "at", { electronicsVerification: true }), "electronics-verification")).toBe(500);
    expect(buyer(run(vinted, "pl", { electronicsVerification: true }), "electronics-verification")).toBe(2000);
    expect(hasBuyer(run(vinted, "us", { electronicsVerification: true }), "electronics-verification")).toBe(false);
    expect(hasBuyer(run(vinted, "au", { electronicsVerification: true }), "electronics-verification")).toBe(false);
  });

  it("profit counts the seller’s own costs", () => {
    const r = run(vinted, "uk", { price: 12, itemCost: 4, otherCost: 0.5 });
    expect(r.profit).toBe(1200 - 450);
  });

  it("compare mapping: US, buyer pays the label, no selling fee", () => {
    const m = M.us;
    const inputs = { ...vinted.defaults(m), ...vinted.compare!.map({ price: 30, shipping: 5, itemCost: 10, shippingCost: 5 }) } as Inputs;
    const r = vinted.calculate(inputs, m);
    expect(r.payout).toBe(3000);
    expect(r.profit).toBe(2000);
    expect(r.buyerPays).toBe(3000 + 220 + 500);
  });

  it("reverse mode finds the lowest price that pays the target, Bump included", () => {
    const m = M.uk;
    const inputs = { ...vinted.defaults(m), bump: 1.5 };
    const s = solvePrice(vinted, inputs, m, "payout", 2000);
    expect(s.price).toBe(2150);
    expect(s.result!.payout).toBeGreaterThanOrEqual(2000);
    expect(vinted.calculate({ ...inputs, price: (s.price! - 1) / 100 }, m).payout).toBeLessThan(2000);
  });

  // Re-read by the reviewer on Vinted's own listings, 2026-10-23 (item price → price shown "incl."):
  // fee = item × rate rounded half up to the cent, plus the fixed part, worked out by hand.
  it("matches listing totals read on 2026-10-23 in the UK, US and Australia", () => {
    expect(vintedFee(10000, M.uk).amount).toBe(570); // UK Electronics £100.00 → £105.70
    expect(vintedFee(500, M.uk).amount).toBe(95); // UK Books & Media £5.00 → £5.95
    expect(vintedFee(146402, M.uk).amount).toBe(7390); // £1,464.02 → £1,537.92 (73.201 → 73.20 + 0.70)
    expect(vintedFee(148798, M.uk).amount).toBe(7500); // £1,487.98 → £1,562.98
    expect(vintedFee(1000, M.uk, "kids").amount).toBe(110); // Kids £10.00 → £11.10
    expect(vintedFee(90000, M.uk, "kids").amount).toBe(7230); // Kids £900.00 → £972.30
    expect(vintedFee(143200, M.uk, "kids").amount).toBe(11486); // Kids £1,432.00 → £1,546.86
    expect(vintedFee(160000, M.us).amount).toBe(8070); // US $1,600.00 → $1,680.70
    expect(vintedFee(395000, M.us).amount).toBe(19820); // US $3,950.00 → $4,148.20, no cap
    expect(vintedFee(2000, M.au).amount).toBe(200); // AU A$20.00 → A$22.00 (also in Kids)
  });

  it("Kids items between £1,453 and £1,495 get a note: the cap's start isn't confirmed there", () => {
    const flagged = (p: number) => run(vinted, "uk", { price: p, category: "kids" }).notes.some((n) => n.includes("£1,453 and £1,495"));
    expect(flagged(1453)).toBe(false);
    expect(flagged(1460)).toBe(true);
    expect(flagged(1494.99)).toBe(true);
    expect(flagged(1495)).toBe(false);
    expect(run(vinted, "uk", { price: 1460 }).notes.some((n) => n.includes("£1,453"))).toBe(false);
  });

  it("Showcase isn't offered in the US or Australia: field hidden and any carried-over amount ignored", () => {
    const sc = vinted.fields.find((f) => f.id === "showcase")!;
    expect(sc.showIf!(vinted.defaults(M.us), M.us)).toBe(false);
    expect(sc.showIf!(vinted.defaults(M.au), M.au)).toBe(false);
    expect(sc.showIf!(vinted.defaults(M.uk), M.uk)).toBe(true);
    const us = run(vinted, "us", { price: 25, showcase: 6.95 });
    expect(us.fees.some((l) => l.id === "showcase")).toBe(false);
    expect(us.payout).toBe(2500);
    expect(run(vinted, "au", { price: 25, showcase: 6.95 }).payout).toBe(2500);
    expect(line(run(vinted, "fr", { price: 25, showcase: 6.95 }), "showcase")).toBe(695);
  });

  it("Item Verification in euro countries: €10 from €100 (one cent below: not offered); not in Austria, Ireland or Greece", () => {
    expect(hasBuyer(run(vinted, "fr", { price: 99.99, itemVerification: true }), "item-verification")).toBe(false);
    expect(buyer(run(vinted, "fr", { price: 100, itemVerification: true }), "item-verification")).toBe(1000);
    expect(buyer(run(vinted, "se", { price: 1100, itemVerification: true }), "item-verification")).toBe(12000);
    expect(buyer(run(vinted, "dk", { price: 740, itemVerification: true }), "item-verification")).toBe(8000);
    for (const m of ["at", "ie", "gr"]) expect(hasBuyer(run(vinted, m, { price: 500, itemVerification: true }), "item-verification")).toBe(false);
    for (const m of ["ie", "gr"]) expect(hasBuyer(run(vinted, m, { electronicsVerification: true }), "electronics-verification")).toBe(false);
  });

  it("reverse mode also solves for profit and margin (no breakpoints: the seller's take is linear in the price)", () => {
    const m = M.us;
    const inputs = { ...vinted.defaults(m), bump: 2, itemCost: 5 };
    expect(vinted.breakpoints!(inputs, m)).toEqual([]);
    const profit = solvePrice(vinted, inputs, m, "profit", 1000); // price − $2 Bump − $5 cost ≥ $10
    expect(profit.price).toBe(1700);
    expect(vinted.calculate({ ...inputs, price: 16.99 }, m).profit).toBe(999);
    const margin = solvePrice(vinted, inputs, m, "margin", 0.5); // (p − 700) / p ≥ 0.5 → p ≥ $14.00
    expect(margin.price).toBe(1400);
    expect(vinted.calculate({ ...inputs, price: 13.99 }, m).margin!).toBeLessThan(0.5);
  });
});
