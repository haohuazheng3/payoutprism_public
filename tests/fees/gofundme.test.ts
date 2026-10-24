import { describe, expect, it } from "vitest";
import gofundme from "@/fees/platforms/gofundme";
import { solvePrice } from "@/fees/solve";
import { M } from "@/fees/markets";
import { checkContract, line, run } from "./helpers";

describe("gofundme", () => {
  it("meets the module contract in every market", () => {
    expect(checkContract(gofundme)).toEqual([]);
  });

  // ---- Official worked examples ----

  it("OE1 (help center): a $50 donation to a US fundraiser leaves $48.25", () => {
    const r = run(gofundme, "us", { raised: 50, donations: 1 });
    expect(line(r, "platform")).toBe(0);
    expect(line(r, "transaction")).toBe(145); // 2.9% × 50.00
    expect(line(r, "per-donation")).toBe(30);
    expect(r.totalFees).toBe(175);
    expect(r.payout).toBe(4825);
  });

  it("OE2 (GoFundMe Pro donor covered fees): $100, 3% service, 2.4% + $0.30 → donor charged $106.02", () => {
    const r = run(gofundme, "us", { fundraiserType: "pro", raised: 100, donations: 1, proMethod: "card", proCardRate: 2.4, proServiceFee: 3, donorCovers: true });
    expect(r.buyerPays).toBe(10602); // (100 + .30) / (1 - 0.03 - 0.024) = 106.02
    expect(r.buyerFees.find((l) => l.id === "covered")!.amount).toBe(602);
    expect(line(r, "pro-service")).toBe(318); // 3% × 106.02
    expect(line(r, "processing")).toBe(254); // 2.4% × 106.02
    expect(line(r, "per-donation")).toBe(30);
    expect(r.payout).toBe(10000); // the nonprofit receives the full $100
  });

  // The pricing page calculator ("Let's do the math together"): fees = amount × percent + fixed × donors.
  it.each([
    ["us", "personal", 500, 5, 1600],
    ["us", "personal", 1500, 15, 4800],
    ["us", "personal", 5000, 30, 15400],
    ["us", "charity", 500, 5, 1250],
    ["us", "charity", 1500, 15, 3750],
    ["us", "charity", 5000, 30, 11900],
    ["ca", "personal", 500, 5, 1600],
    ["ca", "charity", 500, 5, 1250],
    ["au", "personal", 500, 5, 1250],
    ["au", "personal", 5000, 30, 11900],
    ["au", "charity", 500, 5, 1100],
    ["au", "charity", 5000, 30, 10400],
    ["uk", "personal", 500, 5, 1575],
    ["uk", "personal", 5000, 30, 15250],
    ["uk", "charity", 500, 5, 1050],
    ["uk", "charity", 5000, 30, 10100],
    ["ie", "personal", 500, 5, 1575],
    ["ie", "charity", 500, 5, 1125],
    ["de", "personal", 1500, 15, 4725],
    ["fr", "personal", 1500, 15, 4725],
    ["mx", "personal", 500, 5, 3950],
    ["ch", "personal", 500, 5, 1600],
    ["se", "personal", 500, 5, 2950],
    ["no", "personal", 500, 5, 2950],
    ["dk", "personal", 500, 5, 2950],
  ] as const)("pricing-page calculator: %s %s, %d from %d donors → fees %d", (market, type, raised, donations, fee) => {
    const r = run(gofundme, market, { fundraiserType: type, raised, donations });
    expect(r.totalFees).toBe(fee);
    expect(r.payout).toBe(raised * 100 - fee);
  });

  // ---- Derived examples ----

  it("default US case: $5,000 from 50 donations → $160 in fees, $4,840 kept", () => {
    const r = run(gofundme, "us");
    expect(line(r, "transaction")).toBe(14500);
    expect(line(r, "per-donation")).toBe(1500);
    expect(r.payout).toBe(484000);
    expect(r.buyerFees).toEqual([]);
  });

  it("D1: a $5 donation (the minimum) loses 8.9% before rounding; the 14.5¢ rounds half up to 15¢", () => {
    const r = run(gofundme, "us", { raised: 5, donations: 1 });
    expect(line(r, "transaction")).toBe(15);
    expect(r.totalFees).toBe(45);
    expect(r.payout).toBe(455);
    expect(r.warnings).toEqual([]);
  });

  it("minimum donation edge: one cent below $5 per donation warns, $5 doesn't", () => {
    expect(run(gofundme, "us", { raised: 499.99, donations: 100 }).warnings.length).toBe(1);
    expect(run(gofundme, "us", { raised: 500, donations: 100 }).warnings).toEqual([]);
    // Nordic minimum is 50 kr, Mexico MXN 25
    expect(run(gofundme, "se", { raised: 4999.99, donations: 100 }).warnings.length).toBe(1);
    expect(run(gofundme, "se", { raised: 5000, donations: 100 }).warnings).toEqual([]);
    expect(run(gofundme, "mx", { raised: 2499.99, donations: 100 }).warnings.length).toBe(1);
  });

  it("maximum donation edge: US$250,000 per donation (ACH), 100,000 elsewhere", () => {
    expect(run(gofundme, "us", { raised: 250000, donations: 1 }).warnings).toEqual([]);
    expect(run(gofundme, "us", { raised: 250000.01, donations: 1 }).warnings.length).toBe(1);
    expect(run(gofundme, "uk", { raised: 100000, donations: 1 }).warnings).toEqual([]);
    expect(run(gofundme, "uk", { raised: 100000.01, donations: 1 }).warnings.length).toBe(1);
  });

  it("D3: $100 monthly donation → donor pays $105, organizer receives $96.80", () => {
    const r = run(gofundme, "us", { raised: 100, donations: 1, monthly: 100 });
    expect(r.buyerFees.find((l) => l.id === "recurring")!.amount).toBe(500);
    expect(r.buyerPays).toBe(10500);
    expect(r.payout).toBe(9680);
  });

  it("D4: UK £20 donation with a £2 tip → donor pays £22, organizer receives £19.17", () => {
    const r = run(gofundme, "uk", { raised: 20, donations: 1, tipPct: 10 });
    expect(r.buyerFees.find((l) => l.id === "tips")!.amount).toBe(200);
    expect(r.buyerPays).toBe(2200);
    expect(line(r, "transaction")).toBe(58);
    expect(line(r, "per-donation")).toBe(25);
    expect(r.payout).toBe(1917);
  });

  it("tips apply to one-time donations only, and never reduce the payout", () => {
    const r = run(gofundme, "us", { raised: 1000, donations: 10, monthly: 400, tipPct: 10 });
    expect(r.buyerFees.find((l) => l.id === "tips")!.amount).toBe(6000); // 10% × $600 one-time
    expect(r.buyerFees.find((l) => l.id === "recurring")!.amount).toBe(2000); // 5% × $400 monthly
    expect(r.payout).toBe(run(gofundme, "us", { raised: 1000, donations: 10 }).payout);
  });

  it("no recurring donations in Italy or Canada", () => {
    expect(run(gofundme, "it", { monthly: 100 }).buyerFees).toEqual([]);
    expect(run(gofundme, "ca", { monthly: 100 }).buyerFees).toEqual([]);
    expect(run(gofundme, "de", { monthly: 100 }).buyerFees.length).toBe(1);
  });

  it("D5: Australian charity, A$250 donation → A$5.05 fee (GST included), A$244.95 to the nonprofit", () => {
    const r = run(gofundme, "au", { fundraiserType: "charity", raised: 250, donations: 1 });
    expect(r.totalFees).toBe(505);
    expect(r.payout).toBe(24495);
    expect(r.fees.some((l) => l.kind === "tax")).toBe(false);
  });

  it("charity rate only exists in US, CA, UK, IE and AU: elsewhere it falls back to the personal rate", () => {
    const de = run(gofundme, "de", { fundraiserType: "charity", raised: 500, donations: 5 });
    expect(de.totalFees).toBe(1575);
    const ukPro = run(gofundme, "uk", { fundraiserType: "pro", raised: 500, donations: 5 });
    expect(ukPro.totalFees).toBe(1575);
  });

  it("GoFundMe Pro: card up to 2.5% + $0.30, AmEx +1%, ACH 1% + $0.30, PayPal/Venmo 2.5% + $0.30", () => {
    const base = { fundraiserType: "pro", raised: 1000, donations: 10 };
    expect(run(gofundme, "us", { ...base, proMethod: "card" }).totalFees).toBe(2500 + 300);
    const amex = run(gofundme, "us", { ...base, proMethod: "amex" });
    expect(line(amex, "amex")).toBe(1000);
    expect(amex.totalFees).toBe(2500 + 1000 + 300);
    expect(run(gofundme, "us", { ...base, proMethod: "ach" }).totalFees).toBe(1000 + 300);
    expect(run(gofundme, "us", { ...base, proMethod: "paypal", proCardRate: 2.2 }).totalFees).toBe(2500 + 300);
    expect(run(gofundme, "us", { ...base, proMethod: "card", proCardRate: 2.2, proServiceFee: 3 }).totalFees).toBe(2200 + 3000 + 300);
  });

  // Hand-computed by the reviewer (percentage on the total, rounded once; fixed fee × donations).
  it.each([
    // UK: 2.9% × £1,234.56 = 35.80224 → £35.80; £0.25 × 17 = £4.25
    ["uk", { raised: 1234.56, donations: 17 }, 4005, 119451],
    // Ireland charity: 1.9% × €777.77 = 14.77763 → €14.78; €0.35 × 9 = €3.15
    ["ie", { fundraiserType: "charity", raised: 777.77, donations: 9 }, 1793, 75984],
    // Australia: 2.2% × A$333.33 = 7.33326 → A$7.33; A$0.30 × 3 = A$0.90
    ["au", { raised: 333.33, donations: 3 }, 823, 32510],
    // Mexico: 2.9% × MXN 10,000 = 290; MXN 5 × 40 = 200
    ["mx", { raised: 10000, donations: 40 }, 49000, 951000],
    // Norway: 2.9% × 2,000 kr = 58; 3 kr × 10 = 30
    ["no", { raised: 2000, donations: 10 }, 8800, 191200],
  ] as const)("reviewer case %s %j → fees %d, payout %d", (market, o, fees, payout) => {
    const r = run(gofundme, market, o);
    expect(r.totalFees).toBe(fees);
    expect(r.payout).toBe(payout);
  });

  it("GoFundMe Pro, PayPal, 3% contract fee, donor covers $250: (250 + 0.30) ÷ 0.945 = 264.867… → $264.86 charged", () => {
    const r = run(gofundme, "us", { fundraiserType: "pro", proMethod: "paypal", proServiceFee: 3, donorCovers: true, raised: 250, donations: 1 });
    expect(r.buyerPays).toBe(26486);
    expect(line(r, "pro-service")).toBe(795); // 3% × 264.86 = 7.9458
    expect(line(r, "processing")).toBe(662); // 2.5% × 264.86 = 6.6215
    expect(line(r, "per-donation")).toBe(30);
    expect(r.payout).toBe(24999); // per-line rounding leaves the nonprofit a cent short of $250
  });

  it("US charity fundraisers take no ACH, so their largest donation is $100,000, not $250,000", () => {
    expect(run(gofundme, "us", { fundraiserType: "charity", raised: 100000, donations: 1 }).warnings).toEqual([]);
    expect(run(gofundme, "us", { fundraiserType: "charity", raised: 100000.01, donations: 1 }).warnings.length).toBe(1);
  });

  it("minimum donation edge in Mexico and Switzerland: exactly the minimum is fine", () => {
    expect(run(gofundme, "mx", { raised: 2500, donations: 100 }).warnings).toEqual([]);
    expect(run(gofundme, "ch", { raised: 499.99, donations: 100 }).warnings.length).toBe(1);
    expect(run(gofundme, "ch", { raised: 500, donations: 100 }).warnings).toEqual([]);
  });

  it("no money raised means no donations and no fees", () => {
    const r = run(gofundme, "us", { raised: 0 });
    expect(r.totalFees).toBe(0);
    expect(r.payout).toBe(0);
  });

  // ---- Reverse mode ----

  it("D2: to keep $10,000 from 100 donations you need to raise $10,329.56", () => {
    const m = M.us;
    const inputs = { ...gofundme.defaults(m), donations: 100 };
    const s = solvePrice(gofundme, inputs, m, "payout", 1_000_000);
    expect(s.price).toBe(1_032_956);
    expect(s.result!.payout).toBeGreaterThanOrEqual(1_000_000);
    expect(gofundme.calculate({ ...inputs, raised: (s.price! - 1) / 100 }, m).payout).toBeLessThan(1_000_000);
  });

  it("reverse, Sweden: to keep 1,000 kr from 20 donations raise (1,000 + 60) ÷ 0.971 = 1,091.66 kr", () => {
    const m = M.se;
    const inputs = { ...gofundme.defaults(m), donations: 20 };
    const s = solvePrice(gofundme, inputs, m, "payout", 100_000);
    expect(s.price).toBe(109_166);
    expect(gofundme.calculate({ ...inputs, raised: 1091.65 }, m).payout).toBe(99_999);
  });

  it("reverse mode works with a UK charity and with Pro donor covered fees", () => {
    for (const [market, extra] of [
      [M.uk, { fundraiserType: "charity" }],
      [M.us, { fundraiserType: "pro", donorCovers: true, proServiceFee: 3 }],
    ] as const) {
      const inputs = { ...gofundme.defaults(market), ...extra };
      const s = solvePrice(gofundme, inputs, market, "payout", 250_000);
      expect(s.price).not.toBeNull();
      expect(s.result!.payout).toBeGreaterThanOrEqual(250_000);
      expect(gofundme.calculate({ ...inputs, raised: (s.price! - 1) / 100 }, market).payout).toBeLessThan(250_000);
    }
  });
});
