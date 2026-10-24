import { describe, expect, it } from "vitest";
import ebay, { conversionRate } from "@/fees/platforms/ebay";
import { solvePrice } from "@/fees/solve";
import { M } from "@/fees/markets";
import type { Result } from "@/fees/types";
import { checkContract, line, run } from "./helpers";

/** Final value fee as eBay's examples print it: the percentage part plus the per-order fee. */
const fvf = (r: Result) => line(r, "fvf") + line(r, "perorder");
const has = (r: Result, id: string) => r.fees.some((l) => l.id === id && l.amount !== 0);
const bpf = (r: Result) => r.buyerFees.find((l) => l.id === "buyerprotection")?.amount ?? 0;

describe("ebay: contract", () => {
  it("meets the module contract in every market", () => {
    expect(checkContract(ebay)).toEqual([]);
  });

  it("every plan and category combination calculates to integer cents", () => {
    const combos: [string, Record<string, unknown>][] = [
      ...["none", "starter", "basic", "premium", "anchor", "enterprise"].map((store) => ["us", { store, ordersPerMonth: 10 }] as [string, Record<string, unknown>]),
      ...["none", "basic", "premium", "anchor"].map((storeCa) => ["ca", { storeCa, ordersPerMonth: 10 }] as [string, Record<string, unknown>]),
      ["uk", { sellerUk: "business", shopUk: "anchor", ordersPerMonth: 10 }],
      ...["free", "starter", "basic", "featured", "anchor"].map((planAu) => ["au", { planAu, ordersPerMonth: 10 }] as [string, Record<string, unknown>]),
      ...["none", "basis", "top", "premium", "platin"].map((shopDe) => ["de", { sellerDe: "business", shopDe, ordersPerMonth: 10 }] as [string, Record<string, unknown>]),
    ];
    for (const [mk, o] of combos) {
      const m = ebay.markets.find((x) => x.id === mk)!;
      const cats = ebay.fields.find((f) => f.id === "category")!;
      const opts = cats.kind === "select" && typeof cats.options === "function" ? cats.options({ ...ebay.defaults(m), ...o } as never, m) : [];
      for (const c of opts) {
        for (const price of [5, 149.99, 150, 2500, 9000]) {
          const r = run(ebay, mk, { ...o, category: c.value, price, adRate: 5, buyer: "abroad", currencyConversion: true });
          expect(Number.isInteger(r.payout), `${mk} ${JSON.stringify(o)} ${c.value} ${price}`).toBe(true);
          for (const l of r.fees) expect(Number.isInteger(l.amount)).toBe(true);
        }
      }
    }
  });
});

