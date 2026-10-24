import { describe, expect, it } from "vitest";
import patreon from "@/fees/platforms/patreon";
import { solvePrice } from "@/fees/solve";
import { pickMarket } from "@/fees/markets";
import { checkContract, line, run } from "./helpers";

const has = (r: ReturnType<typeof run>, id: string) => r.fees.some((l) => l.id === id);

describe("patreon", () => {
  it("meets the module contract in every market", () => {
    expect(checkContract(patreon)).toEqual([]);
  });

  describe("official worked example: $10 one-time purchase, 10% plan (How iOS in-app payment works for one-time purchases)", () => {
    const base = { earnings: 10, members: 1, sellType: "shop", payoutsPerMonth: 0 };

    it("web / Android: platform $1.00, processing $0.59, you earn $8.41", () => {
      const r = run(patreon, "us", base);
      expect(line(r, "platform")).toBe(100);
      expect(line(r, "processing")).toBe(59); // 2.9% × 10.00 + 0.30
      expect(r.totalFees).toBe(159);
      expect(r.payout).toBe(841);
    });

    it("iOS, higher price (default): sale $14.50, Apple $4.35, platform $1.45, you earn $8.70", () => {
      const r = run(patreon, "us", { ...base, iosShare: 100 });
      expect(r.saleAmount).toBe(1450);
      expect(line(r, "apple")).toBe(435);
      expect(line(r, "platform")).toBe(145);
      expect(has(r, "processing")).toBe(false);
      expect(r.totalFees).toBe(580);
      expect(r.payout).toBe(870);
    });

    it("iOS, same price (creator absorbs): Apple $3.00, platform $1.00, you earn $6.00", () => {
      const r = run(patreon, "us", { ...base, iosShare: 100, iosPricing: "absorb" });
      expect(r.saleAmount).toBe(1000);
      expect(line(r, "apple")).toBe(300);
      expect(line(r, "platform")).toBe(100);
      expect(r.payout).toBe(600);
    });
  });

  it("official example: tax on fees (AU creator, $10 sale, 5% fee, 10% GST → $0.50 + $0.05)", () => {
    // The official example leaves processing out; we check the two lines it shows.
    const r = run(patreon, "usd", { earnings: 10, members: 1, plan: "founders", feeTax: 10, payoutsPerMonth: 0 });
    expect(line(r, "platform")).toBe(50);
    expect(line(r, "feeTax")).toBe(5);
  });

  it("official example: EUR payout, member pays $6 converted to €5.40, 2.5% conversion and platform fee on €5.40 (research D)", () => {
    const r = run(patreon, "eu", { earnings: 5.4, members: 1, fxShare: 100, payoutsPerMonth: 0 });
    expect(line(r, "platform")).toBe(54);
    expect(line(r, "fx")).toBe(14); // 2.5% × 5.40 = 0.135
    expect(line(r, "processing")).toBe(53); // 3.4% × 5.40 + 0.35 = 0.5336
    expect(r.payout).toBe(540 - 54 - 14 - 53);
  });

  it("US default: $500 from 100 members on the standard plan, direct deposit", () => {
    const r = run(patreon, "us");
    expect(line(r, "platform")).toBe(5000);
    expect(line(r, "processing")).toBe(1450 + 3000); // 2.9% × 500 + 100 × $0.30
    expect(line(r, "payout")).toBe(25);
    expect(r.payout).toBe(40525);
  });

  it("research A: $10 member, standard plan, card → $8.41, then $0.25 direct deposit → $8.16", () => {
    const r = run(patreon, "us", { earnings: 10, members: 1 });
    expect(line(r, "platform")).toBe(100);
    expect(line(r, "processing")).toBe(59);
    expect(line(r, "payout")).toBe(25);
    expect(r.payout).toBe(816);
  });

  it("research B: $5 tier with 6% sales tax: platform excludes tax, processing includes it", () => {
    const r = run(patreon, "us", { earnings: 5, members: 1, taxRate: 6, payoutsPerMonth: 0 });
    expect(r.buyerPays).toBe(530);
    expect(r.buyerFees[0].amount).toBe(30);
    expect(line(r, "platform")).toBe(50);
    expect(line(r, "processing")).toBe(45); // 2.9% × 5.30 + 0.30 = 0.4537
    expect(r.payout).toBe(405);
  });

  it("research C: $3 tier, legacy Pro micropayment rate vs standard plan; $1 pledge", () => {
    const pro = run(patreon, "us", { earnings: 3, members: 1, plan: "pro", payoutsPerMonth: 0 });
    expect(line(pro, "platform")).toBe(24);
    expect(line(pro, "processing")).toBe(25); // 5% × 3 + 0.10
    expect(pro.payout).toBe(251);
    const std = run(patreon, "us", { earnings: 3, members: 1, payoutsPerMonth: 0 });
    expect(line(std, "platform")).toBe(30);
    expect(line(std, "processing")).toBe(39); // 2.9% × 3 + 0.30 = 0.387
    expect(std.payout).toBe(231);
    expect(run(patreon, "us", { earnings: 1, members: 1, payoutsPerMonth: 0 }).payout).toBe(57); // 1 − 0.10 − 0.329
    expect(run(patreon, "us", { earnings: 1, members: 1, plan: "pro", payoutsPerMonth: 0 }).payout).toBe(77); // 1 − 0.08 − 0.15
  });

  it("legacy micropayment threshold: $3.00 average is micro, $3.01 is standard", () => {
    expect(line(run(patreon, "us", { earnings: 300, members: 100, plan: "pro", payoutsPerMonth: 0 }), "processing")).toBe(1500 + 1000);
    expect(line(run(patreon, "us", { earnings: 301, members: 100, plan: "pro", payoutsPerMonth: 0 }), "processing")).toBe(873 + 3000);
    expect(line(run(patreon, "us", { earnings: 2.99, members: 1, plan: "proMerch", payoutsPerMonth: 0 }), "processing")).toBe(25); // 5% × 2.99 + 0.10 = 0.2495
  });

  it("standard plan has no micropayment rate", () => {
    expect(line(run(patreon, "us", { earnings: 2, members: 1, payoutsPerMonth: 0 }), "processing")).toBe(36); // 2.9% × 2 + 0.30
  });

  it("legacy plan rates: Pro 8%, Pro + Merch 11%, Founders 5%", () => {
    expect(line(run(patreon, "us", { plan: "pro" }), "platform")).toBe(4000);
    expect(line(run(patreon, "us", { plan: "proMerch" }), "platform")).toBe(5500);
    expect(line(run(patreon, "us", { plan: "founders" }), "platform")).toBe(2500);
  });

  it("research E: non-US member paying $10 by PayPal, USD payout → 3.9% + $0.30", () => {
    const r = run(patreon, "us", { earnings: 10, members: 1, paypalIntl: 100, payoutsPerMonth: 0 });
    expect(has(r, "processing")).toBe(false);
    expect(line(r, "processing-paypal")).toBe(69);
    expect(r.payout).toBe(831);
    const micro = run(patreon, "us", { earnings: 3, members: 1, plan: "pro", paypalIntl: 100, payoutsPerMonth: 0 });
    expect(line(micro, "processing-paypal")).toBe(28); // 6% × 3 + 0.10
  });

  it("splits members between card and non-US PayPal", () => {
    const r = run(patreon, "us", { earnings: 1000, members: 100, paypalIntl: 25, payoutsPerMonth: 0 });
    expect(line(r, "processing")).toBe(Math.round(0.029 * 75000) + 30 * 75);
    expect(line(r, "processing-paypal")).toBe(Math.round(0.039 * 25000) + 30 * 25);
  });

  it("Founders (US dollars): 1.6% + $0.30 cards, 2.65% + $0.28 PayPal/Venmo", () => {
    const r = run(patreon, "us", { earnings: 20, members: 2, plan: "founders", paypalShare: 50, payoutsPerMonth: 0 });
    expect(line(r, "processing")).toBe(46); // 1.6% × 10 + 0.30
    expect(line(r, "processing-paypal")).toBe(55); // 2.65% × 10 + 0.28 = 0.545
  });

  it("Founders paid in another currency use the legacy table", () => {
    const r = run(patreon, "uk", { earnings: 3, members: 1, plan: "founders", payoutsPerMonth: 0 });
    expect(line(r, "platform")).toBe(15);
    expect(line(r, "processing")).toBe(30); // 5% × 3 + £0.15
  });

  it("research F: membership in the iOS app after a year (Apple 15%)", () => {
    const r = run(patreon, "us", { earnings: 10, members: 1, iosShare: 100, appleRate: "15", payoutsPerMonth: 0 });
    expect(r.saleAmount).toBe(1429); // 10 ÷ 0.7, memberships are not rounded to 50¢
    expect(line(r, "apple")).toBe(214);
    expect(line(r, "platform")).toBe(143);
    expect(r.payout).toBe(1072);
    const china = run(patreon, "us", { earnings: 10, members: 1, iosShare: 100, appleRate: "25", payoutsPerMonth: 0 });
    expect(line(china, "apple")).toBe(357); // 25% × 14.29
  });

  it("part of the members on iOS: Apple replaces processing for them", () => {
    const r = run(patreon, "us", { earnings: 500, members: 100, iosShare: 20, payoutsPerMonth: 0 });
    expect(line(r, "processing")).toBe(Math.round(0.029 * 40000) + 30 * 80);
    expect(r.saleAmount).toBe(40000 + 14286);
    expect(line(r, "apple")).toBe(Math.round(0.3 * 14286));
  });

  it("currency conversion is charged on the payment including tax", () => {
    const r = run(patreon, "eu", { earnings: 10, members: 1, taxRate: 20, fxShare: 100, payoutsPerMonth: 0 });
    expect(line(r, "fx")).toBe(30);
    expect(line(r, "processing")).toBe(76); // 3.4% × 12 + 0.35 = 0.758
    expect(line(r, "platform")).toBe(100);
  });

  it("research G: PayPal payouts are 1% with a $0.25 minimum and a $20 cap", () => {
    const def = run(patreon, "us", { payout: "paypal" });
    expect(line(def, "payout")).toBe(406); // 1% × 405.50
    const big = run(patreon, "us", { earnings: 5000, members: 100, payout: "paypal" });
    expect(line(big, "payout")).toBe(2000);
    const small = run(patreon, "us", { earnings: 20, members: 1, payout: "paypal" });
    expect(line(small, "payout")).toBe(25);
    const tooSmall = run(patreon, "us", { earnings: 10, members: 1, payout: "paypal" });
    expect(tooSmall.warnings.some((w) => w.includes("at least $10"))).toBe(true);
  });

  it("creators outside the US paid in US dollars: 1.55% + $0.25 to a local bank, $0.50 to a USD bank, $1 Payoneer", () => {
    const r = run(patreon, "usd", { earnings: 1000, members: 100, payout: "bankLocal" });
    expect(line(r, "payout")).toBe(1304 + 25); // 1.55% × 841.00 = 13.0355
    expect(line(run(patreon, "usd", { payout: "bankUsd" }), "payout")).toBe(50);
    expect(line(run(patreon, "usd", { payout: "payoneer" }), "payout")).toBe(100);
  });

  it("each withdrawal pays its own fee", () => {
    expect(line(run(patreon, "us", { payoutsPerMonth: 2 }), "payout")).toBe(50);
    expect(has(run(patreon, "us", { payoutsPerMonth: 0 }), "payout")).toBe(false);
  });

  it("UK (GBP payout): 3.4% + £0.35, £0.50 bank transfer", () => {
    const r = run(patreon, "uk");
    expect(line(r, "processing")).toBe(1700 + 3500);
    expect(line(r, "payout")).toBe(50);
  });

  it("Australia: 3% + A$0.30; Canada: 3.2% + C$0.35, C$2 Payoneer", () => {
    expect(line(run(patreon, "au", { earnings: 10, members: 1 }), "processing")).toBe(60);
    expect(line(run(patreon, "ca", { earnings: 10, members: 1 }), "processing")).toBe(67);
    expect(line(run(patreon, "ca", { payout: "payoneer" }), "payout")).toBe(200);
  });

  it("New Zealand legacy threshold is NZ$4; Sweden's is 30 kr", () => {
    expect(line(run(patreon, "nz", { earnings: 4, members: 1, plan: "pro", payoutsPerMonth: 0 }), "processing")).toBe(45); // 5% × 4 + 0.25
    expect(line(run(patreon, "nz", { earnings: 4.01, members: 1, plan: "pro", payoutsPerMonth: 0 }), "processing")).toBe(61); // 3.9% × 4.01 + 0.45
    expect(line(run(patreon, "se", { earnings: 30, members: 1, plan: "pro", payoutsPerMonth: 0 }), "processing")).toBe(300); // 5% × 30 + 1.50
    expect(line(run(patreon, "se", { earnings: 30.01, members: 1, plan: "pro", payoutsPerMonth: 0 }), "processing")).toBe(427); // 3.4% × 30.01 + 3.25
  });

  it("one-time purchases: standard processing on legacy plans, 5% for early sellers, $3 minimum", () => {
    const r = run(patreon, "us", { earnings: 3, members: 1, plan: "pro", sellType: "shop", payoutsPerMonth: 0 });
    expect(line(r, "platform")).toBe(24);
    expect(line(r, "processing")).toBe(39);
    expect(line(run(patreon, "us", { earnings: 10, members: 1, sellType: "shop", earlySeller: true }), "platform")).toBe(50);
    expect(run(patreon, "us", { earnings: 2, members: 1, sellType: "shop" }).warnings.some((w) => w.includes("$3"))).toBe(true);
  });

  it("breakpoint at the legacy micropayment threshold", () => {
    const m = pickMarket(patreon.markets, "us", "us");
    expect(patreon.breakpoints!({ ...patreon.defaults(m), plan: "pro" }, m)).toEqual([30001]);
    expect(patreon.breakpoints!(patreon.defaults(m), m)).toEqual([]);
  });

  it("reverse mode finds the lowest monthly income that pays the target", () => {
    const m = pickMarket(patreon.markets, "us", "us");
    const inputs = patreon.defaults(m);
    const s = solvePrice(patreon, inputs, m, "payout", 100000);
    expect(s.price).not.toBeNull();
    expect(s.result!.payout).toBeGreaterThanOrEqual(100000);
    expect(patreon.calculate({ ...inputs, earnings: (s.price! - 1) / 100 }, m).payout).toBeLessThan(100000);
  });

  it("reverse mode across the micropayment drop (Pro, one member)", () => {
    const m = pickMarket(patreon.markets, "us", "us");
    const inputs = { ...patreon.defaults(m), plan: "pro", members: 1, payoutsPerMonth: 0 };
    const low = solvePrice(patreon, inputs, m, "payout", 250);
    expect(low.price).toBeLessThanOrEqual(300);
    expect(low.result!.payout).toBeGreaterThanOrEqual(250);
    expect(patreon.calculate({ ...inputs, earnings: (low.price! - 1) / 100 }, m).payout).toBeLessThan(250);
    // $3.00 keeps $2.51; $3.01 keeps only $2.38, so $2.52 needs $3.16: 3.16 − 0.25 − (0.09 + 0.30) = 2.52.
    const high = solvePrice(patreon, inputs, m, "payout", 252);
    expect(high.price).toBe(316);
    expect(high.result!.payout).toBeGreaterThanOrEqual(252);
    expect(patreon.calculate({ ...inputs, earnings: (high.price! - 1) / 100 }, m).payout).toBeLessThan(252);
  });

  describe("independent hand-computed cases (review)", () => {
    it("euro legacy Pro: €3.00 average is micro (5% + €0.15), €3.01 is standard (3.4% + €0.35)", () => {
      const at = run(patreon, "eu", { earnings: 300, members: 100, plan: "pro" });
      expect(line(at, "platform")).toBe(2400);
      expect(line(at, "processing")).toBe(1500 + 1500); // 5% × €300 + €0.15 × 100
      expect(line(at, "payout")).toBe(50); // €0.50 bank transfer
      expect(at.payout).toBe(24550);
      const above = run(patreon, "eu", { earnings: 301, members: 100, plan: "pro" });
      expect(line(above, "platform")).toBe(2408);
      expect(line(above, "processing")).toBe(1023 + 3500); // 3.4% × €301 = 10.234 + €0.35 × 100
      expect(above.payout).toBe(23119);
    });

    it("Denmark, Poland and Norway legacy thresholds (25 kr, 15 zł, 30 kr), one cent apart", () => {
      const p = (m: string, e: number) => line(run(patreon, m, { earnings: e, members: 1, plan: "pro", payoutsPerMonth: 0 }), "processing");
      expect(p("dk", 25)).toBe(235); // 5% × 25 + 1.10
      expect(p("dk", 25.01)).toBe(345); // 3.4% × 25.01 = 0.85 + 2.60
      expect(p("pl", 15)).toBe(145); // 5% × 15 + 0.70
      expect(p("pl", 15.01)).toBe(226); // 3.4% × 15.01 = 0.51 + 1.75
      expect(p("no", 30)).toBe(300); // 5% × 30 + 1.50
      expect(p("no", 30.01)).toBe(382); // 3.4% × 30.01 = 1.02 + 2.80
    });

    it("Sweden default: 5,000 kr from 100 members, standard plan, 5 kr bank transfer", () => {
      const r = run(patreon, "se");
      expect(line(r, "platform")).toBe(50000);
      expect(line(r, "processing")).toBe(17000 + 32500); // 3.4% × 5,000 + 3.25 × 100
      expect(r.payout).toBe(400000);
    });

    it("UK, 20% VAT and a member paying in another currency: processing and conversion on £12, platform on £10", () => {
      const r = run(patreon, "uk", { earnings: 10, members: 1, taxRate: 20, fxShare: 100 });
      expect(line(r, "platform")).toBe(100);
      expect(line(r, "processing")).toBe(76); // 3.4% × 12 = 0.408 + 0.35
      expect(line(r, "fx")).toBe(30); // 2.5% × 12
      expect(r.payout).toBe(1000 - 100 - 76 - 30 - 50);
    });

    it("PayPal payout: $0.25 minimum below a $25 balance, 1% rounded to the cent above it", () => {
      // $29.60 → balance 2960 − 296 − (85.84 → 86 + 30) = $25.48 → 1% = 0.2548 → minimum $0.25
      expect(line(run(patreon, "us", { earnings: 29.6, members: 1, payout: "paypal" }), "payout")).toBe(25);
      // $29.65 → balance 2965 − 297 − (85.985 → 86 + 30) = $25.52 → 1% = 0.2552 → $0.26
      expect(line(run(patreon, "us", { earnings: 29.65, members: 1, payout: "paypal" }), "payout")).toBe(26);
    });

    it("Founders $5 × 100 with 20% PayPal: 1.6% + $0.30 on $400, 2.65% + $0.28 on $100", () => {
      const r = run(patreon, "us", { plan: "founders", paypalShare: 20 });
      expect(line(r, "platform")).toBe(2500);
      expect(line(r, "processing")).toBe(640 + 2400);
      expect(line(r, "processing-paypal")).toBe(265 + 560);
      expect(r.payout).toBe(50000 - 2500 - 3040 - 825 - 25);
    });

    it("Founders at $3 or less: no published micropayment rate, so the note says the card rate is used", () => {
      const r = run(patreon, "us", { earnings: 3, members: 1, plan: "founders", payoutsPerMonth: 0 });
      expect(line(r, "processing")).toBe(35); // 1.6% × 3 = 0.048 + 0.30
      expect(r.notes.some((n) => n.includes("no Founders micropayment rate"))).toBe(true);
    });

    it("iOS one-time purchase at $3: app price $4.29 rounds to $4.50; at $7.10 it rounds to $10.00", () => {
      const r = run(patreon, "us", { earnings: 3, members: 1, sellType: "shop", iosShare: 100, payoutsPerMonth: 0 });
      expect(r.saleAmount).toBe(450);
      expect(line(r, "apple")).toBe(135);
      expect(line(r, "platform")).toBe(45);
      expect(r.payout).toBe(270);
      expect(run(patreon, "us", { earnings: 7.1, members: 1, sellType: "shop", iosShare: 100, payoutsPerMonth: 0 }).saleAmount).toBe(1000);
    });

    it("one-time purchases above $5,000 get a warning", () => {
      expect(run(patreon, "us", { earnings: 5000.01, members: 1, sellType: "shop" }).warnings.some((w) => w.includes("$5,000"))).toBe(true);
      expect(run(patreon, "us", { earnings: 5000, members: 1, sellType: "shop" }).warnings.some((w) => w.includes("$5,000"))).toBe(false);
    });

    it("reverse mode, Pro with 100 members: $250.75 is reached at exactly $300.00; $250.76 needs $315.39", () => {
      const m = pickMarket(patreon.markets, "us", "us");
      const inputs = { ...patreon.defaults(m), plan: "pro" };
      // $300.00: 300 − 24 − (15 + 10) − 0.25 = $250.75; $299.99 keeps $250.74.
      expect(solvePrice(patreon, inputs, m, "payout", 25075).price).toBe(30000);
      // Above $300 the fixed fee is $0.30: E − 8% − (2.9% + $30) − $0.25 ≥ $250.76 first at $315.39.
      expect(solvePrice(patreon, inputs, m, "payout", 25076).price).toBe(31539);
    });

    it("reverse mode, US default: $1,000 a month to keep needs $1,182.83", () => {
      const m = pickMarket(patreon.markets, "us", "us");
      // 0.871 × E − $30.25 ≥ $1,000 → E ≥ $1,182.835…; with each line rounded, $1,182.83 keeps $1,000.00.
      const s = solvePrice(patreon, patreon.defaults(m), m, "payout", 100000);
      expect(s.price).toBe(118283);
      expect(s.result!.payout).toBe(100000);
    });
  });
});
