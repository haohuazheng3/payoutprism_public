import { describe, expect, it } from "vitest";
import paypal from "@/fees/platforms/paypal";
import { solvePrice } from "@/fees/solve";
import { M } from "@/fees/markets";
import type { Inputs, Market } from "@/fees/types";
import { checkContract, line, run } from "./helpers";

/** Check the reverse solver: the price reaches the target and one cent less doesn't. */
function reverse(market: Market, overrides: Partial<Inputs>, goal: number) {
  const inputs = { ...paypal.defaults(market), ...overrides } as Inputs;
  const s = solvePrice(paypal, inputs, market, "payout", goal);
  expect(s.price).not.toBeNull();
  expect(s.result!.payout).toBeGreaterThanOrEqual(goal);
  const below = paypal.calculate({ ...inputs, amount: (s.price! - 1) / 100 }, market);
  expect(below.payout).toBeLessThan(goal);
  return s.price!;
}

describe("paypal", () => {
  it("meets the module contract in every market", () => {
    expect(checkContract(paypal)).toEqual([]);
  });

  /* ------------------------------------------------------------ official worked examples */

  it("official (PayPal newsroom 2022): $225.00 goods and services payment → $6.73 fee", () => {
    const r = run(paypal, "us", { payType: "gs", amount: 225 });
    expect(line(r, "transaction")).toBe(673); // 2.99% × 225.00 = 6.7275
    expect(r.payout).toBe(22500 - 673);
  });

  it("official (AU CFSGPDS 18.2): A$100 from a buyer in Australia → A$3.20 fee, seller receives A$96.80", () => {
    const r = run(paypal, "au", { amount: 100 });
    expect(line(r, "transaction")).toBe(320);
    expect(r.payout).toBe(9680);
  });

  it("official (AU CFSGPDS 18.3): A$100 from a buyer outside Australia → 3.90% + A$0.30 = A$4.20", () => {
    const r = run(paypal, "au", { amount: 100, payerAu: "intl" });
    expect(line(r, "transaction")).toBe(420);
  });

  it("official (AU CFSGPDS 18.4–18.5): refunds keep the fee, so a 50% refund leaves A$46.80 of A$96.80", () => {
    const r = run(paypal, "au", { amount: 100 });
    expect(r.payout - 10000).toBe(-320); // full refund: debited A$100 against A$96.80 received
    expect(r.payout - 5000).toBe(4680); // partial refund of A$50
  });

  /* ------------------------------------------------------------ derived: United States */

  it("US default: PayPal Checkout on $100 → 3.49% + $0.49 = $3.98, keep $96.02", () => {
    const r = run(paypal, "us");
    expect(line(r, "transaction")).toBe(398);
    expect(r.payout).toBe(9602);
    expect(r.buyerPays).toBe(10000);
  });

  it("US international payer adds 1.50% to the rate, not to the fixed fee ($100 → $5.48)", () => {
    expect(line(run(paypal, "us", { payerUs: "intl" }), "transaction")).toBe(548);
  });

  it("US payment types: Pay Later, card, Advanced cards, POS, QR, Venmo, Virtual Terminal, donations", () => {
    expect(line(run(paypal, "us", { payType: "paylater", amount: 200 }), "transaction")).toBe(1047); // 9.98 + 0.49
    expect(line(run(paypal, "us", { payType: "card" }), "transaction")).toBe(348);
    expect(line(run(paypal, "us", { payType: "acdc" }), "transaction")).toBe(318); // 2.89 + 0.29
    expect(line(run(paypal, "us", { payType: "pos", amount: 50 }), "transaction")).toBe(124); // 1.145 → 1.15 + 0.09
    expect(line(run(paypal, "us", { payType: "qr", amount: 10 }), "transaction")).toBe(32); // 0.229 → 0.23 + 0.09
    expect(line(run(paypal, "us", { payType: "venmo" }), "transaction")).toBe(398);
    expect(line(run(paypal, "us", { payType: "vt" }), "transaction")).toBe(368); // 3.39 + 0.29
    expect(line(run(paypal, "us", { payType: "donation" }), "transaction")).toBe(338);
    expect(line(run(paypal, "us", { payType: "charity" }), "transaction")).toBe(248);
    expect(line(run(paypal, "us", { payType: "posKeyed" }), "transaction")).toBe(358);
    expect(line(run(paypal, "us", { payType: "crypto" }), "transaction")).toBe(150); // 1.5% since Aug 1, 2026, no fixed fee
  });

  it("US: in-person and crypto payments have no international question; online types do", () => {
    const shown = (payType: string) => {
      const f = paypal.fields.find((x) => x.id === "payerUs")!;
      return f.showIf!({ ...paypal.defaults(M.us), payType }, M.us);
    };
    expect(shown("checkout")).toBe(true);
    expect(shown("invoiceBank")).toBe(true);
    expect(shown("pos")).toBe(false);
    expect(shown("crypto")).toBe(false);
    expect(shown("ff")).toBe(false);
  });

  it("US invoices: same rates as checkout, and Pay by Bank is 1% capped at $10.00 (edges)", () => {
    expect(line(run(paypal, "us", { payType: "invoice" }), "transaction")).toBe(398);
    expect(line(run(paypal, "us", { payType: "invoiceCard" }), "transaction")).toBe(348);
    expect(line(run(paypal, "us", { payType: "invoicePayLater" }), "transaction")).toBe(548);
    expect(line(run(paypal, "us", { payType: "invoiceBank", amount: 999.49 }), "transaction")).toBe(999);
    expect(line(run(paypal, "us", { payType: "invoiceBank", amount: 1000 }), "transaction")).toBe(1000);
    expect(line(run(paypal, "us", { payType: "invoiceBank", amount: 2000 }), "transaction")).toBe(1000); // research D12
    // International: the domestic 1% stays capped, the 1.5% international part is not.
    expect(line(run(paypal, "us", { payType: "invoiceBank", amount: 2000, payerUs: "intl" }), "transaction")).toBe(1000 + 3000);
  });

  it("fees are charged on shipping and sales tax too (the whole payment)", () => {
    const r = run(paypal, "us", { amount: 50, shipping: 8, salesTax: 8 });
    // 58.00 + 8% tax 4.64 = 62.64 paid; 3.49% × 62.64 = 2.186 → 2.19 + 0.49
    expect(r.buyerPays).toBe(6264);
    expect(line(r, "transaction")).toBe(268);
    expect(r.saleAmount).toBe(5800);
    expect(r.payout).toBe(5800 - 268);
  });

  it("US Dynamic Micropayments: whichever rate is lower for each payment (crossover ≈ $26.67)", () => {
    expect(line(run(paypal, "us", { payType: "micro", amount: 2 }), "transaction")).toBe(19); // research D7: 0.0998 + 0.09
    expect(line(run(paypal, "us", { payType: "checkout", amount: 2 }), "transaction")).toBe(56);
    expect(line(run(paypal, "us", { payType: "micro", amount: 20 }), "transaction")).toBe(109); // micro 1.09 < 1.19
    expect(line(run(paypal, "us", { payType: "micro", amount: 30 }), "transaction")).toBe(154); // standard 1.54 < 1.59
    expect(paypal.breakpoints!({ ...paypal.defaults(M.us), payType: "micro" }, M.us)).toContain(2667);
  });

  it("friends & family: free to receive; card-funded sends cost the sender 2.90% + $0.30", () => {
    const free = run(paypal, "us", { payType: "ff" });
    expect(free.totalFees).toBe(0);
    expect(free.payout).toBe(10000);
    const card = run(paypal, "us", { payType: "ffCard", shipping: 10, salesTax: 8, payerUs: "intl" });
    expect(card.payout).toBe(10000); // shipping, tax and the international question don't apply
    expect(card.buyerFees[0].amount).toBe(320); // research D8
    expect(card.buyerPays).toBe(10320);
  });

  it("instant transfers: business 1.5% (min $0.50, no max), personal 1.75% ($0.25–$25)", () => {
    // Friends & family keeps the whole amount in the balance, so the withdrawal base is the amount itself.
    expect(line(run(paypal, "us", { payType: "ff", amount: 2000, withdraw: "instantBiz" }), "withdrawal")).toBe(3000); // research D10
    expect(line(run(paypal, "us", { payType: "ff", amount: 10000, withdraw: "instantBiz" }), "withdrawal")).toBe(15000); // no cap
    expect(line(run(paypal, "us", { payType: "ff", amount: 20, withdraw: "instantBiz" }), "withdrawal")).toBe(50); // 0.30 → minimum
    expect(line(run(paypal, "us", { payType: "ff", amount: 2000, withdraw: "instantPersonal" }), "withdrawal")).toBe(2500);
    expect(line(run(paypal, "us", { payType: "ff", amount: 1428.57, withdraw: "instantPersonal" }), "withdrawal")).toBe(2500); // 24.999975
    expect(line(run(paypal, "us", { payType: "ff", amount: 1428, withdraw: "instantPersonal" }), "withdrawal")).toBe(2499); // 24.99
    expect(line(run(paypal, "us", { payType: "ff", amount: 10, withdraw: "instantPersonal" }), "withdrawal")).toBe(25);
    // On a sale it's charged on what the payment leaves in the balance, after PayPal's fee.
    const r = run(paypal, "us", { withdraw: "instantBiz" });
    expect(line(r, "withdrawal")).toBe(144); // 1.5% × 96.02 = 1.4403
    expect(r.fees.find((l) => l.id === "withdrawal")!.kind).toBe("payout");
    expect(r.payout).toBe(10000 - 398 - 144);
  });

  it("currency conversion: spread on the amount converted (3% US, 4% Canada)", () => {
    expect(line(run(paypal, "us", { currencyConversion: true }), "fx")).toBe(288); // 3% × 96.02
    expect(line(run(paypal, "ca", { currencyConversion: true }), "fx")).toBe(387); // 4% × 96.80
  });

  /* ------------------------------------------------------------ derived: other markets */

  it("UK: 2.9% + £0.30; +1.29% from the EEA, +1.99% elsewhere; BNPL 3.9%; £5 sale", () => {
    expect(line(run(paypal, "uk"), "transaction")).toBe(320); // UK-D1
    expect(line(run(paypal, "uk", { payerUk: "eea" }), "transaction")).toBe(449); // UK-D2
    expect(line(run(paypal, "uk", { payerUk: "other" }), "transaction")).toBe(519); // UK-D3
    expect(line(run(paypal, "uk", { payType: "paylater" }), "transaction")).toBe(420); // UK-D4
    expect(line(run(paypal, "uk", { amount: 5 }), "transaction")).toBe(45); // UK-D5: 0.145 → 0.15 + 0.30
    expect(line(run(paypal, "uk", { payType: "guestCard" }), "transaction")).toBe(150);
    expect(line(run(paypal, "uk", { payType: "pos" }), "transaction")).toBe(175);
    expect(line(run(paypal, "uk", { payType: "charity" }), "transaction")).toBe(160);
  });

  it("UK QR codes: £10.00 and below 2% + £0.05, £10.01 and above 1.5% + £0.10", () => {
    const at = (amount: number) => paypal.calculate({ ...paypal.defaults(M.uk), payType: "qr", amount }, M.uk);
    expect(line(at(5), "transaction")).toBe(15); // 0.10 + 0.05
    expect(at(10).fees[0].detail).toContain("2% ×");
    expect(line(at(10), "transaction")).toBe(25);
    expect(at(10.01).fees[0].detail).toContain("1.5% ×");
    expect(line(at(10.01), "transaction")).toBe(25); // 0.15015 → 0.15 + 0.10
    expect(line(at(50), "transaction")).toBe(85);
    // Shipping counts towards the threshold: £9 + £2 shipping is an £11 payment.
    expect(line(run(paypal, "uk", { payType: "qr", amount: 9, shipping: 2 }), "transaction")).toBe(27); // 0.165 → 0.17 + 0.10
  });

  it("UK tiered rate plan: 2.4% / 2.1% on eligible commercial payments only", () => {
    expect(line(run(paypal, "uk", { ukTier: "2.4" }), "transaction")).toBe(270);
    expect(line(run(paypal, "uk", { ukTier: "2.1" }), "transaction")).toBe(240);
    expect(line(run(paypal, "uk", { ukTier: "2.1", payerUk: "other" }), "transaction")).toBe(439); // 2.1 + 1.99
    expect(line(run(paypal, "uk", { ukTier: "2.1", payType: "guestCard" }), "transaction")).toBe(150);
  });

  it("Canada: 2.90% + C$0.30; US payer +0.80%; Pay Later 4.9%; card rates published as totals", () => {
    expect(line(run(paypal, "ca"), "transaction")).toBe(320); // CA-D1
    expect(line(run(paypal, "ca", { payerCa: "us" }), "transaction")).toBe(400); // CA-D2
    expect(line(run(paypal, "ca", { payerCa: "other" }), "transaction")).toBe(420);
    expect(line(run(paypal, "ca", { payType: "paylater" }), "transaction")).toBe(520); // CA-D3
    expect(line(run(paypal, "ca", { payType: "acdc", payerCa: "us" }), "transaction")).toBe(380); // 3.50% + 0.30
    expect(line(run(paypal, "ca", { payType: "vt", payerCa: "other" }), "transaction")).toBe(440); // 4.10% + 0.30
    expect(line(run(paypal, "ca", { payType: "charity", payerCa: "us" }), "transaction")).toBe(190); // 1.60% + 0.30
    expect(line(run(paypal, "ca", { payType: "qr", amount: 10 }), "transaction")).toBe(29); // 2.40% + 0.05
    expect(line(run(paypal, "ca", { payType: "qr", amount: 10.01 }), "transaction")).toBe(29); // 1.90% → 0.19 + 0.10
    expect(line(run(paypal, "ca", { payType: "ff", amount: 100, withdraw: "instantPersonal" }), "withdrawal")).toBe(175);
  });

  it("Australia: QR 1.20% no fixed fee; Advanced cards +2.10% international; card withdrawal 1% (A$0.25–A$10)", () => {
    expect(line(run(paypal, "au", { payType: "qr" }), "transaction")).toBe(120);
    expect(line(run(paypal, "au", { payType: "acdc", payerAu: "intl" }), "transaction")).toBe(390); // 3.60% + 0.30
    expect(line(run(paypal, "au", { payType: "ff", amount: 2000, withdraw: "card" }), "withdrawal")).toBe(1000);
    expect(line(run(paypal, "au", { payType: "ff", amount: 10, withdraw: "card" }), "withdrawal")).toBe(25);
    expect(run(paypal, "au", { payType: "ffCard" }).buyerFees[0].amount).toBe(290); // 2.60% + 0.30
  });

  it("Germany: business Checkout 2.99% + €0.39, goods & services / personal 2.49% + €0.35, by payer region", () => {
    expect(line(run(paypal, "de"), "transaction")).toBe(338); // DE-D1
    expect(line(run(paypal, "de", { payType: "gs" }), "transaction")).toBe(284); // DE-D2
    expect(line(run(paypal, "de", { payerDe: "uk" }), "transaction")).toBe(467); // DE-D3
    expect(line(run(paypal, "de", { payType: "gs", payerDe: "usca" }), "transaction")).toBe(483); // DE-D4
    expect(line(run(paypal, "de", { payType: "gs", payerDe: "other" }), "transaction")).toBe(583);
    expect(line(run(paypal, "de", { payerDe: "other" }), "transaction")).toBe(537);
    expect(line(run(paypal, "de", { payType: "donation", payerDe: "other" }), "transaction")).toBe(614); // 2.49 + 3.3
    expect(line(run(paypal, "de", { payType: "qrPrivate", amount: 10 }), "transaction")).toBe(15); // 1% + 0.05
    expect(line(run(paypal, "de", { payType: "qrPrivate", amount: 20 }), "transaction")).toBe(20); // 0.5% + 0.10
    expect(line(run(paypal, "de", { payType: "pos" }), "transaction")).toBe(139);
  });

  it("Germany: UK donors (Europe I) add 2 points; card, eTerminal, micropayment and VT rates across markets", () => {
    expect(line(run(paypal, "de", { payType: "donation", payerDe: "uk" }), "transaction")).toBe(484); // (2.49 + 2) + 0.35
    expect(line(run(paypal, "de", { payType: "charity", payerDe: "usca" }), "transaction")).toBe(384); // (1.50 + 1.99) + 0.35
    expect(line(run(paypal, "de", { payType: "vt" }), "transaction")).toBe(378); // eTerminal 3.39 + 0.39
    expect(line(run(paypal, "de", { payType: "posKeyed" }), "transaction")).toBe(325); // 2.9 + 0.35
    expect(line(run(paypal, "de", { payType: "micro", amount: 2 }), "transaction")).toBe(19); // 0.0998 + 0.09
    expect(line(run(paypal, "uk", { payType: "vt" }), "transaction")).toBe(320); // 2.9% + £0.30 since Oct 1, 2026
    expect(line(run(paypal, "uk", { payType: "micro", amount: 2, payerUk: "other" }), "transaction")).toBe(17); // 6% + £0.05
    expect(line(run(paypal, "ca", { payType: "micro", amount: 2, payerCa: "us" }), "transaction")).toBe(15); // 5.0% + C$0.05
    expect(line(run(paypal, "au", { payType: "vt", payerAu: "intl" }), "transaction")).toBe(490); // 4.60% + A$0.30 (CFSGPDS 17.4)
  });

  it("Germany: refunds keep only the fixed part; other markets keep the whole fee", () => {
    expect(run(paypal, "de").notes.join(" ")).toContain("0,39");
    expect(run(paypal, "us").notes.join(" ")).toContain("$3.98");
  });

  /* ------------------------------------------------------------ edges, worked by hand */

  it("edges one cent below and at each threshold, worked by hand", () => {
    // UK QR: £9.99 → 2% = 0.1998 → 0.20 + 0.05
    expect(line(run(paypal, "uk", { payType: "qr", amount: 9.99 }), "transaction")).toBe(25);
    // UK QR £10.00 from the EEA: (2% + 1.29%) × 10 = 0.329 → 0.33 + 0.05
    expect(line(run(paypal, "uk", { payType: "qr", amount: 10, payerUk: "eea" }), "transaction")).toBe(38);
    // Canada QR from a US payer: C$10.00 → (2.40% + 0.80%) × 10 = 0.32 + 0.05; C$10.01 → (1.90% + 0.80%) × 10.01 = 0.27027 → 0.27 + 0.10
    expect(line(run(paypal, "ca", { payType: "qr", amount: 10, payerCa: "us" }), "transaction")).toBe(37);
    expect(line(run(paypal, "ca", { payType: "qr", amount: 10.01, payerCa: "us" }), "transaction")).toBe(37);
    // US Pay by Bank: $999.50 → 9.995 → $10.00, the cap
    expect(line(run(paypal, "us", { payType: "invoiceBank", amount: 999.5 }), "transaction")).toBe(1000);
    // Australian card withdrawal (1%, A$0.25–A$10): A$24.99 → minimum; A$25.50 → 0.255 → 0.26; A$999.49 → 9.99; A$1,000 → 10.00
    const auWd = (amount: number) => line(run(paypal, "au", { payType: "ff", amount, withdraw: "card" }), "withdrawal");
    expect(auWd(24.99)).toBe(25);
    expect(auWd(25.5)).toBe(26);
    expect(auWd(999.49)).toBe(999);
    expect(auWd(1000)).toBe(1000);
    // On a A$100 sale the card withdrawal is 1% of the A$96.80 left: 0.968 → 0.97
    expect(line(run(paypal, "au", { withdraw: "card" }), "withdrawal")).toBe(97);
    // Germany: a donor anywhere in the EEA counts as domestic (2.49% + €0.35); elsewhere adds 3.3 points
    expect(line(run(paypal, "de", { payType: "donation" }), "transaction")).toBe(284);
    // UK Pay in 3 from outside the EEA, £50: (3.9% + 1.99%) × 50 = 2.945 → 2.95 + 0.30
    expect(line(run(paypal, "uk", { payType: "paylater", amount: 50, payerUk: "other" }), "transaction")).toBe(325);
    // US micropayments from abroad, $20: (4.99% + 1.5%) × 20 = 1.298 → 1.30 + 0.09 beats (3.49% + 1.5%) × 20 + 0.49 = 1.49
    expect(line(run(paypal, "us", { payType: "micro", amount: 20, payerUs: "intl" }), "transaction")).toBe(139);
    // US micropayments just past the crossover, $27: standard 0.9423 → 0.94 + 0.49 = 1.43 beats 1.3473 → 1.35 + 0.09
    expect(line(run(paypal, "us", { payType: "micro", amount: 27 }), "transaction")).toBe(143);
    // Canada with 13% HST: C$100 + C$10 shipping → C$124.30; 2.90% × 124.30 = 3.6047 → 3.60 + 0.30
    const ca = run(paypal, "ca", { shipping: 10, salesTax: 13 });
    expect(ca.buyerPays).toBe(12430);
    expect(line(ca, "transaction")).toBe(390);
    // US international Checkout with conversion: 5.48 fee, then 3% × 94.52 = 2.8356 → 2.84; keep 91.68
    expect(run(paypal, "us", { payerUs: "intl", currencyConversion: true }).payout).toBe(9168);
  });

  it("the payer question's help states the surcharge of the payment type picked", () => {
    const help = (marketId: string, field: string, payType: string) => {
      const m = paypal.markets.find((x) => x.id === marketId)!;
      const f = paypal.fields.find((x) => x.id === field)!;
      const i = { ...paypal.defaults(m), payType } as Inputs;
      return typeof f.help === "function" ? f.help(i, m) : f.help;
    };
    expect(help("us", "payerUs", "checkout")).toContain("+1.5%");
    expect(help("au", "payerAu", "checkout")).toContain("+1%");
    expect(help("au", "payerAu", "acdc")).toContain("+2.1%"); // Advanced cards add 2.10%, not 1%
    expect(help("ca", "payerCa", "charity")).toContain("US +0%"); // 1.60% from Canada and the US
    expect(help("uk", "payerUk", "micro")).toContain("+1%"); // 5% → 6%
    expect(help("de", "payerDe", "donation")).toContain("UK +2%");
    expect(help("de", "payerDe", "gs")).toContain("elsewhere +2.99%");
  });

  it("refund and surcharge notes only where the fee pages' rules apply", () => {
    const pos = run(paypal, "us", { payType: "pos" }).notes.join(" ");
    expect(pos).not.toContain("refund");
    expect(pos).not.toContain("surcharge");
    const acdc = run(paypal, "us", { payType: "acdc" }).notes.join(" ");
    expect(acdc).toContain("$3.18");
    expect(acdc).not.toContain("surcharge");
    expect(run(paypal, "us", { payType: "gs" }).notes.join(" ")).toContain("surcharge");
  });

  /* ------------------------------------------------------------ reverse mode */

  it("reverse: lowest amount to charge to receive $500 (US default) and £100 (UK)", () => {
    expect(reverse(M.us, {}, 50000)).toBe(51859); // (500 + 0.49) / (1 − 3.49%) = 518.59
    expect(reverse(M.uk, {}, 10000)).toBe(10330); // research: £103.30
  });

  it("reverse works across the Pay by Bank cap, the QR tier, the micropayments crossover and transfer minimums", () => {
    expect(reverse(M.us, { payType: "invoiceBank" }, 200000)).toBe(201000); // fee capped at $10
    expect(reverse(M.us, { payType: "invoiceBank" }, 50000)).toBe(50505); // 1% under the cap: 505.05 − 5.05
    expect(reverse(M.uk, { payType: "qr" }, 976)).toBe(1001);
    expect(reverse(M.us, { payType: "micro" }, 2500)).toBeGreaterThan(2600);
    reverse(M.us, { withdraw: "instantBiz" }, 3000);
    reverse(M.us, { withdraw: "instantPersonal", amount: 5000 }, 200000);
    reverse(M.ca, { payType: "qr", payerCa: "us" }, 900);
    reverse(M.de, { payType: "gs", withdraw: "card", currencyConversion: true }, 25000);
    expect(reverse(M.us, { payType: "ffCard" }, 12345)).toBe(12345);
  });

  it("breakpoints mark the QR tier, the Pay by Bank cap and withdrawal minimums", () => {
    expect(paypal.breakpoints!({ ...paypal.defaults(M.uk), payType: "qr" }, M.uk)).toEqual([1001]);
    expect(paypal.breakpoints!({ ...paypal.defaults(M.us), payType: "invoiceBank" }, M.us)).toEqual([99950]); // 1% of $999.50 rounds to $10.00
    const bp = paypal.breakpoints!({ ...paypal.defaults(M.us), payType: "ff", withdraw: "instantPersonal" }, M.us);
    expect(bp).toEqual([1400, 142829]); // 1.75% of $14.00 rounds to $0.25; of $1,428.29 to $25.00
  });

  it("every market's schedule and options are complete", () => {
    for (const m of paypal.markets) {
      const rows = paypal.schedule(m);
      expect(rows.length).toBeGreaterThan(8);
      expect(rows.some((r) => r.fee === "International payment")).toBe(true);
    }
  });
});