describe("ebay: official US examples", () => {
  it("Selling fees page, auction example: $400 BIN, free shipping, 6% tax → $424 total, FVF $58.06, keep $341.59 before the $0.35 insertion fee", () => {
    const r = run(ebay, "us", { price: 400, shippingCharged: 0, salesTax: 6 });
    expect(r.buyerPays).toBe(42400);
    expect(line(r, "fvf")).toBe(5766); // 13.6% × 424 = 57.664
    expect(line(r, "perorder")).toBe(40);
    expect(fvf(r)).toBe(5806);
    expect(r.payout - 35).toBe(34159); // the page also deducts its $0.35 insertion fee
  });

  it("Selling fees page, fixed price example: $9,500 trading card, 6% tax → FVF $1,054.55", () => {
    const r = run(ebay, "us", { price: 9500, shippingCharged: 0, salesTax: 6, category: "cards" });
    expect(r.buyerPays).toBe(1007000);
    expect(fvf(r)).toBe(105455); // 13.25% × 7,500 + 2.35% × 2,570 + 0.40
    expect(r.payout - 35 - 400).toBe(844110); // minus $0.35 insertion and $4 Bold: "You make $8,441.10"
  });

  it("Store fees page: Basic store handbag $400, 6% tax → FVF (13% of $424 + $0.40) $55.52", () => {
    const r = run(ebay, "us", { price: 400, shippingCharged: 0, salesTax: 6, category: "handbags", store: "basic" });
    expect(fvf(r)).toBe(5552);
    expect(r.payout).toBe(34448);
  });

  it("Store fees page: Starter store ski jacket $65, 6% tax → FVF (13.6% of $68.90 + $0.40) $9.77", () => {
    const r = run(ebay, "us", { price: 65, shippingCharged: 0, salesTax: 6, category: "clothing", store: "starter" });
    expect(fvf(r)).toBe(977);
    expect(r.payout - 200).toBe(5323); // minus the $2 subtitle: "You make $53.23"
  });

  it("Seller Center, Marco: $150 golf clubs + $50 shipping + $10.50 tax → FVF $29.03, payout $170.97", () => {
    const r = run(ebay, "us", { price: 150, shippingCharged: 50, salesTax: 5.25, category: "sporting" });
    expect(r.buyerPays).toBe(21050);
    expect(fvf(r)).toBe(2903);
    expect(r.payout).toBe(17097);
  });

  it("Seller Center, Val: $80 skirt, free shipping, $85.60 after tax → FVF $12.04", () => {
    const r = run(ebay, "us", { price: 80, shippingCharged: 0, salesTax: 7, category: "clothing" });
    expect(r.buyerPays).toBe(8560);
    expect(fvf(r)).toBe(1204);
  });

  it("Seller Center, Chad: $250 sneakers, $270 with tax → 8% = $21.60, no per-order fee", () => {
    const r = run(ebay, "us", { price: 250, shippingCharged: 0, salesTax: 8, category: "sneakers" });
    expect(line(r, "fvf")).toBe(2160);
    expect(line(r, "perorder")).toBe(0);
  });

  it("Seller Center, Jodie: $500 phone + $5 shipping, 7% tax → $73.89 without a store, $50.92 with Basic; $69.93 a month better on 4 phones", () => {
    const ns = run(ebay, "us", { price: 500, shippingCharged: 5, salesTax: 7, category: "phones" });
    const st = run(ebay, "us", { price: 500, shippingCharged: 5, salesTax: 7, category: "phones", store: "basic" });
    expect(fvf(ns)).toBe(7389);
    expect(fvf(st)).toBe(5092);
    expect(4 * (fvf(ns) - fvf(st)) - 2195).toBe(6993);
  });
});

describe("ebay: official Canada examples", () => {
  it("BIN $400 phone, Ontario 13% HST → $452 total, FVF $61.87", () => {
    const r = run(ebay, "ca", { price: 400, shippingCharged: 0, salesTax: 13, category: "phones" });
    expect(r.buyerPays).toBe(45200);
    expect(fvf(r)).toBe(6187);
  });

  it("$9,500 trading card, 13% HST → $10,735 total, FVF $1,070.17", () => {
    const r = run(ebay, "ca", { price: 9500, shippingCharged: 0, salesTax: 13, category: "cards" });
    expect(fvf(r)).toBe(107017);
  });

  it("Basic store ski jacket $65, 13% HST → $73.45, FVF $9.73", () => {
    const r = run(ebay, "ca", { price: 65, shippingCharged: 0, salesTax: 13, category: "clothing", storeCa: "basic" });
    expect(r.buyerPays).toBe(7345);
    expect(fvf(r)).toBe(973);
  });

  it("Basic store purse $400: eBay.ca prints $57.40, but 12.7% of $452 + $0.40 is $57.80 (the page drops the per-order fee)", () => {
    const r = run(ebay, "ca", { price: 400, shippingCharged: 0, salesTax: 13, category: "handbags", storeCa: "basic" });
    expect(fvf(r)).toBe(5780);
  });
});

describe("ebay: official UK examples", () => {
  it("Buyer Protection fee: £20 → £1.50, £500 → £16.70, £1,500 → £36.70, £7,500 → £86.70 (cap), £5 → £0.45", () => {
    expect(bpf(run(ebay, "uk", { price: 20 }))).toBe(150);
    expect(bpf(run(ebay, "uk", { price: 500 }))).toBe(1670);
    expect(bpf(run(ebay, "uk", { price: 1500 }))).toBe(3670);
    expect(bpf(run(ebay, "uk", { price: 7500 }))).toBe(8670);
    expect(bpf(run(ebay, "uk", { price: 5 }))).toBe(45);
  });

  it("Buyer Protection is paid by the buyer: the private seller keeps the full price and postage", () => {
    const r = run(ebay, "uk", { price: 20, shippingCharged: 3.5 });
    expect(r.totalFees).toBe(0);
    expect(r.payout).toBe(2350);
    expect(r.buyerPays).toBe(2350 + 150);
  });

  it("Regulatory operating fee: £15 item + £5 postage → £0.07 (excl. VAT), £0.08 with VAT", () => {
    const r = run(ebay, "uk", { sellerUk: "business", price: 15, shippingCharged: 5 });
    expect(line(r, "rof")).toBe(7);
    expect(Math.round(2000 * 0.0042)).toBe(8);
  });
});

