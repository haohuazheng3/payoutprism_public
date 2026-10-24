import { describe, expect, it } from "vitest";
import fb from "@/fees/platforms/facebook-marketplace";
import { solvePrice } from "@/fees/solve";
import { M } from "@/fees/markets";
import type { Inputs } from "@/fees/types";
import { checkContract, line, run } from "./helpers";

describe("facebook-marketplace", () => {
  it("meets the module contract", () => {
    expect(checkContract(fb)).toEqual([]);
  });

  it("official example: 10% × ($20 item + $5 shipping + $1 tax) = $2.60", () => {
    const r = run(fb, "us", { price: 20, shipping: 5, taxAmount: 1 });
    expect(line(r, "selling")).toBe(260);
    expect(r.buyerPays).toBe(2600);
    expect(r.payout).toBe(2000 - 260);
    // Same order with the tax entered as a rate (4% of item + shipping = $1.00)
    expect(line(run(fb, "us", { price: 20, shipping: 5, salesTax: 4 }), "selling")).toBe(260);
  });

  it("default case: $25 item, buyer pays an $8 prepaid label, 7% sales tax", () => {
    const r = run(fb, "us");
    expect(r.buyerFees.find((l) => l.id === "salestax")!.amount).toBe(231); // 7% × $33.00
    expect(line(r, "selling")).toBe(353); // 10% × $35.31 = 3.531
    expect(r.saleAmount).toBe(2500);
    expect(r.payout).toBe(2147);
    expect(r.buyerPays).toBe(3531);
  });

  it("research D1: order total under $8 pays the $0.80 minimum", () => {
    const r = run(fb, "us", { price: 4, shipping: 3.5, taxAmount: 0.3 });
    expect(line(r, "selling")).toBe(80); // 10% × $7.80 = $0.78 → $0.80
    expect(r.payout).toBe(400 - 80);
  });

  it("research D2: exactly $8.00 in total is 10% = $0.80", () => {
    expect(line(run(fb, "us", { price: 5, shipping: 2.5, taxAmount: 0.5 }), "selling")).toBe(80);
  });

  it("minimum edge: one cent below, at and above $8.00 (no shipping in the base, no tax)", () => {
    const at = (price: number) => line(run(fb, "us", { price, shippingPayer: "seller", shipping: 0, salesTax: 0 }), "selling");
    expect(at(7.99)).toBe(80);
    expect(at(8)).toBe(80);
    expect(at(8.04)).toBe(80); // 80.4 → 80
    expect(at(8.05)).toBe(81); // 80.5 → 81, half up
    expect(at(2)).toBe(80); // 40% of a $2 item
  });

  it("research D3: two items shipped together are one transaction, one minimum", () => {
    const r = run(fb, "us", { price: 45, quantity: 2, shipping: 12, taxAmount: 7.2 });
    expect(line(r, "selling")).toBe(1092); // 10% × $109.20
    expect(r.saleAmount).toBe(9000);
    // Two cheap items in one package pay one $0.80, not two
    expect(line(run(fb, "us", { price: 3, quantity: 2, shipping: 0, salesTax: 0, shippingPayer: "seller" }), "selling")).toBe(80);
  });

  it("research D4: prepaid label paid by the buyer is in the fee base but never reaches the seller", () => {
    const r = run(fb, "us", { price: 60, shipping: 9.8, taxAmount: 4.8 });
    expect(line(r, "selling")).toBe(746); // 10% × $74.60
    expect(r.payout).toBe(6000 - 746);
    expect(r.buyerFees.map((l) => l.id)).toEqual(["buyershipping", "salestax"]);
  });

  it("research D5: seller covers the label (assumption A: label not in the fee base)", () => {
    const r = run(fb, "us", { price: 60, shippingPayer: "seller", shipping: 9.8, taxAmount: 4.8 });
    expect(line(r, "selling")).toBe(648); // 10% × $64.80
    expect(line(r, "label")).toBe(980);
    expect(r.payout).toBe(6000 - 648 - 980);
    expect(r.notes.some((n) => n.includes("$7.46"))).toBe(true); // assumption B shown as the alternative
  });

  it("own label: buyer-paid shipping reaches the seller; postage is a cost", () => {
    const r = run(fb, "us", { price: 30, shippingPayer: "own", shipping: 6, salesTax: 0, shippingCost: 5.2 });
    expect(line(r, "selling")).toBe(360);
    expect(r.saleAmount).toBe(3600);
    expect(r.payout).toBe(3240);
    expect(r.profit).toBe(3240 - 520);
  });

  it("carrier adjustment is deducted on Facebook labels only", () => {
    expect(line(run(fb, "us", { adjustment: 2.15 }), "adjustment")).toBe(215);
    expect(run(fb, "us", { shippingPayer: "own", adjustment: 2.15 }).fees.some((l) => l.id === "adjustment")).toBe(false);
  });

  it("local pickup and off-checkout payments pay no Facebook fee", () => {
    const r = run(fb, "us", { saleType: "local", price: 120, itemCost: 40 });
    expect(r.totalFees).toBe(0);
    expect(r.payout).toBe(12000);
    expect(r.profit).toBe(8000);
    expect(r.buyerFees).toEqual([]);
  });

  it("warns outside the $2–$500 shipping price range", () => {
    expect(run(fb, "us", { price: 1.99 }).warnings.length).toBe(1);
    expect(run(fb, "us", { price: 2 }).warnings).toEqual([]);
    expect(run(fb, "us", { price: 500 }).warnings).toEqual([]);
    expect(run(fb, "us", { price: 500.01 }).warnings.length).toBe(1);
    expect(run(fb, "us", { price: 900, saleType: "local" }).warnings).toEqual([]);
  });

  it("minimum edge with buyer-paid shipping in the base: $3.50 label, no tax", () => {
    // Hand-computed: base = price + $3.50; fee = max(round(10% × base), $0.80)
    const at = (price: number) => run(fb, "us", { price, shipping: 3.5, salesTax: 0 });
    expect(line(at(4.49), "selling")).toBe(80); // base $7.99 → $0.799 → $0.80 minimum
    expect(line(at(4.5), "selling")).toBe(80); // base $8.00 → exactly $0.80
    expect(line(at(4.54), "selling")).toBe(80); // base $8.04 → $0.804 → $0.80
    expect(line(at(4.55), "selling")).toBe(81); // base $8.05 → $0.805 → $0.81
    expect(at(4.49).payout).toBe(369);
    expect(at(4.55).payout).toBe(374);
  });

  it("$500 ceiling with a seller-paid $15 label: no cap on the 10%", () => {
    const r = run(fb, "us", { price: 500, shippingPayer: "seller", shipping: 15, salesTax: 0 });
    expect(line(r, "selling")).toBe(5000); // 10% × $500.00
    expect(line(r, "label")).toBe(1500);
    expect(r.payout).toBe(43500); // 500 − 50 − 15
    expect(r.warnings).toEqual([]);
  });

  it("own label, 3 × $2 items, $4 shipping, 6% tax", () => {
    const r = run(fb, "us", { price: 2, quantity: 3, shippingPayer: "own", shipping: 4, salesTax: 6 });
    expect(r.buyerFees.find((l) => l.id === "salestax")!.amount).toBe(60); // 6% × $10.00
    expect(line(r, "selling")).toBe(106); // 10% × $10.60 (one order, above the minimum)
    expect(r.saleAmount).toBe(1000); // items + the shipping the buyer paid you
    expect(r.payout).toBe(894);
    expect(r.notes[0]).toContain("Add what your postage costs"); // no postage entered yet
  });

  it("seller-paid label with an exact tax amount and a carrier adjustment", () => {
    const r = run(fb, "us", { price: 45, shippingPayer: "seller", shipping: 7.5, taxAmount: 3.21, adjustment: 1.2 });
    expect(line(r, "selling")).toBe(482); // 10% × $48.21 = 4.821
    expect(r.payout).toBe(3148); // 45 − 4.82 − 7.50 − 1.20
    // If the label counts: 10% × $55.71 = $5.57, payout $30.73
    expect(r.notes[0]).toContain("$5.57");
    expect(r.notes[0]).toContain("$30.73");
  });

  it("article figures: $40 item, $8 label, 7% tax, by who pays shipping", () => {
    const buyer = run(fb, "us", { price: 40 });
    expect(line(buyer, "selling")).toBe(514); // 10% × ($40 + $8 + $3.36)
    expect(buyer.payout).toBe(3486);
    const free = run(fb, "us", { price: 40, shippingPayer: "seller" });
    expect(line(free, "selling")).toBe(428); // 10% × ($40 + $2.80)
    expect(free.payout).toBe(2772);
    const own = run(fb, "us", { price: 40, shippingPayer: "own", shippingCost: 8 });
    expect(own.payout).toBe(4286);
    expect(own.profit).toBe(3486);
    const free48 = run(fb, "us", { price: 48, shippingPayer: "seller" });
    expect(free48.payout).toBe(3486); // 48 − 5.14 − 8
    expect(free48.notes[0]).toContain("$34.06"); // 48 − 5.94 − 8 if the label counts
    // Two $10 items in one box vs two separate orders
    expect(run(fb, "us", { price: 10, quantity: 2 }).totalFees).toBe(300); // 10% × $29.96
    expect(run(fb, "us", { price: 10 }).totalFees * 2).toBe(386); // 2 × 10% × $19.26
  });

  it("breakpoint sits where 10% of the order total reaches $0.80", () => {
    const m = M.us;
    const d = fb.defaults(m);
    expect(fb.breakpoints!({ ...d, shippingPayer: "seller", shipping: 0, salesTax: 0 }, m)).toEqual([800]);
    expect(fb.breakpoints!({ ...d, shipping: 3.5, salesTax: 0 }, m)).toEqual([450]);
    expect(fb.breakpoints!(d, m)).toEqual([]); // $8 shipping alone puts every order above the minimum
    expect(fb.breakpoints!({ ...d, saleType: "local" }, m)).toEqual([]);
  });

  it("reverse mode finds the lowest price that pays the target", () => {
    const m = M.us;
    const check = (inputs: Inputs, goal: number, expected?: number) => {
      const s = solvePrice(fb, inputs, m, "payout", goal);
      expect(s.price).not.toBeNull();
      expect(s.result!.payout).toBeGreaterThanOrEqual(goal);
      expect(fb.calculate({ ...inputs, price: (s.price! - 1) / 100 }, m).payout).toBeLessThan(goal);
      if (expected !== undefined) expect(s.price).toBe(expected);
    };
    check(fb.defaults(m), 2000, 2335); // 2335 − round(10% × (2335 + 800 + 219)) = 2000
    check({ ...fb.defaults(m), shipping: 3.5, salesTax: 0 }, 370, 450); // inside the minimum, at the $4.50 breakpoint
    check({ ...fb.defaults(m), shipping: 3.5, salesTax: 0 }, 400, 483); // past it: 483 − round(83.3) = 400
    const flat = { ...fb.defaults(m), shippingPayer: "seller", shipping: 0, salesTax: 0 };
    check(flat, 650, 730); // inside the $0.80-minimum range
    check(flat, 750, 833); // across the $8.00 breakpoint
    check({ ...fb.defaults(m), saleType: "local" }, 5000, 5000);
    // Profit target, own label: price + $6 − round(10% × (price + $6)) − $5.20 postage − $10 item ≥ $10
    const own = { ...fb.defaults(m), shippingPayer: "own", shipping: 6, shippingCost: 5.2, itemCost: 10, salesTax: 0 };
    const s = solvePrice(fb, own, m, "profit", 1000);
    expect(s.price).toBe(2200);
    expect(fb.calculate({ ...own, price: 21.99 }, m).profit).toBe(999);
  });
});
