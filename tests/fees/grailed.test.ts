import { describe, expect, it } from "vitest";
import grailed, { commission } from "@/fees/platforms/grailed";
import { solvePrice } from "@/fees/solve";
import { M, pickMarket } from "@/fees/markets";
import { formatMoney } from "@/fees/money";
import { checkContract, line, run } from "./helpers";

/*
 * Grailed publishes no worked examples with numbers (help center, ToS, Patch Notes), so every case
 * below is derived from the official rules; D-1…D-6 are the research file's derived examples.
 */
describe("grailed", () => {
  it("meets the module contract in every market", () => {
    expect(checkContract(grailed)).toEqual([]);
  });

  it("every market computes in US dollars (all purchases on Grailed are in USD)", () => {
    for (const m of grailed.markets) expect(grailed.calculate(grailed.defaults(m), m).currency).toBe("USD");
  });

  it("D-1: $100 item, $10 Grailed Label, 8% tax on $110 → commission $6.00 (item only), processing on $118.80", () => {
    const r = run(grailed, "us", { price: 100, labelCost: 10, salesTax: 8 });
    expect(r.buyerPays).toBe(11880);
    expect(r.saleAmount).toBe(10000);
    expect(line(r, "commission")).toBe(600);
    expect(line(r, "processing")).toBe(464); // 3.49% × 118.80 + 0.49 = 4.63612
    expect(r.payout).toBe(8936);
  });

  it("D-2: the $120 cliff with a $10 label: $119.00, $119.99 and $120.00", () => {
    const a = run(grailed, "us", { price: 119, labelCost: 10 });
    expect(line(a, "commission")).toBe(714);
    expect(line(a, "processing")).toBe(499);
    expect(a.payout).toBe(10687);
    const b = run(grailed, "us", { price: 119.99, labelCost: 10 });
    expect(line(b, "commission")).toBe(720); // 6% × 119.99 = 7.1994
    expect(line(b, "processing")).toBe(503); // 3.49% × 129.99 + 0.49 = 5.0267
    expect(b.payout).toBe(10776);
    const c = run(grailed, "us", { price: 120, labelCost: 10 });
    expect(line(c, "commission")).toBe(1080); // 9% from $120.00
    expect(line(c, "processing")).toBe(503);
    expect(c.payout).toBe(10417);
    expect(c.notes[0]).toContain("$119.99");
    expect(c.notes[0]).toContain("$3.59 more");
    const d = run(grailed, "us", { price: 124.11, labelCost: 10 });
    expect(line(d, "commission")).toBe(1117);
    expect(line(d, "processing")).toBe(517);
    expect(d.payout).toBe(10777);
  });

  it("D-3: $1.99 minimum commission, Stripe connected vs not connected", () => {
    const r = run(grailed, "us", { price: 25, labelCost: 7 });
    expect(line(r, "commission")).toBe(199); // 6% × 25 = 1.50 → 1.99
    expect(line(r, "processing")).toBe(161); // 3.49% × 32 + 0.49
    expect(r.payout).toBe(2140);
    const n = run(grailed, "us", { price: 25, labelCost: 7, stripe: "none" });
    expect(line(n, "processing")).toBe(211); // 3.49% × 32 + 0.99
    expect(n.payout).toBe(2090);
  });

  it("D-4: own label, $100 + $20 shipping is a $120 sale price (9%); the same on a Grailed Label stays at 6%", () => {
    const own = run(grailed, "us", { price: 100, shippingMethod: "own", shippingCharged: 20 });
    expect(own.saleAmount).toBe(12000);
    expect(line(own, "commission")).toBe(1080);
    expect(line(own, "processing")).toBe(468);
    expect(own.payout).toBe(10452);
    const label = run(grailed, "us", { price: 100, shippingMethod: "label", labelCost: 20 });
    expect(line(label, "commission")).toBe(600);
    expect(line(label, "processing")).toBe(468);
    expect(label.payout).toBe(8932);
  });

  it("D-5: UK seller, $80 + $25 own shipping, international payment, 20% VAT on commission", () => {
    const r = run(grailed, "uk", { price: 80, shippingCharged: 25, buyer: "intl", vatOnFees: true });
    expect(line(r, "commission")).toBe(630);
    expect(line(r, "vat")).toBe(126);
    expect(line(r, "processing")).toBe(573); // 4.99% × 105 + 0.49 = 5.7295
    expect(r.payout).toBe(9171);
    const noVat = run(grailed, "uk", { price: 80, shippingCharged: 25, buyer: "intl", vatOnFees: false });
    expect(noVat.fees.some((l) => l.id === "vat")).toBe(false);
    expect(noVat.payout).toBe(9297);
  });

  it("D-6: $500 item with a $15 label", () => {
    const r = run(grailed, "us", { price: 500, labelCost: 15 });
    expect(line(r, "commission")).toBe(4500);
    expect(line(r, "processing")).toBe(1846); // 3.49% × 515 + 0.49 = 18.4635
    expect(r.payout).toBe(43654);
  });

  it("commission tiers: one cent below and at each edge", () => {
    expect(commission(11999)).toEqual({ amount: 720, rate: 6, minimum: false });
    expect(commission(12000)).toEqual({ amount: 1080, rate: 9, minimum: false });
    expect(commission(3307)).toEqual({ amount: 199, rate: 6, minimum: true }); // 6% = 1.9842 → 1.98 < 1.99
    expect(commission(3309)).toEqual({ amount: 199, rate: 6, minimum: false }); // 6% = 1.9854 → 1.99
    expect(commission(3325).amount).toBe(200); // 6% = 1.995 → 2.00
    expect(commission(0).amount).toBe(0);
  });

  it("own label: shipping counts toward the $120 line ($99.99 + $20 vs $100 + $20)", () => {
    const below = run(grailed, "us", { price: 99.99, shippingMethod: "own", shippingCharged: 20 });
    expect(line(below, "commission")).toBe(720);
    const at = run(grailed, "us", { price: 100, shippingMethod: "own", shippingCharged: 20 });
    expect(line(at, "commission")).toBe(1080);
  });

  it("international buyer: US seller ships on their own label, 4.99% + $0.49 with Stripe, 5.49% + $0.99 without", () => {
    const r = run(grailed, "us", { price: 100, buyer: "intl", shippingMethod: "label", shippingCharged: 30 });
    expect(r.saleAmount).toBe(13000);
    expect(line(r, "commission")).toBe(1170);
    expect(line(r, "processing")).toBe(698); // 4.99% × 130 + 0.49 = 6.977
    const n = run(grailed, "us", { price: 100, buyer: "intl", shippingCharged: 30, stripe: "none" });
    expect(line(n, "processing")).toBe(813); // 5.49% × 130 + 0.99 = 8.127
  });

  it("country without Stripe: 4.99% + $0.49 even for a US buyer", () => {
    const r = run(grailed, "other", { price: 100, shippingCharged: 30, stripeOther: "unsupported" });
    expect(line(r, "processing")).toBe(698);
    const connected = run(grailed, "other", { price: 100, shippingCharged: 30 });
    expect(line(connected, "processing")).toBe(503); // 3.49% × 130 + 0.49
  });

  it("VAT/GST on commission: EU at the typed rate, Australia 10%, New Zealand/Norway typed under other countries", () => {
    const eu = run(grailed, "eu", { price: 80, shippingCharged: 25, vatRate: 19 });
    expect(line(eu, "vat")).toBe(120); // 19% × 6.30 = 1.197
    const au = run(grailed, "au", { price: 80, shippingCharged: 30 });
    expect(line(au, "commission")).toBe(660);
    expect(line(au, "vat")).toBe(66);
    const nz = run(grailed, "other", { price: 80, shippingCharged: 30, vatOther: 15 });
    expect(line(nz, "vat")).toBe(99);
    expect(run(grailed, "other", { price: 80, shippingCharged: 30 }).fees.some((l) => l.id === "vat")).toBe(false);
  });

  it("free shipping deducts the label from the payout; over $750 the $4 signature is added", () => {
    const free = run(grailed, "us", { price: 100, shippingMethod: "free", labelCost: 10 });
    expect(line(free, "label")).toBe(1000);
    expect(line(free, "processing")).toBe(398); // 3.49% × 100 + 0.49: the buyer pays no shipping
    expect(free.payout).toBe(10000 - 600 - 398 - 1000);
    const at750 = run(grailed, "us", { price: 750, shippingMethod: "free", labelCost: 15 });
    expect(line(at750, "label")).toBe(1500);
    const over = run(grailed, "us", { price: 750.01, shippingMethod: "free", labelCost: 15 });
    expect(line(over, "label")).toBe(1900);
    const buyerPaid = run(grailed, "us", { price: 750.01, labelCost: 15 });
    expect(buyerPaid.buyerPays).toBe(75001 + 1900);
    expect(line(buyerPaid, "processing")).toBe(Math.round(0.0349 * 76901) + 49);
  });

  it("Canada: Grailed Label to US buyers under $750, own label from $750", () => {
    const under = run(grailed, "ca", { price: 749.99, labelCost: 15, shippingCharged: 25 });
    expect(under.saleAmount).toBe(74999);
    expect(line(under, "label")).toBe(0);
    const at = run(grailed, "ca", { price: 750, labelCost: 15, shippingCharged: 25 });
    expect(at.saleAmount).toBe(77500);
    expect(line(at, "commission")).toBe(6975);
    expect(at.notes.some((n) => n.includes("under $750"))).toBe(true);
  });

  it("own-label postage is a cost only when you ship on your own label", () => {
    const label = run(grailed, "us", { itemCost: 40, shippingCost: 9 });
    expect(label.totalCosts).toBe(4000);
    const own = run(grailed, "us", { shippingMethod: "own", shippingCharged: 12, itemCost: 40, shippingCost: 9 });
    expect(own.totalCosts).toBe(4900);
  });

  it("reverse mode finds the lowest price for the default case", () => {
    const m = M.us;
    const inputs = grailed.defaults(m);
    const s = solvePrice(grailed, inputs, m, "payout", 5000);
    expect(s.price).not.toBeNull();
    expect(s.result!.payout).toBeGreaterThanOrEqual(5000);
    expect(grailed.calculate({ ...inputs, price: (s.price! - 1) / 100 }, m).payout).toBeLessThan(5000);
  });

  it("reverse mode across the $120 cliff: $107.76 is reachable at $119.99, $107.77 needs $124.11", () => {
    const m = M.us;
    const inputs = { ...grailed.defaults(m), labelCost: 10 };
    expect(solvePrice(grailed, inputs, m, "payout", 10776).price).toBe(11999);
    const s = solvePrice(grailed, inputs, m, "payout", 10777);
    expect(s.price).toBe(12411);
    expect(grailed.calculate({ ...inputs, price: 124.1 }, m).payout).toBeLessThan(10777);
  });

  it("reverse mode across the cliff with own shipping (UK, $25 shipping charged)", () => {
    const m = pickMarket(grailed.markets, "uk", "us");
    const inputs = grailed.defaults(m);
    const atEdge = grailed.calculate({ ...inputs, price: 94.99 }, m).payout;
    const s = solvePrice(grailed, inputs, m, "payout", atEdge + 1);
    expect(s.price).not.toBeNull();
    expect(s.price!).toBeGreaterThan(9500);
    expect(s.result!.payout).toBeGreaterThanOrEqual(atEdge + 1);
    expect(grailed.calculate({ ...inputs, price: (s.price! - 1) / 100 }, m).payout).toBeLessThan(atEdge + 1);
  });
  it("reverse mode across the $4 signature drop over $750 (US, $15 label paid by the buyer)", () => {
    // $750.00: 9% = $67.50; 3.49% × $765.00 = $26.6985 → $26.70 + $0.49; keep $655.31.
    // $750.01: the $4 signature joins the label, so processing is 3.49% × $769.01 + $0.49 = $27.33; keep $655.18.
    // $750.16: 9% = $67.5144 → $67.51; 3.49% × $769.16 = $26.8437 → $26.84 + $0.49; keep $655.32.
    const m = M.us;
    const inputs = { ...grailed.defaults(m), labelCost: 15 };
    expect(grailed.calculate({ ...inputs, price: 750 }, m).payout).toBe(65531);
    expect(grailed.calculate({ ...inputs, price: 750.01 }, m).payout).toBe(65518);
    expect(solvePrice(grailed, inputs, m, "payout", 65531).price).toBe(75000);
    expect(solvePrice(grailed, inputs, m, "payout", 65532).price).toBe(75016);
    expect(grailed.calculate({ ...inputs, price: 750.15 }, m).payout).toBe(65531);
  });

  it("other countries, Stripe not set up, buyer abroad: 5.49% + $0.99, typed 25% VAT (Norway)", () => {
    // Sale price $80 + $30 = $110 → 6% = $6.60; VAT 25% = $1.65; processing 5.49% × $110 = $6.039 → $6.04 + $0.99.
    const r = run(grailed, "other", { price: 80, shippingCharged: 30, stripeOther: "none", buyer: "intl", vatOther: 25 });
    expect(line(r, "commission")).toBe(660);
    expect(line(r, "vat")).toBe(165);
    expect(line(r, "processing")).toBe(703);
    expect(r.payout).toBe(11000 - 660 - 165 - 703);
  });

  it("non-US markets print amounts as US dollars (US$), never a bare local symbol", () => {
    for (const m of grailed.markets.filter((x) => x.id !== "us")) expect(formatMoney(10500, m.currency, m.locale)).toBe("US$105.00");
  });
});