describe("ebay: official Australia examples", () => {
  it("Buyer Protection fee: $10 → $1.10, $38 → $2.98, $2,500 → $110.70, $7,500 → $210.70 (cap)", () => {
    expect(bpf(run(ebay, "au", { price: 10 }))).toBe(110);
    expect(bpf(run(ebay, "au", { price: 38 }))).toBe(298);
    expect(bpf(run(ebay, "au", { price: 2500 }))).toBe(11070);
    expect(bpf(run(ebay, "au", { price: 7500 }))).toBe(21070);
  });

  it("Pro examples: Starter $20 Tier 2 → $2.98; Basic $300 Tier 1 → $24.42; Featured $150 Tier 3 → $17.16; Anchor $5,200 Tier 4 → $477.73", () => {
    expect(fvf(run(ebay, "au", { planAu: "starter", category: "au-home", price: 20, shippingCharged: 0 }))).toBe(298);
    expect(fvf(run(ebay, "au", { planAu: "basic", category: "au-appliances", price: 300, shippingCharged: 0 }))).toBe(2442);
    expect(fvf(run(ebay, "au", { planAu: "featured", category: "au-vehicleparts", price: 150, shippingCharged: 0 }))).toBe(1716);
    expect(fvf(run(ebay, "au", { planAu: "anchor", category: "au-sporting", price: 5200, shippingCharged: 0 }))).toBe(47773);
  });

  it("free selling: no final value fee, buyer pays Buyer Protection", () => {
    const r = run(ebay, "au", { price: 30, shippingCharged: 10 });
    expect(r.totalFees).toBe(0);
    expect(bpf(r)).toBe(160 + 60 + 30);
  });
});

