import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import mercari, { ENVELOPE, LABEL_RATES, MEDIA_MAIL, envelopePromoActive, freeShipping50Active } from "@/fees/platforms/mercari";
import { solvePrice } from "@/fees/solve";
import { M } from "@/fees/markets";
import type { Inputs, Result } from "@/fees/types";
import { checkContract, line, run } from "./helpers";

const buyerLine = (r: Result, id: string) => {
  const l = r.buyerFees.find((x) => x.id === id);
  if (!l) throw new Error(`no buyer line ${id}`);
  return l.amount;
};

describe("mercari", () => {
  it("meets the module contract", () => {
    expect(checkContract(mercari)).toEqual([]);
  });

  // Mercari publishes no worked examples with inputs and outputs (research §6); the cases below are
  // the research file's derived examples D1–D5, computed from the official rules.

  it("D1: $40 item, buyer pays a $7.99 label: 10% of $47.99 = $4.80, buyer pays $49.72", () => {
    const r = run(mercari, "us", { price: 40, shippingPayer: "buyer", labelPrice: 7.99 });
    expect(line(r, "selling")).toBe(480); // 10% × 47.99 = 4.799
    expect(r.fees).toHaveLength(1);
    expect(r.payout).toBe(3520);
    expect(buyerLine(r, "buyershipping")).toBe(799);
    expect(buyerLine(r, "buyerprotection")).toBe(173); // 3.6% × 47.99 = 1.72764
    expect(r.buyerPays).toBe(4972);
    expect(r.saleAmount).toBe(4000);
    expect(r.effectiveRate).toBeCloseTo(0.12, 10);
  });

  it("D2: $25 item, seller pays a $5.99 label: fee on the item only, label deducted", () => {
    const r = run(mercari, "us", { price: 25, shippingPayer: "seller", labelPrice: 5.99 });
    expect(line(r, "selling")).toBe(250);
    expect(line(r, "label")).toBe(599);
    expect(r.payout).toBe(1651);
    expect(buyerLine(r, "buyerprotection")).toBe(90);
    expect(r.buyerFees.some((l) => l.id === "buyershipping")).toBe(false);
    expect(r.buyerPays).toBe(2590);
  });

  it("D3: $100 item, buyer pays $24.99 (UPS Ground 10 lb Standard), Instant Pay $3", () => {
    const r = run(mercari, "us", { price: 100, labelPrice: 24.99, cashOut: "instant" });
    expect(line(r, "selling")).toBe(1250); // 10% × 124.99 = 12.499
    expect(line(r, "instantpay")).toBe(300);
    expect(r.payout).toBe(8450);
    expect(buyerLine(r, "buyerprotection")).toBe(450); // 3.6% × 124.99 = 4.49964
    expect(r.buyerPays).toBe(12949);
    expect(run(mercari, "us", { price: 100, labelPrice: 24.99, cashOut: "deposit" }).payout).toBe(8750);
  });

  it("D4: reverse mode, keep $50 with a $7.99 buyer-paid label → $56.44 (a cent below falls short)", () => {
    const m = M.us;
    const inputs = { ...mercari.defaults(m), labelPrice: 7.99 };
    const s = solvePrice(mercari, inputs, m, "payout", 5000);
    expect(s.price).toBe(5644);
    expect(s.result!.payout).toBe(5000); // 10% × 64.43 = 6.443 → 6.44
    expect(mercari.calculate({ ...inputs, price: 56.43 }, m).payout).toBeLessThan(5000);
    // Free shipping with the same label needs the label added to the price.
    const seller = solvePrice(mercari, { ...inputs, shippingPayer: "seller" }, m, "payout", 5000);
    expect(seller.price).toBe(6443);
  });

  it("D5: cancelation fee note is 5% of the item price, capped at $25", () => {
    expect(run(mercari, "us", { price: 300 }).notes.join(" ")).toContain("$15.00 on this one");
    expect(run(mercari, "us", { price: 800, shippingPayer: "seller", labelPrice: 0 }).notes.join(" ")).toContain("$25.00 on this one");
    expect(run(mercari, "us", { price: 499.99, shippingPayer: "seller", labelPrice: 0 }).notes.join(" ")).toContain("$25.00 on this one");
    expect(run(mercari, "us", { price: 499.8, shippingPayer: "seller", labelPrice: 0 }).notes.join(" ")).toContain("$24.99 on this one");
  });

  it("default: a $30 item with a $7.99 buyer-paid label keeps $26.20", () => {
    const r = run(mercari, "us");
    expect(line(r, "selling")).toBe(380); // 10% × 37.99 = 3.799
    expect(r.payout).toBe(2620);
    expect(r.buyerPays).toBe(3000 + 799 + 137);
    expect(r.profit).toBeNull();
  });

  it("free shipping at price + label pays exactly the same as buyer-paid shipping", () => {
    for (const [p, l] of [[10, 5.39], [40, 7.99], [123.45, 13.09], [999, 120]] as const) {
      const a = run(mercari, "us", { price: p, shippingPayer: "buyer", labelPrice: l });
      const b = run(mercari, "us", { price: Math.round((p + l) * 100) / 100, shippingPayer: "seller", labelPrice: l });
      expect(b.payout).toBe(a.payout);
      expect(b.buyerPays).toBe(a.buyerPays);
    }
  });

  it("ship on your own: no label in the fee base or deductions; postage is a cost", () => {
    const r = run(mercari, "us", { price: 30, shippingPayer: "own", labelPrice: 7.99, ownPostage: 6, shippingAdjustment: 2 });
    expect(line(r, "selling")).toBe(300);
    expect(r.fees).toHaveLength(1);
    expect(r.payout).toBe(2700);
    expect(r.costs.find((c) => c.id === "shippingCost")!.amount).toBe(600);
    expect(r.profit).toBe(2100);
    expect(r.buyerPays).toBe(3000 + 108);
  });

  it("own postage is ignored unless shipping on your own", () => {
    const r = run(mercari, "us", { ownPostage: 6 });
    expect(r.costs).toHaveLength(0);
  });

  it("shipping adjustment is deducted from earnings whoever paid the label", () => {
    const r = run(mercari, "us", { price: 40, labelPrice: 7.99, shippingAdjustment: 5.1 });
    expect(line(r, "adjustment")).toBe(510);
    expect(line(r, "selling")).toBe(480); // the adjustment isn't part of the 10% base
    expect(r.payout).toBe(4000 - 480 - 510);
  });

  it("Authenticate is a cost charged to the card, not a deduction from the sale", () => {
    const r = run(mercari, "us", { price: 300, authenticate: "cert", itemCost: 150 });
    expect(r.costs.find((c) => c.id === "authenticate")!.amount).toBe(1500);
    expect(r.payout).toBe(30000 - line(r, "selling"));
    expect(r.profit).toBe(r.payout - 15000 - 1500);
    expect(run(mercari, "us", { authenticate: "auth" }).costs.find((c) => c.id === "authenticate")!.amount).toBe(500);
  });

  it("price limits: $1 minimum, $2,000 (or $5,000 authenticated) maximum", () => {
    expect(run(mercari, "us", { price: 0.99 }).warnings).toHaveLength(1);
    expect(run(mercari, "us", { price: 1 }).warnings).toHaveLength(0);
    expect(run(mercari, "us", { price: 2000 }).warnings).toHaveLength(0);
    expect(run(mercari, "us", { price: 2000.01 }).warnings).toHaveLength(1);
    expect(run(mercari, "us", { price: 2000.01, authenticate: "auth" }).warnings).toHaveLength(0);
    expect(run(mercari, "us", { price: 5000, authenticate: "auth" }).warnings).toHaveLength(0);
    expect(run(mercari, "us", { price: 5000.01, authenticate: "auth" }).warnings).toHaveLength(1);
  });

  it("Instant Pay over $600 in one cash-out gets the monthly-limit note", () => {
    expect(run(mercari, "us", { price: 666.67, labelPrice: 0, cashOut: "instant" }).notes.join(" ")).not.toContain("limited to $600");
    expect(run(mercari, "us", { price: 666.68, labelPrice: 0, cashOut: "instant" }).notes.join(" ")).toContain("limited to $600");
  });

  it("holiday promotions switch off on their end dates", () => {
    expect(freeShipping50Active(Date.UTC(2026, 9, 22, 15, 59))).toBe(false);
    expect(freeShipping50Active(Date.UTC(2026, 9, 22, 16, 0))).toBe(true);
    expect(freeShipping50Active(Date.UTC(2027, 0, 5, 0, 59))).toBe(true); // 4:59 p.m. PT Jan 4
    expect(freeShipping50Active(Date.UTC(2027, 0, 5, 1, 0))).toBe(false);
    expect(envelopePromoActive(Date.UTC(2027, 0, 5, 7, 59))).toBe(true); // 11:59 p.m. PT Jan 4
    expect(envelopePromoActive(Date.UTC(2027, 0, 5, 8, 0))).toBe(false);
  });

  it("label table matches the published 2026-10-19 prices (spot checks)", () => {
    expect(LABEL_RATES.uspsGround["1"]).toEqual([799, 899]);
    expect(LABEL_RATES.upsGround["100"]).toEqual([12000, 35099]);
    expect(LABEL_RATES.fedexHome["100"]).toEqual([12000, 37599]);
    expect(LABEL_RATES.uspsPriority["20"]).toEqual([6799, 6999]);
    expect(Object.keys(LABEL_RATES.upsSurePost)).toHaveLength(8);
    expect(MEDIA_MAIL).toEqual({ "1": 447, "2": 522, "3": 597 });
    expect(ENVELOPE.promo).toEqual({ "1": 0, "2": 49, "3": 49 });
    // UPS SurePost and FedEx Economy share prices up to 5 lb.
    for (const [w, v] of Object.entries(LABEL_RATES.upsSurePost)) expect(LABEL_RATES.fedexEconomy[w as keyof typeof LABEL_RATES.fedexEconomy]).toEqual(v);
  });

  it("the article's label table equals the module's label data", () => {
    const mdx = fs.readFileSync(path.join(process.cwd(), "content/calculators/mercari.mdx"), "utf8");
    const rows = [...mdx.matchAll(/^\| (\d+ oz|\d+ lb) \| (.+) \|$/gm)];
    expect(rows.length).toBe(9);
    const cents = (s: string) => Math.round(Number(s.replace("$", "")) * 100);
    const services = ["uspsGround", "fedexEconomy", "upsGround"] as const;
    for (const [, weight, rest] of rows) {
      const lb = weight.endsWith("oz") ? String(Number(weight.split(" ")[0]) / 16) : weight.split(" ")[0];
      rest.split(" | ").forEach((cell, i) => {
        const table = LABEL_RATES[services[i]] as Record<string, readonly [number, number]>;
        if (cell === "—") return expect(table[lb]).toBeUndefined();
        const [best, standard] = cell.split(" / ").map(cents);
        expect([best, standard]).toEqual([...table[lb]]);
      });
    }
  });

  // Review cases (2026-10-23), worked by hand from the official rules: 10% and 3.6% of item + buyer-paid
  // shipping, each line rounded half up to the cent; seller-paid labels and Instant Pay deducted.
  it("hand-computed cases across shipping options, rounding and the price limits", () => {
    const cases: [Partial<Inputs>, { selling: number; payout: number; protection: number; buyerPays: number; profit?: number }][] = [
      [{ price: 15, labelPrice: 5.39 }, { selling: 204, payout: 1296, protection: 73, buyerPays: 2112 }], // 2.039 / 0.73404
      [{ price: 49.99, labelPrice: 7.99 }, { selling: 580, payout: 4419, protection: 209, buyerPays: 6007 }], // 5.798 / 2.08728
      [{ price: 100, shippingPayer: "seller", labelPrice: 15.99, cashOut: "instant" }, { selling: 1000, payout: 7101, protection: 360, buyerPays: 10360 }],
      [{ price: 12.35, shippingPayer: "own", labelPrice: 9, ownPostage: 4.5 }, { selling: 124, payout: 1111, protection: 44, buyerPays: 1279, profit: 661 }], // 1.235 half up
      [{ price: 2000, labelPrice: 120 }, { selling: 21200, payout: 178800, protection: 7632, buyerPays: 219632 }], // UPS Ground 100 lb Best
      [{ price: 1, labelPrice: 0.49 }, { selling: 15, payout: 85, protection: 5, buyerPays: 154 }], // 2–3 oz envelope
      [{ price: 1, labelPrice: 0 }, { selling: 10, payout: 90, protection: 4, buyerPays: 104 }], // free 1 oz envelope
    ];
    for (const [o, e] of cases) {
      const r = run(mercari, "us", o);
      expect(line(r, "selling")).toBe(e.selling);
      expect(r.payout).toBe(e.payout);
      expect(buyerLine(r, "buyerprotection")).toBe(e.protection);
      expect(r.buyerPays).toBe(e.buyerPays);
      if (e.profit !== undefined) expect(r.profit).toBe(e.profit);
    }
  });

  it("reverse mode for profit and margin targets", () => {
    const m = M.us;
    // Profit $20 on a $10 item, buyer pays $5.39: 0.9P ≥ $30.539 → $33.93 (10% × 39.32 = 3.932 → 3.93).
    const p = solvePrice(mercari, { ...mercari.defaults(m), labelPrice: 5.39, itemCost: 10 }, m, "profit", 2000);
    expect(p.price).toBe(3393);
    expect(p.result!.profit).toBe(2000);
    // 50% margin on a $10 item with a $7.99 label you pay: 0.4P ≥ $17.99 → $44.98 (profit $22.49).
    const g = solvePrice(mercari, { ...mercari.defaults(m), shippingPayer: "seller", labelPrice: 7.99, itemCost: 10 }, m, "margin", 0.5);
    expect(g.price).toBe(4498);
    expect(g.result!.profit).toBe(2249);
    expect(run(mercari, "us", { shippingPayer: "seller", labelPrice: 7.99, itemCost: 10, price: 44.97 }).margin!).toBeLessThan(0.5);
  });

  describe("date-driven notes and schedule", () => {
    afterEach(() => {
      vi.useRealTimers();
    });
    const at = (ms: number) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(ms);
    };
    const notes = (o: Partial<Inputs>) => run(mercari, "us", o).notes.join(" ");

    it("free shipping on $50+ shows from $50.00 during the promotion only", () => {
      at(Date.UTC(2026, 9, 23, 19, 0));
      expect(notes({ price: 49.99, labelPrice: 7.99 })).toContain("price it at $57.98");
      expect(notes({ price: 50, labelPrice: 7.99 })).toContain("Until January 4, 2027, the buyer gets this shipping free");
      expect(notes({ price: 60, shippingPayer: "seller", labelPrice: 7.99 })).toContain("about $53.20 instead of $46.01");
      at(Date.UTC(2027, 0, 5, 1, 0)); // 5:00 p.m. PT on Jan 4: over
      expect(notes({ price: 50, labelPrice: 7.99 })).toContain("price it at $57.99, set shipping to “Me”, and you still keep $44.20");
      expect(notes({ price: 60, shippingPayer: "seller", labelPrice: 7.99 })).toContain("list at $52.01 with the buyer paying the $7.99 label and you still keep $46.01");
      // The numbers themselves don't depend on the date.
      expect(run(mercari, "us", { price: 50, labelPrice: 7.99 }).payout).toBe(4420);
    });

    it("the envelope row switches back to the regular rates after January 4, 2027", () => {
      const row = () => mercari.schedule(M.us).find((r) => r.fee === "First-Class Envelope label")!.amount;
      at(Date.UTC(2027, 0, 5, 7, 59));
      expect(row()).toBe("$0 (1 oz), $0.49 (2–3 oz)");
      at(Date.UTC(2027, 0, 5, 8, 0));
      expect(row()).toBe("$0.74 / $1.03 / $1.32 (1 / 2 / 3 oz)");
    });
  });

  it("schedule shows the Media Mail and cheapest label prices from the data", () => {
    const rows = mercari.schedule(M.us);
    expect(rows.find((r) => r.fee === "Media Mail label")!.amount).toBe("$4.47 / $5.22 / $5.97 (1 / 2 / 3 lb)");
    expect(rows.find((r) => r.fee === "Prepaid shipping label")!.amount).toContain("From $5.39");
  });

  it("compare mapping: buyer-paid shipping when the buyer pays something, seller-paid label otherwise", () => {
    const m = M.us;
    const a = mercari.calculate({ ...mercari.defaults(m), ...mercari.compare!.map({ price: 50, shipping: 6, itemCost: 0, shippingCost: 0 }) } as Inputs, m);
    expect(line(a, "selling")).toBe(560);
    expect(a.payout).toBe(4440);
    const b = mercari.calculate({ ...mercari.defaults(m), ...mercari.compare!.map({ price: 50, shipping: 0, itemCost: 10, shippingCost: 6 }) } as Inputs, m);
    expect(line(b, "label")).toBe(600);
    expect(b.payout).toBe(5000 - 500 - 600);
    expect(b.profit).toBe(b.payout - 1000);
  });
});
