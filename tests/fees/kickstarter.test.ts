import { describe, expect, it } from "vitest";
import kickstarter from "@/fees/platforms/kickstarter";
import { solvePrice } from "@/fees/solve";
import { pickMarket } from "@/fees/markets";
import { checkContract, line, run } from "./helpers";

/*
 * Kickstarter publishes no worked fee example (research §6): the only official numeric examples are
 * refund and payout-date logic, which this calculator doesn't model. Every case below is a derived
 * example from research/fees/kickstarter.md §6 (D1–D9), recomputed from the live fee page.
 */

const market = (id: string) => pickMarket(kickstarter.markets, id, "us");

describe("kickstarter", () => {
  it("meets the module contract in every market", () => {
    expect(checkContract(kickstarter)).toEqual([]);
  });

  it("default: $10,000 from 200 backers in the US", () => {
    const r = run(kickstarter, "us");
    expect(line(r, "platform")).toBe(50000); // 5% × 10,000
    expect(line(r, "processing")).toBe(36000); // 3% × 10,000 + 0.30 × 200
    expect(r.payout).toBe(914000);
  });

  it("D1: one $100 pledge (reward + shipping) in the US", () => {
    const r = run(kickstarter, "us", { raised: 100, backers: 1 });
    expect(line(r, "platform")).toBe(500);
    expect(line(r, "processing")).toBe(330);
    expect(r.payout).toBe(9170);
  });

  it("D2: a $5 micropledge pays 5% + $0.08", () => {
    const r = run(kickstarter, "us", { raised: 5, backers: 1 });
    expect(line(r, "platform")).toBe(25);
    expect(line(r, "processing")).toBe(33); // 5% × 5 + 0.08
    expect(r.payout).toBe(442);
  });

  it("D3: the $10 micropledge edge — $9.99 keeps a cent more than $10.00", () => {
    const below = run(kickstarter, "us", { raised: 9.99, backers: 1 });
    expect(line(below, "platform")).toBe(50); // 0.4995
    expect(line(below, "processing")).toBe(58); // 0.4995 + 0.08 = 0.5795
    expect(below.payout).toBe(891);
    const at = run(kickstarter, "us", { raised: 10, backers: 1 });
    expect(line(at, "processing")).toBe(60); // 3% × 10 + 0.30
    expect(at.payout).toBe(890);
  });

  it("D4: 1,000 backers × $50", () => {
    const r = run(kickstarter, "us", { raised: 50000, backers: 1000 });
    expect(line(r, "platform")).toBe(250000);
    expect(line(r, "processing")).toBe(180000);
    expect(r.payout).toBe(4570000);
  });

  it("D5: UK £40 pledge", () => {
    const r = run(kickstarter, "uk", { raised: 40, backers: 1 });
    expect(r.currency).toBe("GBP");
    expect(line(r, "platform")).toBe(200);
    expect(line(r, "processing")).toBe(150);
    expect(r.payout).toBe(3650);
  });

  it("D6: Japan ¥10,000, 4.5% with no fixed fee, whole yen", () => {
    const r = run(kickstarter, "jp", { raised: 10000, backers: 1 });
    expect(r.currency).toBe("JPY");
    expect(line(r, "platform")).toBe(50000);
    expect(line(r, "processing")).toBe(45000);
    expect(r.payout).toBe(905000);
    // ¥1,001 × 4.5% = ¥45.045 → ¥45; × 5% = ¥50.05 → ¥50 (whole yen, not ¥45.05)
    const odd = run(kickstarter, "jp", { raised: 1001, backers: 1 });
    expect(line(odd, "processing")).toBe(4500);
    expect(line(odd, "platform")).toBe(5000);
    expect(odd.fees.some((l) => l.id === "micro")).toBe(false);
    // ¥1,011 × 4.5% = ¥45.495 → ¥45 (rounded once; not ¥45.50 → ¥46); × 5% = ¥50.55 → ¥51
    const edge = run(kickstarter, "jp", { raised: 1011, backers: 1 });
    expect(line(edge, "processing")).toBe(4500);
    expect(line(edge, "platform")).toBe(5100);
    expect(edge.payout).toBe(91500);
    // yen have no fractions: ¥1,000.99 is taken as ¥1,000
    const frac = run(kickstarter, "jp", { raised: 1000.99, backers: 1 });
    expect(frac.saleAmount).toBe(100000);
    expect(frac.payout).toBe(90500);
  });

  it("Japan reverse mode returns a whole-yen total", () => {
    const m = market("jp");
    const inputs = kickstarter.defaults(m);
    // ¥110,497: 5% = ¥5,524.85 → ¥5,525; 4.5% = ¥4,972.365 → ¥4,972; keeps ¥100,000.
    // ¥110,496: ¥5,525 + ¥4,972 (4,972.32) → keeps ¥99,999.
    const s = solvePrice(kickstarter, inputs, m, "payout", 10000000);
    expect(s.price).toBe(11049700);
    expect(s.result!.payout).toBe(10000000);
  });

  it("D7: Pledge Over Time pays the fixed fee on each of 3 charges", () => {
    const r = run(kickstarter, "us", { raised: 150, backers: 1, potBackers: 1 });
    expect(line(r, "platform")).toBe(750);
    expect(line(r, "processing") + line(r, "pot")).toBe(540); // 3 × (1.50 + 0.30)
    expect(r.payout).toBe(13710);
    expect(run(kickstarter, "us", { raised: 150, backers: 1 }).payout).toBe(13770);
  });

  it("D8: Pledge Manager — 5% not on tax, processing on the whole payment incl. tax", () => {
    const r = run(kickstarter, "us", { raised: 0, backers: 1, shippingWhen: "pm", pmAmount: 50, pmTax: 2.4, pmOrders: 1 });
    expect(line(r, "pm-platform")).toBe(250);
    expect(line(r, "pm-processing")).toBe(187); // 3% × 52.40 + 0.30 = 1.872
    expect(r.buyerPays).toBe(5240);
    expect(r.payout).toBe(4563); // 52.40 − 2.40 tax − 2.50 − 1.87
  });

  it("D9: Mexico MX$80 micropledge (under MX$100)", () => {
    const r = run(kickstarter, "mx", { raised: 80, backers: 1 });
    expect(line(r, "platform")).toBe(400);
    expect(line(r, "processing")).toBe(750); // 5% × 80 + 3.50
    expect(r.payout).toBe(6850);
  });

  it("other markets: fixed fees and micropledge limits per country", () => {
    expect(line(run(kickstarter, "ca", { raised: 50, backers: 1 }), "processing")).toBe(190); // 1.50 + 0.40
    expect(line(run(kickstarter, "au", { raised: 50, backers: 1 }), "processing")).toBe(195);
    expect(line(run(kickstarter, "nz", { raised: 50, backers: 1 }), "processing")).toBe(200);
    expect(line(run(kickstarter, "eu", { raised: 50, backers: 1 }), "processing")).toBe(180);
    expect(line(run(kickstarter, "ch", { raised: 50, backers: 1 }), "processing")).toBe(180);
    // DKK/NOK/SEK: limit 100, 3% + 3.50 / 5% + 1.50
    expect(line(run(kickstarter, "dk", { raised: 99.99, backers: 1 }), "processing")).toBe(650); // 4.9995 + 1.50
    expect(line(run(kickstarter, "se", { raised: 100, backers: 1 }), "processing")).toBe(650); // 3.00 + 3.50
    expect(line(run(kickstarter, "no", { raised: 200, backers: 1 }), "processing")).toBe(950);
    // PLN: limit 30, 3% + 1.20 / 5% + 0.40
    expect(line(run(kickstarter, "pl", { raised: 29.99, backers: 1 }), "processing")).toBe(190); // 1.4995 + 0.40
    expect(line(run(kickstarter, "pl", { raised: 30, backers: 1 }), "processing")).toBe(210); // 0.90 + 1.20
    // MXN standard: 4% + 6.50
    expect(line(run(kickstarter, "mx", { raised: 100, backers: 1 }), "processing")).toBe(1050);
    // CA micropledge: 5% + 0.10 under CA$10
    expect(line(run(kickstarter, "ca", { raised: 9.99, backers: 1 }), "processing")).toBe(60); // 0.4995 + 0.10
    // AU edge: AU$9.99 → 0.50 + (0.4995 + 0.12 → 0.62) = keeps 8.87; AU$10 → 0.50 + 0.75 = keeps 8.75
    expect(run(kickstarter, "au", { raised: 9.99, backers: 1 }).payout).toBe(887);
    expect(run(kickstarter, "au", { raised: 10, backers: 1 }).payout).toBe(875);
    // MX edge: MX$99.99 → 5.00 + (4.9995 + 3.50 → 8.50) = keeps 86.49; MX$100 → 5.00 + 10.50 = keeps 84.50
    expect(run(kickstarter, "mx", { raised: 99.99, backers: 1 }).payout).toBe(8649);
    expect(run(kickstarter, "mx", { raised: 100, backers: 1 }).payout).toBe(8450);
    // CA Pledge Manager: 100 payments of CA$10 + CA$1.30 HST → 5% × 1,000 = 50; 3% × 1,130 + 0.40 × 100 = 73.90
    const ca = run(kickstarter, "ca", { raised: 0, backers: 1, shippingWhen: "pm", pmAmount: 1000, pmTax: 130, pmOrders: 100 });
    expect(line(ca, "pm-platform")).toBe(5000);
    expect(line(ca, "pm-processing")).toBe(7390);
    expect(ca.payout).toBe(87610);
  });

  it("micropledges entered separately get their own line", () => {
    const r = run(kickstarter, "us", { raised: 15000, backers: 300, smallBackers: 30, smallAverage: 5, potBackers: 20 });
    expect(line(r, "platform")).toBe(75000);
    expect(line(r, "processing")).toBe(52650); // 3% × 14,850 + 0.30 × 270
    expect(line(r, "micro")).toBe(990); // 5% × 150 + 0.08 × 30
    expect(line(r, "pot")).toBe(1200); // 0.30 × 2 × 20
    expect(r.payout).toBe(1370160);
  });

  it("a micropledge average at or over the limit is capped just under it, with a warning", () => {
    const r = run(kickstarter, "us", { raised: 1000, backers: 20, smallBackers: 10, smallAverage: 12 });
    expect(line(r, "micro")).toBe(Math.round(0.05 * 9990) + 80);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("Pledge Over Time can't exceed the backers who pledged enough", () => {
    const r = run(kickstarter, "us", { raised: 1000, backers: 10, smallBackers: 5, smallAverage: 5, potBackers: 9 });
    expect(line(r, "pot")).toBe(30 * 2 * 5);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("shipping charged in the Pledge Manager costs more than at pledge (extra fixed fee + processing on tax)", () => {
    const atPledge = run(kickstarter, "us", { raised: 12000 });
    const inPm = run(kickstarter, "us", { shippingWhen: "pm", pmAmount: 2000, pmTax: 160, pmOrders: 200 });
    expect(atPledge.totalFees).toBe(102000);
    expect(inPm.totalFees).toBe(108480);
    expect(inPm.saleAmount).toBe(1200000);
    expect(inPm.totalFees - atPledge.totalFees).toBe(6480); // $60 fixed fees + 3% × $160 tax
  });

  it("Pledge Manager fields are ignored while shipping is paid with the pledge", () => {
    const r = run(kickstarter, "us", { shippingWhen: "pledge", pmAmount: 5000, pmTax: 400 });
    expect(r.fees.some((l) => l.id.startsWith("pm-"))).toBe(false);
    expect(r.buyerPays).toBe(1000000);
  });

  it("an average pledge under the limit switches the whole campaign to the micropledge rate (breakpoint)", () => {
    const m = market("us");
    const inputs = kickstarter.defaults(m);
    expect(kickstarter.breakpoints!(inputs, m)).toEqual([200000]); // $10 × 200 backers
    const below = run(kickstarter, "us", { raised: 1999.99 });
    expect(below.fees[1].label).toContain("micropledges");
    expect(line(below, "processing")).toBe(Math.round(0.05 * 199999) + 1600);
    const at = run(kickstarter, "us", { raised: 2000 });
    expect(line(at, "processing")).toBe(6000 + 6000);
    expect(at.payout).toBeLessThan(below.payout);
  });

  it("breakpoints include the micropledge group's total when small pledges are entered", () => {
    const m = market("us");
    const bps = kickstarter.breakpoints!({ ...kickstarter.defaults(m), smallBackers: 50, smallAverage: 5 }, m);
    expect(bps).toEqual([25000, 25000 + 1000 * 150]);
    expect(kickstarter.breakpoints!(kickstarter.defaults(market("jp")), market("jp"))).toEqual([]);
  });

  it("reverse mode: the funding total that nets $10,000 from 200 backers", () => {
    const m = market("us");
    const inputs = kickstarter.defaults(m);
    const s = solvePrice(kickstarter, inputs, m, "payout", 1000000);
    expect(s.price).toBe(1093478);
    expect(s.result!.payout).toBeGreaterThanOrEqual(1000000);
    expect(kickstarter.calculate({ ...inputs, raised: (s.price! - 1) / 100 }, m).payout).toBeLessThan(1000000);
  });

  it("reverse mode finds the lowest total across the micropledge drop", () => {
    const m = market("us");
    const inputs = kickstarter.defaults(m);
    // $1,999.99 (average just under $10: micropledge rate) nets $1,783.99, but $2,000.00 nets only
    // $1,780.00, so the lowest total for $1,783.99 sits just under the breakpoint.
    const below = kickstarter.calculate({ ...inputs, raised: 1999.99 }, m).payout;
    expect(below).toBe(178399);
    expect(kickstarter.calculate({ ...inputs, raised: 2000 }, m).payout).toBe(178000);
    const s = solvePrice(kickstarter, inputs, m, "payout", below);
    expect(s.price).toBe(199999);
    expect(s.result!.payout).toBeGreaterThanOrEqual(below);
    expect(kickstarter.calculate({ ...inputs, raised: (s.price! - 1) / 100 }, m).payout).toBeLessThan(below);
  });

  it("reverse mode with micropledges entered: lowest total on both sides of the drop", () => {
    const m = market("us");
    const inputs = { ...kickstarter.defaults(m), smallBackers: 50, smallAverage: 5 };
    // 50 × $5 = $250 of micropledges; the other 150 average $10 at $1,750.00.
    // $1,749.99: 87.50 + (12.50 + 4.00) + (75.00 + 12.00) = 191.00 → keeps $1,558.99
    // $1,750.00: 87.50 + 16.50 + (45.00 + 45.00) = 194.00 → keeps $1,556.00
    expect(kickstarter.calculate({ ...inputs, raised: 1749.99 }, m).payout).toBe(155899);
    expect(kickstarter.calculate({ ...inputs, raised: 1750 }, m).payout).toBe(155600);
    expect(solvePrice(kickstarter, inputs, m, "payout", 155899).price).toBe(174999);
    // One cent more needs the standard-rate side. $1,753.26: 87.66 + (3% × 1,503.26 = 45.10 + 45.00) + 16.50
    // = 194.26 → keeps $1,559.00; $1,753.25: the same 194.26 → keeps $1,558.99.
    expect(kickstarter.calculate({ ...inputs, raised: 1753.25 }, m).payout).toBe(155899);
    expect(solvePrice(kickstarter, inputs, m, "payout", 155900).price).toBe(175326);
  });

  it("solve for profit: the total that covers $9,000 of costs", () => {
    const m = market("us");
    const inputs = { ...kickstarter.defaults(m), itemCost: 6000, shippingCost: 2000, otherCost: 1000 };
    const s = solvePrice(kickstarter, inputs, m, "profit", 0);
    expect(s.price).toBe(984782);
    expect(s.result!.profit).toBeGreaterThanOrEqual(0);
  });
});