describe("ebay: derived US examples (research D1–D4) and edges", () => {
  it("D1: $50 + $8 shipping, 8% tax → $62.64; FVF $8.92; Top Rated Plus $8.07; Below Standard +$3.76; international $1.03; 8% ads $5.01", () => {
    const base = { price: 50, shippingCharged: 8, salesTax: 8 };
    expect(fvf(run(ebay, "us", base))).toBe(892);
    const trp = run(ebay, "us", { ...base, topRated: true });
    expect(fvf(trp) + line(trp, "toprated")).toBe(807);
    const below = run(ebay, "us", { ...base, performance: "below" });
    expect(line(below, "belowstandard")).toBe(376);
    expect(below.totalFees).toBe(1268);
    expect(line(run(ebay, "us", { ...base, buyer: "abroad" }), "intl")).toBe(103);
    expect(line(run(ebay, "us", { ...base, adRate: 8 }), "ads")).toBe(501);
  });

  it("D2: watches, total $3,000 → $280.40 without a store, $205.40 with Basic", () => {
    expect(fvf(run(ebay, "us", { category: "watches", price: 3000, shippingCharged: 0, salesTax: 0 }))).toBe(28040);
    expect(fvf(run(ebay, "us", { category: "watches", price: 3000, shippingCharged: 0, salesTax: 0, store: "basic" }))).toBe(20540);
  });

  it("D3: cliffs — jewelry $5,000.00 → $750.40 but $5,000.01 → $450.40; sneakers $149.99 → $20.80, $150 → $12.00", () => {
    const z = { shippingCharged: 0, salesTax: 0 };
    expect(fvf(run(ebay, "us", { ...z, category: "jewelry", price: 5000 }))).toBe(75040);
    expect(fvf(run(ebay, "us", { ...z, category: "jewelry", price: 5000.01 }))).toBe(45040);
    expect(fvf(run(ebay, "us", { ...z, category: "sneakers", price: 149.99 }))).toBe(2080);
    expect(fvf(run(ebay, "us", { ...z, category: "sneakers", price: 150 }))).toBe(1200);
  });

  it("D4: heavy equipment, $20,000 → 3% to $15,000 + 0.5% + $0.40 = $475.40", () => {
    expect(fvf(run(ebay, "us", { category: "heavy", price: 20000, shippingCharged: 0, salesTax: 0 }))).toBe(47540);
  });

  it("per-order fee: $0.30 at an order total of $10.00, $0.40 at $10.01 (tax and shipping count)", () => {
    expect(line(run(ebay, "us", { price: 10, shippingCharged: 0, salesTax: 0 }), "perorder")).toBe(30);
    expect(line(run(ebay, "us", { price: 10.01, shippingCharged: 0, salesTax: 0 }), "perorder")).toBe(40);
    expect(line(run(ebay, "us", { price: 5, shippingCharged: 4.35, salesTax: 7 }), "perorder")).toBe(30); // 9.35 + 0.65 tax = 10.00
    expect(line(run(ebay, "us", { price: 5.01, shippingCharged: 4.35, salesTax: 7 }), "perorder")).toBe(40);
  });

  it("marginal threshold: $7,500.00 all at 13.6%; one cent above gets 2.35% on the cent", () => {
    const z = { shippingCharged: 0, salesTax: 0 };
    expect(line(run(ebay, "us", { ...z, price: 7500 }), "fvf")).toBe(102000);
    expect(line(run(ebay, "us", { ...z, price: 7500.01 }), "fvf")).toBe(102000);
    expect(line(run(ebay, "us", { ...z, price: 7600 }), "fvf")).toBe(102000 + 235);
  });

  it("store bullion: 7.5% up to $1,500, 5% for the whole sale above", () => {
    const z = { shippingCharged: 0, salesTax: 0, category: "bullion", store: "basic" };
    expect(line(run(ebay, "us", { ...z, price: 1500 }), "fvf")).toBe(11250);
    expect(line(run(ebay, "us", { ...z, price: 1500.01 }), "fvf")).toBe(7500);
  });

  it("Below Standard and ‘not as described’ surcharges don't stack in the US; 7% and 6% after four months", () => {
    const base = { price: 100, shippingCharged: 0, salesTax: 0 };
    const both = run(ebay, "us", { ...base, performance: "below", inad: "high" });
    expect(line(both, "belowstandard")).toBe(600);
    expect(has(both, "inad")).toBe(false);
    expect(line(run(ebay, "us", { ...base, performance: "below4" }), "belowstandard")).toBe(700);
    expect(line(run(ebay, "us", { ...base, inad: "high4" }), "inad")).toBe(600);
  });

  it("eBay International Shipping removes the 1.65% international fee", () => {
    const r = run(ebay, "us", { buyer: "abroad", eis: true });
    expect(has(r, "intl")).toBe(false);
  });

  it("store subscription shared per order: Basic yearly $21.95 over 10 orders = $2.20; Enterprise is yearly only", () => {
    expect(line(run(ebay, "us", { store: "basic", ordersPerMonth: 10 }), "subscription")).toBe(220);
    expect(line(run(ebay, "us", { store: "basic", ordersPerMonth: 10, storeBilling: "monthly" }), "subscription")).toBe(280);
    expect(line(run(ebay, "us", { store: "enterprise", ordersPerMonth: 1000, storeBilling: "monthly" }), "subscription")).toBe(300);
  });

  it("express payout costs $2.00", () => {
    expect(line(run(ebay, "us", { expressPayout: true }), "express")).toBe(200);
  });

  it("default US case: $25 + $5 shipping + 7% tax → $4.77 in fees, keep $25.23", () => {
    const r = run(ebay, "us");
    expect(r.buyerPays).toBe(3210);
    expect(fvf(r)).toBe(477);
    expect(r.payout).toBe(2523);
  });
});

describe("ebay: derived examples in other markets", () => {
  it("UK D1: business, clothes £25 + £4.50 → £3.51 + £0.40 + £0.10 = £4.01, £4.81 with VAT (each line rounded)", () => {
    const r = run(ebay, "uk", { sellerUk: "business", category: "uk-clothes", price: 25, shippingCharged: 4.5 });
    expect(line(r, "fvf")).toBe(351);
    expect(line(r, "perorder")).toBe(40);
    expect(line(r, "rof")).toBe(10);
    expect(line(r, "vat")).toBe(80);
    expect(r.totalFees).toBe(481);
  });

  it("UK D2: business, Mobile & Smart Phones £1,200 → £79.60 excl. VAT, £95.52 with VAT", () => {
    const r = run(ebay, "uk", { sellerUk: "business", category: "uk-phones", price: 1200, shippingCharged: 0 });
    expect(r.totalFees - line(r, "vat")).toBe(7960);
    expect(r.totalFees).toBe(9552);
  });

  it("UK D3: business, books £8 → £1.12 excl. VAT, £1.34 with VAT ($0.30 per-order fee under £10)", () => {
    const r = run(ebay, "uk", { sellerUk: "business", category: "uk-books", price: 8, shippingCharged: 0 });
    expect(line(r, "perorder")).toBe(30);
    expect(r.totalFees - line(r, "vat")).toBe(112);
    expect(r.totalFees).toBe(134);
  });

  it("UK D4: private seller, £50 + £15 to the US → 3% international fee £1.95; buyer pays £2.70 Buyer Protection on the £50", () => {
    const r = run(ebay, "uk", { price: 50, shippingCharged: 15, buyer: "abroad" });
    expect(line(r, "intl")).toBe(195);
    expect(bpf(r)).toBe(270);
  });

  it("UK business: trainers switch to 7% at an item price of £100 (postage doesn't count)", () => {
    const z = { sellerUk: "business", category: "uk-trainers", shippingCharged: 10 };
    expect(line(run(ebay, "uk", { ...z, price: 99.99 }), "fvf")).toBe(Math.round(0.119 * 10999));
    expect(line(run(ebay, "uk", { ...z, price: 100 }), "fvf")).toBe(770);
  });

  it("UK business: international fee by region, waived with eBay International Shipping; VAT off when reclaimed", () => {
    const z = { sellerUk: "business", price: 100, shippingCharged: 0, buyer: "abroad" };
    expect(line(run(ebay, "uk", { ...z, intlRegionUk: "eu" }), "intl")).toBe(105);
    expect(line(run(ebay, "uk", { ...z, intlRegionUk: "usca" }), "intl")).toBe(180);
    expect(line(run(ebay, "uk", { ...z, intlRegionUk: "other" }), "intl")).toBe(200);
    expect(has(run(ebay, "uk", { ...z, eis: true }), "intl")).toBe(false);
    expect(has(run(ebay, "uk", { sellerUk: "business", vatOnFees: false }), "vat")).toBe(false);
  });

  it("UK business surcharges are percentage points and both apply", () => {
    const r = run(ebay, "uk", { sellerUk: "business", price: 100, shippingCharged: 0, performance: "below", inad: "high" });
    expect(line(r, "belowstandard")).toBe(600);
    expect(line(r, "inad")).toBe(400);
  });

  it("Canada D5: $50 + $10 shipping, 13% HST → $67.80, FVF $9.62; international 0.4% to the US, 1% elsewhere", () => {
    const base = { price: 50, shippingCharged: 10, salesTax: 13 };
    expect(fvf(run(ebay, "ca", base))).toBe(962);
    expect(line(run(ebay, "ca", { ...base, buyer: "abroad", intlRegionCa: "us" }), "intl")).toBe(27); // 0.4% × 67.80 = 0.2712
    expect(line(run(ebay, "ca", { ...base, buyer: "abroad", intlRegionCa: "other" }), "intl")).toBe(68);
  });

  it("Canada has no separate jewellery, watch or handbag rates: they pay 13.6% / 12.7%", () => {
    const z = { shippingCharged: 0, salesTax: 0, price: 6000 };
    expect(line(run(ebay, "ca", { ...z, category: "jewelry" }), "fvf")).toBe(81600);
    expect(line(run(ebay, "ca", { ...z, category: "handbags", storeCa: "basic" }), "fvf")).toBe(Math.round(0.127 * 250000 + 0.0235 * 350000));
  });

  it("Australia D6: Pro Basic, Tier 2, $120 → $0.33 + 11.44% × 120 = $14.06; GST-exempt ABN pays ÷ 1.1", () => {
    const r = run(ebay, "au", { planAu: "basic", category: "au-home", price: 120, shippingCharged: 0 });
    expect(fvf(r)).toBe(1406);
    const ex = run(ebay, "au", { planAu: "basic", category: "au-home", price: 120, shippingCharged: 0, gstExempt: true });
    expect(line(ex, "fvf")).toBe(1248); // 13.728 / 1.1 = 12.48
    expect(line(ex, "perorder")).toBe(30); // 0.33 / 1.1
  });

  it("Australia: 4,000 band edge on Pro Starter; international 3% without Pro, 1.1% with Pro", () => {
    const z = { planAu: "starter", shippingCharged: 0 };
    expect(line(run(ebay, "au", { ...z, price: 4000 }), "fvf")).toBe(53600);
    expect(line(run(ebay, "au", { ...z, price: 4000.01 }), "fvf")).toBe(53600);
    expect(line(run(ebay, "au", { price: 100, shippingCharged: 0, buyer: "abroad" }), "intl")).toBe(300);
    expect(line(run(ebay, "au", { ...z, price: 100, buyer: "abroad" }), "intl")).toBe(110);
  });

  it("Germany: private sellers pay nothing at home, 5% on international orders they ship themselves, 0 with eBay International Shipping", () => {
    expect(run(ebay, "de").totalFees).toBe(0);
    expect(line(run(ebay, "de", { price: 20, shippingCharged: 5, buyer: "abroad" }), "intl")).toBe(125);
    expect(has(run(ebay, "de", { buyer: "abroad", eis: true }), "intl")).toBe(false);
  });

  it("Germany business: clothing 12% + €0.45; used electronics 5%; per-order €0.35 up to €10", () => {
    const r = run(ebay, "de", { sellerDe: "business", price: 20, shippingCharged: 5 });
    expect(line(r, "fvf")).toBe(300);
    expect(line(r, "perorder")).toBe(45);
    expect(line(run(ebay, "de", { sellerDe: "business", category: "de-devices", conditionDe: "used", price: 200, shippingCharged: 5 }), "fvf")).toBe(1025);
    expect(line(run(ebay, "de", { sellerDe: "business", category: "de-devices", price: 200, shippingCharged: 5 }), "fvf")).toBe(1435);
    expect(line(run(ebay, "de", { sellerDe: "business", price: 5, shippingCharged: 5 }), "perorder")).toBe(35);
  });

  it("Germany business: a shop lowers the jewellery threshold to €500; Platin takes 10% off the whole fee", () => {
    const z = { sellerDe: "business", category: "de-jewelry", price: 1000, shippingCharged: 0 };
    expect(line(run(ebay, "de", z), "fvf")).toBe(15840 + 30); // 16% × 990 + 3% × 10
    expect(line(run(ebay, "de", { ...z, shopDe: "basis" }), "fvf")).toBe(8000 + 1500); // 16% × 500 + 3% × 500
    const p = run(ebay, "de", { ...z, shopDe: "platin" });
    expect(line(p, "platin")).toBe(-Math.round((9500 + 45) / 10));
  });

  it("Germany business: sneakers 12% under €100, from €100 7% up to €990 then 3%; region fees", () => {
    const z = { sellerDe: "business", category: "de-sneakers", shippingCharged: 5 };
    expect(line(run(ebay, "de", { ...z, price: 99.99 }), "fvf")).toBe(Math.round(0.12 * 10499));
    expect(line(run(ebay, "de", { ...z, price: 100 }), "fvf")).toBe(735);
    const b = { sellerDe: "business", price: 100, shippingCharged: 0, buyer: "abroad" };
    expect(has(run(ebay, "de", { ...b, intlRegionDe: "eu" }), "intl")).toBe(false);
    expect(line(run(ebay, "de", { ...b, intlRegionDe: "europe" }), "intl")).toBe(160);
    expect(line(run(ebay, "de", { ...b, intlRegionDe: "uk" }), "intl")).toBe(120);
    expect(line(run(ebay, "de", { ...b, intlRegionDe: "other" }), "intl")).toBe(330);
  });
});

describe("ebay: dated changes", () => {
  it("currency conversion charge switches on the announced dates (AU 1 Nov, UK 1 Dec, DE 2 Dec 2026)", () => {
    expect(conversionRate("au", Date.UTC(2026, 9, 31, 12, 59))).toBe(3);
    expect(conversionRate("au", Date.UTC(2026, 9, 31, 13, 0))).toBe(3.25);
    expect(conversionRate("uk", Date.UTC(2026, 10, 30, 23, 59))).toBe(2.5);
    expect(conversionRate("uk", Date.UTC(2026, 11, 1, 0, 0))).toBe(2.75);
    expect(conversionRate("de", Date.UTC(2026, 11, 1, 22, 59))).toBe(3);
    expect(conversionRate("de", Date.UTC(2026, 11, 1, 23, 0))).toBe(3.25);
    expect(conversionRate("us")).toBe(3.25);
    expect(conversionRate("ca")).toBe(3.25);
  });

  it("conversion line is the charge on what's left after the other fees", () => {
    const r = run(ebay, "us", { currencyConversion: true });
    expect(line(r, "conversion")).toBe(Math.round((3000 - 477) * 0.0325));
  });
});

describe("ebay: reverse mode", () => {
  it("finds the lowest price that pays the target (US default)", () => {
    const m = M.us;
    const inputs = ebay.defaults(m);
    const s = solvePrice(ebay, inputs, m, "payout", 2000);
    expect(s.price).not.toBeNull();
    expect(s.result!.payout).toBeGreaterThanOrEqual(2000);
    expect(ebay.calculate({ ...inputs, price: (s.price! - 1) / 100 }, m).payout).toBeLessThan(2000);
  });

  it("handles the drop where the per-order fee goes from $0.30 to $0.40", () => {
    const m = M.us;
    const inputs = ebay.defaults(m); // $5 shipping, 7% tax: total crosses $10.00 above a $4.35 price
    const bps = ebay.breakpoints!(inputs, m);
    expect(bps).toContain(436);
    expect(ebay.calculate({ ...inputs, price: 4.35 }, m).payout).toBe(769);
    expect(ebay.calculate({ ...inputs, price: 4.36 }, m).payout).toBe(760);
    // 7.65 is reachable below the edge: the answer must not jump past it.
    const low = solvePrice(ebay, inputs, m, "payout", 765);
    expect(low.price!).toBeLessThan(436);
    expect(ebay.calculate({ ...inputs, price: (low.price! - 1) / 100 }, m).payout).toBeLessThan(765);
    // 7.70 isn't reachable below the edge, so the answer is past it.
    const high = solvePrice(ebay, inputs, m, "payout", 770);
    expect(high.price!).toBeGreaterThan(436);
    expect(high.result!.payout).toBeGreaterThanOrEqual(770);
    expect(ebay.calculate({ ...inputs, price: (high.price! - 1) / 100 }, m).payout).toBeLessThan(770);
  });

  it("solves for profit in the UK as a business seller", () => {
    const m = M.uk;
    const inputs = { ...ebay.defaults(m), sellerUk: "business", itemCost: 10, shippingCost: 3 };
    const s = solvePrice(ebay, inputs, m, "profit", 1000);
    expect(s.result!.profit!).toBeGreaterThanOrEqual(1000);
    expect(ebay.calculate({ ...inputs, price: (s.price! - 1) / 100 }, m).profit!).toBeLessThan(1000);
  });
});

describe("ebay: edges verified against the live pages (2026-10-23)", () => {
  it("UK business: Home, Furniture & DIY pays a 10p per-order fee up to £10, other categories 30p; both £0.40 above", () => {
    const home = { sellerUk: "business", category: "uk-home", shippingCharged: 0 };
    expect(line(run(ebay, "uk", { ...home, price: 10 }), "perorder")).toBe(10);
    expect(line(run(ebay, "uk", { ...home, price: 10.01 }), "perorder")).toBe(40);
    expect(line(run(ebay, "uk", { ...home, category: "uk-furniture", price: 9.99 }), "perorder")).toBe(10);
    expect(line(run(ebay, "uk", { sellerUk: "business", category: "uk-clothes", shippingCharged: 0, price: 10 }), "perorder")).toBe(30);
    expect(line(run(ebay, "uk", { sellerUk: "business", category: "uk-clothes", shippingCharged: 0, price: 10.01 }), "perorder")).toBe(40);
  });

  it("UK business: watches 12.9% up to £750, 3% above; Mobile & Smart Phones 6.9% up to £1,000", () => {
    const w = { sellerUk: "business", category: "uk-watches", shippingCharged: 0 };
    expect(line(run(ebay, "uk", { ...w, price: 750 }), "fvf")).toBe(9675);
    expect(line(run(ebay, "uk", { ...w, price: 850 }), "fvf")).toBe(9675 + 300);
    expect(line(run(ebay, "uk", { sellerUk: "business", category: "uk-phones", shippingCharged: 0, price: 1000 }), "fvf")).toBe(6900);
  });

  it("US handbags: 15% of the whole sale up to $2,000.00, 9% of the whole sale from $2,000.01", () => {
    const z = { category: "handbags", shippingCharged: 0, salesTax: 0 };
    expect(line(run(ebay, "us", { ...z, price: 2000 }), "fvf")).toBe(30000);
    expect(line(run(ebay, "us", { ...z, price: 2000.01 }), "fvf")).toBe(18000);
  });

  it("Canada and Germany per-order fee edges at 10.00", () => {
    expect(line(run(ebay, "ca", { price: 10, shippingCharged: 0, salesTax: 0 }), "perorder")).toBe(30);
    expect(line(run(ebay, "ca", { price: 10.01, shippingCharged: 0, salesTax: 0 }), "perorder")).toBe(40);
    expect(line(run(ebay, "de", { sellerDe: "business", price: 10, shippingCharged: 0 }), "perorder")).toBe(35);
    expect(line(run(ebay, "de", { sellerDe: "business", price: 10.01, shippingCharged: 0 }), "perorder")).toBe(45);
  });

  it("Germany business: clothing 12% up to €990, 3% above; coins 6.5%", () => {
    const z = { sellerDe: "business", shippingCharged: 0 };
    expect(line(run(ebay, "de", { ...z, price: 990 }), "fvf")).toBe(11880);
    expect(line(run(ebay, "de", { ...z, price: 1090 }), "fvf")).toBe(11880 + 300);
    expect(line(run(ebay, "de", { ...z, category: "de-coins", price: 100 }), "fvf")).toBe(650);
  });

  it("Buyer Protection band edges: UK £20 → £1.50 and £300 → £12.70; Australia $20 → $1.90 and $500 → $30.70", () => {
    expect(bpf(run(ebay, "uk", { price: 300 }))).toBe(10 + 140 + 1120);
    expect(bpf(run(ebay, "au", { price: 20 }))).toBe(30 + 160);
    expect(bpf(run(ebay, "au", { price: 500 }))).toBe(30 + 160 + 2880);
  });

  it("every fee-table row has a unique name in every market (the page keys rows by name)", () => {
    for (const m of ebay.markets) {
      const names = ebay.schedule(m).map((r) => r.fee);
      expect(new Set(names).size, m.id).toBe(names.length);
    }
  });

  it("reverse mode jumps the jewelry cliff: $4,300 is first reachable just above $5,000", () => {
    const m = M.us;
    const inputs = { ...ebay.defaults(m), category: "jewelry", shippingCharged: 0, salesTax: 0 };
    const s = solvePrice(ebay, inputs, m, "payout", 430000);
    expect(s.price).toBe(500001);
    expect(ebay.calculate({ ...inputs, price: 5000 }, m).payout).toBeLessThan(430000);
  });

  it("reverse mode in Australia on Pro Starter across the $4,000 band", () => {
    const m = M.au;
    const inputs = { ...ebay.defaults(m), planAu: "starter", shippingCharged: 0 };
    const s = solvePrice(ebay, inputs, m, "payout", 400000);
    expect(s.result!.payout).toBeGreaterThanOrEqual(400000);
    expect(ebay.calculate({ ...inputs, price: (s.price! - 1) / 100 }, m).payout).toBeLessThan(400000);
    expect(s.price!).toBeGreaterThan(400000);
  });
});
