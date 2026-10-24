/*
 * Stripe payment fees on standard (pay-as-you-go) pricing. Every number is from Stripe's own pages
 * (see `sources`), re-read on 2026-10-23. Research notes with verbatim quotes: research/fees/stripe.md.
 *
 * How one payment is costed (what this module reproduces):
 *  - Processing: rate × the whole charge (Stripe doesn't know which part is shipping or tax) + a
 *    fixed fee per successful payment, in the account's currency. US / Canada list surcharges on
 *    top of the domestic rate (international card +1.5% / +0.8%, manually entered card +0.5%);
 *    UK / Germany / Australia list a full rate per card type (standard, premium = business cards,
 *    EEA or UK cards, international). The fixed fee is charged once.
 *  - Currency conversion: +1% (US) or +2% (elsewhere) of the converted amount, shown by Stripe as
 *    its own fee line.
 *  - Bank debits and transfers: percentage with a cap (ACH, PAD, BECS/PayTo, Pay by Bank) or a
 *    minimum and cap (Bacs), or a flat fee (SEPA). We read "cap" as a cap on the whole fee (Stripe's
 *    pricing page doesn't say whether the fixed part is included; it only matters for PAD,
 *    BECS/PayTo and Pay by Bank).
 *  - Buy now, pay later: rate + fixed fee for a customer in your own country (Klarna's rate depends
 *    on the customer's country).
 *  - Add-ons on top of the payment fee: Billing 0.7%, Invoicing 0.4% / 0.5%, post-payment invoices
 *    0.4% up to US$2, Stripe Tax Basic 0.5% of the total incl. tax (or a fixed fee per API
 *    transaction), Radar Standard / Plus / Pro per screened payment.
 *  - Instant Payout: rate × the amount paid out (this payment's net), with a minimum per payout.
 *  - Disputes (cards): received fee, countered fee (returned if you win), Smart Disputes 30% of
 *    the disputed amount when won, and the payment itself when you lose.
 * Rounding: Stripe rounds each Stripe fee to the nearest cent, half up (Pricing Policy §1.3), so
 * each fee line is rounded once. The processing line is one fee (rate incl. surcharges × amount,
 * rounded, + fixed), as Stripe lists it.
 */
import { M } from "../markets";
import { assemble, bool, costLines, formatRate, moneyFor, num, pct, str, toCents } from "../money";
import { fromUsd, FX_DATE } from "../fx";
import type { CalculatorDef, FeeChange, Inputs, Line, Market, ScheduleRow, SelectOption, Source } from "../types";

const MARKETS: Market[] = [M.us, M.uk, M.ca, M.au, M.de];

/* ---------------- dates ---------------- */

/** Australia, international cards: 3.5% until 31 March 2027, 2.8% from 1 April 2027 (00:00 AEDT). */
export function auIntlRate(at: number = Date.now()): number {
  return at >= Date.UTC(2027, 2, 31, 13, 0) ? 2.8 : 3.5;
}

/**
 * Accounts that used Radar before 2026-07-29 are on a free Radar Standard trial until 2027-01-22; accounts that used
 * Radar for Fraud Teams were moved to Radar Plus and pay the new price from the same date (support page, Jan 2027).
 */
export function radarTrialActive(at: number = Date.now()): boolean {
  return at < Date.UTC(2027, 0, 22);
}

/* ---------------- sources ---------------- */

const S = {
  pricing: { us: "stripe-pricing-us", uk: "stripe-pricing-uk", ca: "stripe-pricing-ca", au: "stripe-pricing-au", de: "stripe-pricing-de" } as Record<string, string>,
  lpm: { us: "stripe-lpm-us", uk: "stripe-lpm-uk", ca: "stripe-lpm-ca", au: "stripe-lpm-au", de: "stripe-lpm-de" } as Record<string, string>,
  radar: { us: "stripe-radar-us", uk: "stripe-radar-uk", ca: "stripe-radar-ca", au: "stripe-radar-au", de: "stripe-radar-de" } as Record<string, string>,
  billing: "stripe-billing",
  invoicing: "stripe-invoicing",
  tax: "stripe-tax-support",
  radar2027: "stripe-radar-2027",
  disputes: "stripe-disputes-2025",
  auCards: "stripe-au-cards-2026",
  manual: "stripe-manual",
  premium: "stripe-premium",
  fx: "stripe-fx",
  refunds: "stripe-refunds",
  policy: "stripe-pricing-policy",
  billing2024: "stripe-billing-2024",
  caTax: "stripe-ca-tax",
  currencies: "stripe-currencies",
} as const;

const sources: Source[] = [
  { id: S.pricing.us, title: "Pricing & Fees", url: "https://stripe.com/pricing", publisher: "Stripe", checked: "2026-10-23" },
  { id: S.pricing.uk, title: "Pricing & Fees", url: "https://stripe.com/gb/pricing", publisher: "Stripe (United Kingdom)", checked: "2026-10-23" },
  { id: S.pricing.ca, title: "Pricing & Fees", url: "https://stripe.com/en-ca/pricing", publisher: "Stripe (Canada)", checked: "2026-10-23" },
  { id: S.pricing.au, title: "Pricing & Fees", url: "https://stripe.com/au/pricing", publisher: "Stripe (Australia)", checked: "2026-10-23" },
  { id: S.pricing.de, title: "Pricing & Fees", url: "https://stripe.com/en-de/pricing", publisher: "Stripe (Germany)", checked: "2026-10-23" },
  { id: S.lpm.us, title: "Local payment methods pricing", url: "https://stripe.com/pricing/local-payment-methods", publisher: "Stripe", checked: "2026-10-23" },
  { id: S.lpm.uk, title: "Local payment methods pricing", url: "https://stripe.com/gb/pricing/local-payment-methods", publisher: "Stripe (United Kingdom)", checked: "2026-10-23" },
  { id: S.lpm.ca, title: "Local payment methods pricing", url: "https://stripe.com/en-ca/pricing/local-payment-methods", publisher: "Stripe (Canada)", checked: "2026-10-23" },
  { id: S.lpm.au, title: "Local payment methods pricing", url: "https://stripe.com/au/pricing/local-payment-methods", publisher: "Stripe (Australia)", checked: "2026-10-23" },
  { id: S.lpm.de, title: "Local payment methods pricing", url: "https://stripe.com/en-de/pricing/local-payment-methods", publisher: "Stripe (Germany)", checked: "2026-10-23" },
  { id: S.radar.us, title: "Stripe Radar | Pricing and Fees", url: "https://stripe.com/radar/pricing", publisher: "Stripe", checked: "2026-10-23" },
  { id: S.radar.uk, title: "Stripe Radar | Pricing and Fees", url: "https://stripe.com/gb/radar/pricing", publisher: "Stripe (United Kingdom)", checked: "2026-10-23" },
  { id: S.radar.ca, title: "Stripe Radar | Pricing and Fees", url: "https://stripe.com/en-ca/radar/pricing", publisher: "Stripe (Canada)", checked: "2026-10-23" },
  { id: S.radar.au, title: "Stripe Radar | Pricing and Fees", url: "https://stripe.com/au/radar/pricing", publisher: "Stripe (Australia)", checked: "2026-10-23" },
  { id: S.radar.de, title: "Stripe Radar | Pricing and Fees", url: "https://stripe.com/en-de/radar/pricing", publisher: "Stripe (Germany)", checked: "2026-10-23" },
  { id: S.billing, title: "Stripe Billing | Pricing", url: "https://stripe.com/billing/pricing", publisher: "Stripe", checked: "2026-10-23" },
  { id: S.invoicing, title: "Invoicing built for speed and scale", url: "https://stripe.com/invoicing/pricing", publisher: "Stripe", checked: "2026-10-23" },
  { id: S.tax, title: "Understanding Stripe Tax pricing", url: "https://support.stripe.com/questions/understanding-stripe-tax-pricing", publisher: "Stripe Support", checked: "2026-10-23" },
  { id: S.radar2027, title: "Updates to Radar pricing (January 2027)", url: "https://support.stripe.com/questions/updates-to-radar-pricing-(january-2027)", publisher: "Stripe Support", checked: "2026-10-23" },
  { id: S.disputes, title: "June 2025 pricing updates for disputes", url: "https://support.stripe.com/questions/june-2025-pricing-updates-for-disputes", publisher: "Stripe Support", checked: "2026-10-23" },
  { id: S.auCards, title: "Updates to card pricing in Australia from October 2026", url: "https://support.stripe.com/questions/updates-to-card-pricing-in-australia-from-october-2026", publisher: "Stripe Support", checked: "2026-10-23" },
  { id: S.manual, title: "Manually entered card payments", url: "https://support.stripe.com/questions/manually-entered-card-payments", publisher: "Stripe Support", checked: "2026-10-23" },
  { id: S.premium, title: "What’s the difference between standard and premium cards?", url: "https://support.stripe.com/questions/what-s-the-difference-between-standard-and-premium-cards", publisher: "Stripe Support", checked: "2026-10-23" },
  { id: S.fx, title: "Understanding your currency conversion fees", url: "https://support.stripe.com/questions/understanding-your-currency-conversion-fees", publisher: "Stripe Support", checked: "2026-10-23" },
  { id: S.refunds, title: "Understanding fees for refunded payments", url: "https://support.stripe.com/questions/understanding-fees-for-refunded-payments", publisher: "Stripe Support", checked: "2026-10-23" },
  { id: S.policy, title: "Stripe Pricing Policy", url: "https://stripe.com/legal/pricing-policy", publisher: "Stripe", checked: "2026-10-23" },
  { id: S.billing2024, title: "July 2024 changes to Stripe Billing", url: "https://support.stripe.com/questions/july-2024-changes-to-stripe-billing", publisher: "Stripe Support", checked: "2026-10-23" },
  { id: S.caTax, title: "Taxes on Stripe fees for businesses based in Canada", url: "https://support.stripe.com/questions/taxes-on-stripe-fees-for-businesses-based-in-canada", publisher: "Stripe Support", checked: "2026-10-23" },
  { id: S.currencies, title: "Supported currencies", url: "https://docs.stripe.com/currencies", publisher: "Stripe Docs", checked: "2026-10-23" },
];

/* ---------------- rates by account country ---------------- */

/** Card types as Stripe prices them: domestic standard, domestic premium (business), regional (EEA cards for UK accounts, UK cards for EEA accounts), international. */
type Band = "domestic" | "premium" | "regional" | "intl";

interface Cfg {
  /** Online cards: full percentage by card type (US/CA intl = domestic + surcharge). */
  card: { domestic: number; premium?: number; regional?: number; intl: (at: number) => number; intlSurcharge?: number; manual?: number; fixed: number };
  /** Currency conversion, percent. */
  fx: number;
  /** In-person (Stripe Terminal) cards. */
  terminal: { domestic: number; intl: (at: number) => number; fixed: number; tap: number; interac?: number };
  instant: { rate: number; min: number };
  dispute: { received: number; countered: number };
  radar: { standard: number; plus: number; pro: number };
  /** Stripe Tax Basic, API integration, per transaction. */
  taxApi: number;
  /** Minimum charge amount (docs.stripe.com/currencies). */
  minCharge: number;
  /** What Stripe calls a domestic card here, for explanations. */
  cardHome: string;
}

const CFG: Record<string, Cfg> = {
  us: {
    card: { domestic: 2.9, intl: () => 4.4, intlSurcharge: 1.5, manual: 0.5, fixed: 30 },
    fx: 1,
    terminal: { domestic: 2.7, intl: () => 4.2, fixed: 5, tap: 10 },
    instant: { rate: 1.5, min: 50 },
    dispute: { received: 1500, countered: 1500 },
    radar: { standard: 5, plus: 7, pro: 9 },
    taxApi: 50,
    minCharge: 50,
    cardHome: "the US",
  },
  uk: {
    card: { domestic: 1.5, premium: 2.8, regional: 2.5, intl: () => 3.15, fixed: 20 },
    fx: 2,
    terminal: { domestic: 1.4, intl: () => 2.9, fixed: 10, tap: 10 },
    instant: { rate: 1, min: 40 },
    dispute: { received: 2000, countered: 2000 },
    radar: { standard: 4, plus: 6, pro: 8 },
    taxApi: 40,
    minCharge: 30,
    cardHome: "the UK",
  },
  ca: {
    card: { domestic: 2.9, intl: () => 3.7, intlSurcharge: 0.8, manual: 0.5, fixed: 30 },
    fx: 2,
    terminal: { domestic: 2.7, intl: () => 3.5, fixed: 5, tap: 15, interac: 15 },
    instant: { rate: 1, min: 60 },
    dispute: { received: 1500, countered: 1500 },
    radar: { standard: 7, plus: 10, pro: 12 },
    taxApi: 50,
    minCharge: 50,
    cardHome: "Canada",
  },
  au: {
    card: { domestic: 1.65, intl: auIntlRate, fixed: 30 },
    fx: 2,
    terminal: { domestic: 1.65, intl: auIntlRate, fixed: 10, tap: 15 },
    instant: { rate: 1.5, min: 50 },
    dispute: { received: 2500, countered: 2500 },
    radar: { standard: 8, plus: 10, pro: 13 },
    taxApi: 75,
    minCharge: 50,
    cardHome: "Australia",
  },
  de: {
    card: { domestic: 1.5, premium: 2.8, regional: 2.5, intl: () => 3.15, fixed: 25 },
    fx: 2,
    terminal: { domestic: 1.4, intl: () => 2.9, fixed: 10, tap: 10 },
    instant: { rate: 1, min: 50 },
    dispute: { received: 2000, countered: 2000 },
    radar: { standard: 5, plus: 7, pro: 9 },
    taxApi: 45,
    minCharge: 50,
    cardHome: "the EEA",
  },
};

const cfgFor = (market: Market) => CFG[market.id] ?? CFG.us;

/* ---------------- payment methods ---------------- */

type MethodKind = "card" | "manual" | "terminal" | "tap" | "interac" | "simple";

interface Method {
  id: string;
  label: string;
  group: string;
  kind: MethodKind;
  /** For "simple" methods: percentage, fixed fee (cents), minimum and cap on the whole fee (cents). */
  rate?: number;
  fixed?: number;
  min?: number;
  cap?: number;
  /** Stripe lists "+ x% if currency conversion is required" for this method. */
  fx?: boolean;
  /** Plain-language explanation for the processing line. */
  explain?: string;
  source: "pricing" | "lpm";
}

const GROUP = { cards: "Cards & wallets", bank: "Bank payments", bnpl: "Buy now, pay later", person: "In person", other: "Other" };

const card = (label: string): Method => ({ id: "card", label, group: GROUP.cards, kind: "card", fx: true, source: "pricing" });
const terminal: Method = { id: "terminal", label: "In person: card reader", group: GROUP.person, kind: "terminal", source: "pricing" };
const tap: Method = { id: "tap", label: "In person: Tap to Pay on a phone", group: GROUP.person, kind: "tap", source: "pricing" };

const METHODS: Record<string, Method[]> = {
  us: [
    card("Card or wallet online (Apple Pay, Google Pay, Link, Cash App Pay)"),
    { id: "manual", label: "Card typed in by you (Dashboard or phone order)", group: GROUP.cards, kind: "manual", fx: true, source: "pricing" },
    { id: "link_bank", label: "Link instant bank payment", group: GROUP.bank, kind: "simple", rate: 2.6, fixed: 30, source: "pricing", explain: "Link’s instant bank payments cost 2.6% + 30¢ of the whole payment." },
    { id: "ach", label: "ACH Direct Debit", group: GROUP.bank, kind: "simple", rate: 0.8, cap: 500, source: "lpm", explain: "ACH Direct Debit costs 0.8% of the payment, never more than $5.00, with standard settlement timing. Failed debits cost $4.00 and ACH disputes $15.00." },
    { id: "bank_transfer", label: "Bank transfer from the customer (ACH credit)", group: GROUP.bank, kind: "simple", rate: 0.5, cap: 500, source: "lpm", explain: "A USD bank transfer into your Stripe account costs 0.5%, capped at $5.00. Stripe also lists $15.00 per wire payment." },
    { id: "klarna", label: "Klarna", group: GROUP.bnpl, kind: "simple", rate: 5.99, fixed: 30, fx: true, source: "lpm", explain: "Klarna costs 5.99% + 30¢ for customers in the US or Canada. Stripe prices Klarna by the customer’s country; other countries have other rates." },
    { id: "affirm", label: "Affirm (standard)", group: GROUP.bnpl, kind: "simple", rate: 6, fixed: 30, source: "lpm", explain: "Affirm’s standard package costs 6% + 30¢. You’re paid in full; Affirm collects the installments." },
    { id: "affirm_enhanced", label: "Affirm (enhanced, more 0% APR plans)", group: GROUP.bnpl, kind: "simple", rate: 7.99, fixed: 30, source: "lpm", explain: "Affirm’s enhanced package, which offers customers more interest-free plans, costs 7.99% + 30¢." },
    { id: "afterpay", label: "Cash App Afterpay", group: GROUP.bnpl, kind: "simple", rate: 6, fixed: 30, fx: true, source: "lpm", explain: "Cash App Afterpay costs 6% + 30¢. You’re paid in full; Afterpay collects the installments." },
    { id: "zip", label: "Zip (Pay in 4)", group: GROUP.bnpl, kind: "simple", rate: 4.5, fixed: 30, source: "lpm", explain: "Zip’s “Pay in 4” (where the customer pays Zip a fee) costs you 4.5% + 30¢." },
    { id: "stablecoin", label: "Stablecoins", group: GROUP.other, kind: "simple", rate: 1.5, source: "pricing", explain: "Stablecoin payments cost 1.5% of the amount in USD, including conversion to dollars." },
    terminal,
    tap,
  ],
  uk: [
    card("Card or wallet online (Apple Pay, Google Pay, Onelink)"),
    { id: "pay_by_bank", label: "Pay by Bank", group: GROUP.bank, kind: "simple", rate: 0.5, fixed: 20, cap: 500, fx: true, source: "lpm", explain: "Pay by Bank (open banking) costs 0.5% + 20p, capped at £5.00." },
    { id: "bacs", label: "Bacs Direct Debit", group: GROUP.bank, kind: "simple", rate: 1, min: 20, cap: 400, fx: true, source: "pricing", explain: "Bacs Direct Debit costs 1% of the payment, at least 20p and never more than £4.00. Bacs disputes cost £5.00." },
    { id: "klarna", label: "Klarna (customer in the UK)", group: GROUP.bnpl, kind: "simple", rate: 4.99, fixed: 35, fx: true, source: "lpm", explain: "Klarna costs 4.99% + 35p for customers in the UK. Stripe prices Klarna by the customer’s country; other countries have other rates." },
    { id: "clearpay", label: "Clearpay", group: GROUP.bnpl, kind: "simple", rate: 6, fixed: 30, fx: true, source: "lpm", explain: "Clearpay costs 6% + 30p. You’re paid in full; Clearpay collects the instalments." },
    terminal,
    tap,
  ],
  ca: [
    card("Card or wallet online (Apple Pay, Google Pay, Link)"),
    { id: "manual", label: "Card typed in by you (Dashboard or phone order)", group: GROUP.cards, kind: "manual", fx: true, source: "pricing" },
    { id: "pad", label: "Pre-authorised debit (PAD)", group: GROUP.bank, kind: "simple", rate: 1, fixed: 40, cap: 500, source: "pricing", explain: "Pre-authorised debits cost 1% + CA$0.40, capped at CA$5.00. Failures and disputes cost CA$5.00, instant bank verification CA$1.00." },
    { id: "klarna", label: "Klarna", group: GROUP.bnpl, kind: "simple", rate: 5.99, fixed: 30, fx: true, source: "lpm", explain: "Klarna costs 5.99% + CA$0.30 for customers in Canada or the US. Stripe prices Klarna by the customer’s country; other countries have other rates." },
    { id: "affirm", label: "Affirm (standard)", group: GROUP.bnpl, kind: "simple", rate: 6, fixed: 30, source: "lpm", explain: "Affirm’s standard package costs 6% + CA$0.30. You’re paid in full; Affirm collects the instalments." },
    { id: "affirm_enhanced", label: "Affirm (enhanced, more 0% APR plans)", group: GROUP.bnpl, kind: "simple", rate: 7.99, fixed: 30, source: "lpm", explain: "Affirm’s enhanced package, with more interest-free plans for customers, costs 7.99% + CA$0.30." },
    { id: "afterpay", label: "Afterpay", group: GROUP.bnpl, kind: "simple", rate: 6, fixed: 30, fx: true, source: "lpm", explain: "Afterpay costs 6% + CA$0.30. You’re paid in full; Afterpay collects the instalments." },
    terminal,
    { id: "interac", label: "In person: Interac debit", group: GROUP.person, kind: "interac", source: "pricing" },
    tap,
  ],
  au: [
    card("Card or wallet online (Apple Pay, Google Pay, Link)"),
    { id: "becs", label: "BECS Direct Debit or PayTo", group: GROUP.bank, kind: "simple", rate: 1, fixed: 30, cap: 350, source: "pricing", explain: "BECS Direct Debit and PayTo cost 1% + A$0.30, capped at A$3.50, GST included." },
    { id: "afterpay", label: "Afterpay", group: GROUP.bnpl, kind: "simple", rate: 6, fixed: 30, fx: true, source: "lpm", explain: "Afterpay (Pay in 4 and monthly instalments) costs 6% + A$0.30. You’re paid in full; Afterpay collects the instalments." },
    { id: "zip", label: "Zip", group: GROUP.bnpl, kind: "simple", rate: 5.49, fixed: 30, source: "pricing", explain: "Zip Pay, and Zip Money with up to 6 months interest-free, cost 5.49% + A$0.30 including GST. Longer Zip Money plans cost 7–11%." },
    { id: "klarna", label: "Klarna", group: GROUP.bnpl, kind: "simple", rate: 4.99, fixed: 55, fx: true, source: "lpm", explain: "Klarna costs 4.99% + A$0.55 for customers in Australia or New Zealand." },
    terminal,
    tap,
  ],
  de: [
    card("Card or wallet online (Apple Pay, Google Pay, Link)"),
    { id: "sepa", label: "SEPA Direct Debit", group: GROUP.bank, kind: "simple", fixed: 35, fx: true, source: "pricing", explain: "SEPA Direct Debit is a flat €0.35 per successful payment, whatever the amount. Failed debits cost €3.50 and disputes €15.00." },
    { id: "klarna", label: "Klarna (customer in Germany)", group: GROUP.bnpl, kind: "simple", rate: 2.99, fixed: 35, fx: true, source: "lpm", explain: "Klarna costs 2.99% + €0.35 for customers in Germany, Austria, Belgium, the Netherlands or Switzerland. Stripe prices Klarna by the customer’s country; other countries have other rates." },
    terminal,
    tap,
  ],
};

function methodsFor(market: Market): Method[] {
  return METHODS[market.id] ?? METHODS.us;
}

function methodFor(market: Market, id: string): Method {
  const list = methodsFor(market);
  return list.find((m) => m.id === id) ?? list[0];
}

const usesCard = (m: Method) => m.kind === "card" || m.kind === "manual" || m.kind === "terminal" || m.kind === "tap";

/** The card type the inputs describe, in Stripe's terms for this account country. */
function bandOf(inputs: Inputs, market: Market): Band {
  if (market.id === "uk") {
    const v = str(inputs, "cardUk", "uk");
    return v === "premium" ? "premium" : v === "eea" ? "regional" : v === "intl" ? "intl" : "domestic";
  }
  if (market.id === "de") {
    const v = str(inputs, "cardEea", "eea");
    return v === "premium" ? "premium" : v === "uk" ? "regional" : v === "intl" ? "intl" : "domestic";
  }
  return str(inputs, "cardFrom", "domestic") === "international" ? "intl" : "domestic";
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Online card percentage for a card type, plus a sentence on why. */
function cardRate(cfg: Cfg, band: Band, manual: boolean, market: Market, at: number): { rate: number; why: string } {
  const c = cfg.card;
  let rate = c.domestic;
  let why = `${formatRate(c.domestic)} for a ${c.premium !== undefined ? "standard (personal) " : ""}card issued in ${cfg.cardHome}`;
  if (band === "premium" && c.premium !== undefined) {
    rate = c.premium;
    why = `${formatRate(c.premium)} for a business, corporate or commercial Visa or Mastercard issued in ${cfg.cardHome} (Stripe calls these premium cards)`;
  } else if (band === "regional" && c.regional !== undefined) {
    rate = c.regional;
    why = `${formatRate(c.regional)} for a card issued in ${market.id === "uk" ? "the European Economic Area" : "the UK"}`;
  } else if (band === "intl") {
    rate = c.intl(at);
    why =
      c.intlSurcharge !== undefined
        ? `${formatRate(c.domestic)} + ${formatRate(c.intlSurcharge)} because the card was issued outside ${cfg.cardHome}`
        : `${formatRate(rate)} because the card was issued outside ${market.id === "uk" ? "the UK and the EEA" : market.id === "de" ? "the EEA and the UK" : cfg.cardHome}`;
  }
  if (manual && c.manual !== undefined) {
    rate += c.manual;
    why += `, + ${formatRate(c.manual)} because the card details were typed in`;
  }
  return { rate: round3(rate), why };
}

/* ---------------- calculate ---------------- */

function calculate(inputs: Inputs, market: Market) {
  const at = Date.now();
  const money = moneyFor(market);
  const cfg = cfgFor(market);
  const us = market.id === "us";
  const amount = toCents(num(inputs, "price"));
  const method = methodFor(market, str(inputs, "method", "card"));
  const band = bandOf(inputs, market);
  const pricingSrc = S.pricing[market.id] ?? S.pricing.us;
  const lpmSrc = S.lpm[market.id] ?? S.lpm.us;
  const gstNote = market.id === "au" ? " Stripe’s Australian fees include GST." : "";
  const fees: Line[] = [];

  /* processing */
  let processing = 0;
  /** The percentage that applied to the amount (0 for flat fees, or when a cap or minimum set the fee). */
  let procRate = 0;
  if (method.kind === "card" || method.kind === "manual") {
    const manual = method.kind === "manual";
    const { rate, why } = cardRate(cfg, band, manual, market, at);
    processing = pct(amount, rate) + cfg.card.fixed;
    procRate = rate;
    fees.push({
      id: "processing",
      label: "Stripe processing fee",
      amount: processing,
      kind: "payment",
      detail: `${formatRate(rate)} × ${money(amount)} + ${money(cfg.card.fixed)}`,
      explain: `${why}, plus ${money(cfg.card.fixed)} per successful payment. Stripe charges it on the whole amount, so shipping and any tax in the payment cost the same percentage.${
        manual ? " Cards first keyed into the Dashboard keep this rate when you charge them again (subscriptions only on the first payment)." : ""
      }${gstNote}`,
      source: manual ? S.manual : band === "premium" ? S.premium : market.id === "au" && band === "intl" ? S.auCards : pricingSrc,
    });
  } else if (method.kind === "terminal" || method.kind === "tap") {
    const t = cfg.terminal;
    // In person Stripe lists two bands: cards from home (incl. EEA for UK accounts) and the rest.
    const intl = band === "intl" || (market.id === "de" && band === "regional");
    const rate = intl ? t.intl(at) : t.domestic;
    processing = pct(amount, rate) + t.fixed;
    procRate = rate;
    const homeWord = market.id === "uk" ? "UK and EEA" : market.id === "de" ? "EEA" : "domestic";
    fees.push({
      id: "processing",
      label: "Stripe Terminal fee",
      amount: processing,
      kind: "payment",
      detail: `${formatRate(rate)} × ${money(amount)} + ${money(t.fixed)}`,
      explain: `In-person card payments cost ${formatRate(t.domestic)} + ${money(t.fixed)} for ${homeWord} cards and ${formatRate(t.intl(at))} + ${money(t.fixed)} for ${
        market.id === "uk" || market.id === "de" ? "non-EEA" : "international"
      } cards.${market.id === "uk" ? " Stripe’s UK page says “EEA cards”; we apply that rate to UK cards too." : ""}${gstNote}`,
      source: market.id === "au" ? S.auCards : pricingSrc,
    });
    if (method.kind === "tap") {
      fees.push({
        id: "tapToPay",
        label: "Tap to Pay fee",
        amount: t.tap,
        kind: "payment",
        detail: `${money(t.tap)} per authorization`,
        explain: `Taking the payment on your own iPhone or Android phone adds ${money(t.tap)} per authorization to the card fee.`,
        source: pricingSrc,
      });
    }
  } else if (method.kind === "interac") {
    processing = cfg.terminal.interac ?? 0;
    fees.push({
      id: "processing",
      label: "Stripe Terminal fee (Interac)",
      amount: processing,
      kind: "payment",
      detail: `${money(processing)} flat`,
      explain: "Interac debit cards on a Stripe reader cost a flat CA$0.15 per transaction, whatever the amount.",
      source: pricingSrc,
    });
  } else {
    const raw = (method.rate ? pct(amount, method.rate) : 0) + (method.fixed ?? 0);
    let fee = raw;
    let note = "";
    if (method.min !== undefined && fee < method.min) {
      fee = method.min;
      note = `, raised to the ${money(method.min)} minimum`;
    }
    if (method.cap !== undefined && fee > method.cap) {
      fee = method.cap;
      note = `, capped at ${money(method.cap)}`;
    }
    processing = fee;
    procRate = note ? 0 : method.rate ?? 0;
    const parts = [method.rate ? `${formatRate(method.rate)} × ${money(amount)}` : "", method.fixed ? money(method.fixed) : ""].filter(Boolean).join(" + ");
    fees.push({
      id: "processing",
      label: "Stripe processing fee",
      amount: fee,
      kind: "payment",
      detail: note ? `${parts} = ${money(raw)}${note}` : method.rate ? parts : `${parts} flat`,
      explain: method.explain,
      source: method.source === "lpm" ? lpmSrc : pricingSrc,
    });
  }

  /* currency conversion */
  if (method.fx && bool(inputs, "fx")) {
    fees.push({
      id: "fx",
      label: "Currency conversion fee",
      amount: pct(amount, cfg.fx),
      kind: "payment",
      detail: `${formatRate(cfg.fx)} × ${money(amount)}`,
      explain: `Charged when the customer pays in a currency other than your payout currency. Stripe converts at the mid-market rate and adds ${formatRate(cfg.fx)} as its own fee line.`,
      source: S.fx,
    });
  }

  /* Billing / Invoicing */
  const product = str(inputs, "product", "none");
  const saas: string[] = [];
  if (product === "billing") {
    saas.push("Billing");
    fees.push({
      id: "billing",
      label: "Stripe Billing fee",
      amount: pct(amount, 0.7),
      kind: "platform",
      detail: `0.7% × ${money(amount)}`,
      explain: "Stripe Billing (pay as you go) takes 0.7% of subscription payments, renewals included, on top of the payment fee. One-off invoices are priced under Invoicing instead.",
      source: S.billing,
    });
  } else if (product === "invoice" || product === "invoice_plus") {
    const plus = product === "invoice_plus";
    const rate = plus ? 0.5 : 0.4;
    saas.push("Invoicing");
    fees.push({
      id: "invoicing",
      label: `Stripe Invoicing fee (${plus ? "Plus" : "Starter"})`,
      amount: pct(amount, rate),
      kind: "platform",
      detail: `${formatRate(rate)} × ${money(amount)}`,
      explain: `Invoicing ${plus ? "Plus (which adds quotes)" : "Starter"} charges ${formatRate(rate)} of each paid one-off invoice, on top of the fee for the way your customer pays it.`,
      source: S.invoicing,
    });
  } else if (product === "receipt") {
    const cap = fromUsd(200, market.currency);
    const raw = pct(amount, 0.4);
    const capped = raw > cap;
    saas.push("Invoicing");
    fees.push({
      id: "postPaymentInvoice",
      label: "Post-payment invoice fee",
      amount: capped ? cap : raw,
      kind: "platform",
      detail: capped ? `0.4% × ${money(amount)} = ${money(raw)}, capped at ${us ? "$2.00" : `US$2.00 ≈ ${money(cap)}`}` : `0.4% × ${money(amount)}`,
      explain: `When Checkout or a Payment Link creates an invoice after a one-off purchase, Stripe charges 0.4% of the total, up to ${us ? "$2.00" : "US$2.00"} per invoice.${
        us ? "" : ` We convert the cap at the ECB reference rate of ${FX_DATE}; Stripe uses the day’s rate.`
      }`,
      source: pricingSrc,
    });
  }

  /* Stripe Tax */
  const taxMode = str(inputs, "stripeTax", "none");
  if (taxMode === "nocode") {
    saas.push("Tax");
    fees.push({
      id: "stripeTax",
      label: "Stripe Tax fee",
      amount: pct(amount, 0.5),
      kind: "platform",
      detail: `0.5% × ${money(amount)}`,
      explain: "Stripe Tax (no-code, in Checkout, Payment Links, Billing or Invoicing) charges 0.5% of the complete transaction, including the tax it calculates, wherever you’re registered to collect tax.",
      source: S.tax,
    });
  } else if (taxMode === "api") {
    saas.push("Tax");
    fees.push({
      id: "stripeTax",
      label: "Stripe Tax fee (API)",
      amount: cfg.taxApi,
      kind: "platform",
      detail: `${money(cfg.taxApi)} per transaction`,
      explain: `Through the Tax API, Stripe charges ${money(cfg.taxApi)} per recorded transaction where you’re registered, which includes 10 tax calculations; extra calculations cost more.`,
      source: pricingSrc,
    });
  }

  /* Radar */
  const radar = str(inputs, "radar", "lite");
  if (radar === "standard" || radar === "plus" || radar === "pro") {
    const fee = cfg.radar[radar];
    const name = `Radar ${radar[0].toUpperCase()}${radar.slice(1)}`;
    saas.push("Radar");
    fees.push({
      id: "radar",
      label: `${name} fee`,
      amount: fee,
      kind: "platform",
      detail: `${money(fee)} per screened payment`,
      explain: `${name} screens payments by every method for fraud and costs ${money(fee)} for each payment it screens.${
        !radarTrialActive(at)
          ? ""
          : radar === "standard"
            ? " If your account used Radar before July 29, 2026, this is free until January 22, 2027, then billed."
            : radar === "plus"
              ? " If Stripe moved your account here from Radar for Fraud Teams, this price applies from January 22, 2027."
              : ""
      } Radar Lite (cards only) stays free.`,
      source: radarTrialActive(at) && radar !== "pro" ? S.radar2027 : S.radar[market.id] ?? S.radar.us,
    });
  }

  /* disputes (card payments) */
  const dispute = usesCard(method) ? str(inputs, "dispute", "none") : "none";
  if (dispute !== "none") {
    const d = cfg.dispute;
    fees.push({
      id: "disputeFee",
      label: "Dispute fee",
      amount: d.received,
      kind: "other",
      detail: `${money(d.received)} per dispute`,
      explain: "Charged when the cardholder’s bank opens a dispute (chargeback), whatever the outcome. Stripe doesn’t return it.",
      source: S.disputes,
    });
    if (dispute === "won" || dispute === "lost" || dispute === "partial") {
      const returned = dispute === "won";
      fees.push({
        id: "disputeCountered",
        label: "Dispute countered fee",
        amount: returned ? 0 : d.countered,
        kind: "other",
        detail: returned ? `${money(d.countered)} charged, returned when you won` : `${money(d.countered)} per dispute you respond to`,
        explain: returned
          ? `Responding with your own evidence costs ${money(d.countered)}, which Stripe gives back because you won.`
          : `Responding with your own evidence costs ${money(d.countered)}. It comes back only if you win the whole dispute; a partial win doesn’t return it.`,
        source: S.disputes,
      });
    }
    if (dispute === "smart") {
      fees.push({
        id: "smartDisputes",
        label: "Smart Disputes fee",
        amount: pct(amount, 30),
        kind: "other",
        detail: `30% × ${money(amount)}`,
        explain: "When a dispute you answered with Smart Disputes (evidence prepared by Stripe’s AI) is won, Stripe takes 30% of the disputed amount instead of the countered fee. Nothing if you lose.",
        source: pricingSrc,
      });
    }
    const kept = dispute === "partial" ? Math.min(amount, toCents(num(inputs, "disputeWon"))) : 0;
    const reversed = dispute === "accepted" || dispute === "lost" ? amount : dispute === "partial" ? amount - kept : 0;
    if (reversed > 0) {
      fees.push({
        id: "disputeReversal",
        label: "Payment returned to the cardholder",
        amount: reversed,
        kind: "other",
        detail: dispute === "partial" ? `${money(amount)} − ${money(kept)} you won` : `${money(amount)} disputed`,
        explain: "A lost dispute sends the money back to the customer. Stripe keeps its processing fee on the original payment.",
        source: S.disputes,
      });
    }
  }

  /* Instant Payout */
  if (bool(inputs, "instantPayout")) {
    const before = fees.reduce((s, l) => s + l.amount, 0);
    const base = amount - before;
    if (base > 0) {
      const raw = pct(base, cfg.instant.rate);
      const fee = Math.max(raw, cfg.instant.min);
      fees.push({
        id: "instantPayout",
        label: "Instant Payout fee",
        amount: fee,
        kind: "payout",
        detail: raw < cfg.instant.min ? `${formatRate(cfg.instant.rate)} × ${money(base)} = ${money(raw)}, raised to the ${money(cfg.instant.min)} minimum` : `${formatRate(cfg.instant.rate)} × ${money(base)}`,
        explain: `Standard payouts to your bank are free. Instant Payouts cost ${formatRate(cfg.instant.rate)} of the amount paid out, at least ${money(cfg.instant.min)} per payout (one payout can cover several payments).`,
        source: pricingSrc,
      });
    }
  }

  /* costs, including tax inside the payment */
  const costs = costLines(inputs, market);
  const taxRate = Math.min(100, Math.max(0, num(inputs, "salesTax")));
  const taxPart = taxRate > 0 ? Math.round((amount * taxRate) / (100 + taxRate)) : 0;
  if (taxPart) costs.unshift({ id: "salesTax", label: us ? "Sales tax you pass on" : "VAT or GST you pass on", amount: taxPart, kind: "cost" });

  const notes: string[] = [];
  const warnings: string[] = [];
  if (taxPart && procRate) {
    notes.push(`${money(taxPart)} of this payment is tax you pass on, and Stripe’s ${formatRate(procRate)} is charged on it too: ${money(pct(taxPart, procRate))} of the fee.`);
  }
  const fxFee = fees.find((l) => l.id === "fx")?.amount ?? 0;
  if (dispute === "none" && processing)
    notes.push(
      fxFee
        ? `If you refund this payment, Stripe keeps its ${money(processing)} processing fee and the ${money(fxFee)} conversion fee.`
        : `If you refund this payment, Stripe keeps its ${money(processing)} processing fee.`,
    );
  if (radar === "lite" && radarTrialActive(at))
    notes.push(`Used Radar before July 29, 2026? From January 22, 2027 Stripe charges ${money(cfg.radar.standard)} per screened payment (Radar Standard) unless you switch to the free Radar Lite.`);
  if (market.id === "ca" && saas.length)
    notes.push(`Stripe adds GST/HST (and PST or QST in some provinces) to ${saas.join(", ")} fees for Canadian accounts; processing fees are tax-exempt.`);
  if (amount > 0 && amount < cfg.minCharge) warnings.push(`Stripe’s minimum charge is ${money(cfg.minCharge)}; smaller payments are declined.`);

  return assemble({
    market,
    buyerPays: amount,
    saleAmount: amount,
    fees,
    costs,
    notes,
    warnings,
  });
}

/* ---------------- fields ---------------- */

function hintFor(m: Method, market: Market): string {
  const money = moneyFor(market);
  const cfg = cfgFor(market);
  if (m.kind === "card") return `${formatRate(cfg.card.domestic)} + ${money(cfg.card.fixed)}`;
  if (m.kind === "manual") return `${formatRate(round3(cfg.card.domestic + (cfg.card.manual ?? 0)))} + ${money(cfg.card.fixed)}`;
  if (m.kind === "terminal") return `${formatRate(cfg.terminal.domestic)} + ${money(cfg.terminal.fixed)}`;
  if (m.kind === "tap") return `${formatRate(cfg.terminal.domestic)} + ${money(cfg.terminal.fixed + cfg.terminal.tap)}`;
  if (m.kind === "interac") return `${money(cfg.terminal.interac ?? 0)} flat`;
  const parts = [m.rate ? formatRate(m.rate) : "", m.fixed ? money(m.fixed) : ""].filter(Boolean).join(" + ");
  const extra = [m.min !== undefined ? `min ${money(m.min)}` : "", m.cap !== undefined ? `max ${money(m.cap)}` : ""].filter(Boolean).join(", ");
  return extra ? `${parts}, ${extra}` : parts;
}

const methodOptions = (_i: Inputs, market: Market): SelectOption[] =>
  methodsFor(market).map((m) => ({ value: m.id, label: m.label, hint: hintFor(m, market), group: m.group }));

const productOptions = (_i: Inputs, market: Market): SelectOption[] => {
  const money = moneyFor(market);
  const cap = market.id === "us" ? "$2" : `US$2 ≈ ${money(fromUsd(200, market.currency))}`;
  return [
    { value: "none", label: "No: Checkout, a Payment Link or my own site", hint: "No extra fee" },
    { value: "billing", label: "A subscription billed with Stripe Billing", hint: "+0.7%" },
    { value: "invoice", label: "A one-off invoice (Invoicing Starter)", hint: "+0.4%" },
    { value: "invoice_plus", label: "A one-off invoice (Invoicing Plus)", hint: "+0.5%" },
    { value: "receipt", label: "Checkout or Payment Link with an automatic invoice", hint: `+0.4%, max ${cap}` },
  ];
};

const taxOptions = (_i: Inputs, market: Market): SelectOption[] => [
  { value: "none", label: "No" },
  { value: "nocode", label: "Yes, in Checkout, Payment Links, Billing or Invoicing", hint: "0.5% of the total" },
  { value: "api", label: "Yes, through the Tax API", hint: `${moneyFor(market)(cfgFor(market).taxApi)} per transaction` },
];

const radarOptions = (_i: Inputs, market: Market): SelectOption[] => {
  const money = moneyFor(market);
  const r = cfgFor(market).radar;
  return [
    { value: "lite", label: "Radar Lite", hint: "Free, cards only" },
    { value: "standard", label: "Radar Standard", hint: `${money(r.standard)} per payment` },
    { value: "plus", label: "Radar Plus", hint: `${money(r.plus)} per payment` },
    { value: "pro", label: "Radar Pro", hint: `${money(r.pro)} per payment` },
  ];
};

const methodOf = (inputs: Inputs, market: Market) => methodFor(market, str(inputs, "method", "card"));

/* ---------------- schedule ---------------- */

function schedule(market: Market): ScheduleRow[] {
  const at = Date.now();
  const money = moneyFor(market);
  const cfg = cfgFor(market);
  const c = cfg.card;
  const t = cfg.terminal;
  const pricing = S.pricing[market.id] ?? S.pricing.us;
  const lpm = S.lpm[market.id] ?? S.lpm.us;
  const id = market.id;
  const whole = "The whole payment";
  const rows: ScheduleRow[] = [{ fee: "Online card or wallet", amount: `${formatRate(c.domestic)} + ${money(c.fixed)}`, appliesTo: whole, when: `${c.premium !== undefined ? "Personal (standard) card" : "Card"} issued in ${cfg.cardHome}`, source: pricing }];
  if (c.premium !== undefined) rows.push({ fee: "Premium (business) card", amount: `${formatRate(c.premium)} + ${money(c.fixed)}`, appliesTo: whole, when: `Business, corporate or commercial Visa / Mastercard from ${cfg.cardHome}`, source: S.premium });
  if (c.regional !== undefined) rows.push({ fee: id === "uk" ? "EEA card" : "UK card", amount: `${formatRate(c.regional)} + ${money(c.fixed)}`, appliesTo: whole, when: id === "uk" ? "Card issued in the European Economic Area" : "Card issued in the UK", source: pricing });
  rows.push({
    fee: "International card",
    amount: c.intlSurcharge !== undefined ? `+${formatRate(c.intlSurcharge)}` : `${formatRate(c.intl(at))} + ${money(c.fixed)}`,
    appliesTo: whole,
    when: id === "au" ? "Card issued outside Australia (2.8% from April 1, 2027)" : `Card issued outside ${id === "uk" ? "the UK and EEA" : id === "de" ? "the EEA and UK" : cfg.cardHome}`,
    source: id === "au" ? S.auCards : pricing,
  });
  if (c.manual !== undefined) rows.push({ fee: "Manually entered card", amount: `+${formatRate(c.manual)}`, appliesTo: whole, when: "Typed into the Dashboard or taken by phone (MOTO)", source: S.manual });
  rows.push({ fee: "Currency conversion", amount: `+${formatRate(cfg.fx)}`, appliesTo: "The converted amount", when: "Customer pays in another currency", source: S.fx });
  for (const m of methodsFor(market)) {
    if (m.kind !== "simple") continue;
    rows.push({ fee: m.label, amount: hintFor(m, market), appliesTo: whole, when: "Per successful payment", source: m.source === "lpm" ? lpm : pricing });
  }
  rows.push({
    fee: "In person (Terminal)",
    amount: `${formatRate(t.domestic)} + ${money(t.fixed)}${id === "us" ? " (+1.5% intl)" : ` (${formatRate(t.intl(at))} + ${money(t.fixed)} intl)`}`,
    appliesTo: whole,
    when: `Tap to Pay on a phone adds ${money(t.tap)}${t.interac ? `; Interac debit ${money(t.interac)} flat` : ""}`,
    source: pricing,
  });
  rows.push(
    { fee: "Stripe Billing", amount: "0.7%", appliesTo: "Subscription (Billing) payments", when: "If you bill subscriptions through Stripe", source: S.billing },
    { fee: "Stripe Invoicing", amount: "0.4% Starter / 0.5% Plus", appliesTo: "Paid one-off invoices", when: "If you send invoices through Stripe", source: S.invoicing },
    { fee: "Post-payment invoice", amount: `0.4%, max ${id === "us" ? "$2.00" : "US$2.00"}`, appliesTo: "One-off Checkout / Payment Link purchases", when: "If automatic invoices are on", source: pricing },
    { fee: "Stripe Tax (Basic)", amount: `0.5% no-code / ${money(cfg.taxApi)} per API transaction`, appliesTo: "The total including tax", when: "Where you’re registered to collect tax", source: S.tax },
    { fee: "Radar", amount: `Lite free; Standard ${money(cfg.radar.standard)}, Plus ${money(cfg.radar.plus)}, Pro ${money(cfg.radar.pro)}`, appliesTo: "Each screened payment", when: "Paid tiers only", source: S.radar[id] ?? S.radar.us },
    { fee: "Instant Payout", amount: `${formatRate(cfg.instant.rate)}, min ${money(cfg.instant.min)}`, appliesTo: "The amount paid out", when: "Only if you choose an instant payout", source: pricing },
    { fee: "Dispute", amount: `${money(cfg.dispute.received)} + ${money(cfg.dispute.countered)} if you respond`, appliesTo: "Each card dispute", when: "Response fee returned if you win", source: S.disputes },
    { fee: "Smart Disputes", amount: "30%", appliesTo: "The disputed amount", when: "Only disputes won with Smart Disputes", source: pricing },
    { fee: "Refund", amount: "No extra fee", appliesTo: "Card refunds", when: "Original processing fee isn’t returned", source: S.refunds },
  );
  return rows;
}

/* ---------------- changes ---------------- */

const changes: FeeChange[] = [
  { date: "2027-04-01", text: "Australia: international card fees drop from 3.5% to 2.8% (+ A$0.30 online, + A$0.10 in person).", source: S.auCards, upcoming: true },
  {
    date: "2027-01-22",
    text: "New Radar prices apply to accounts that used Radar before July 29, 2026: the free Radar Standard trial ends and each screened payment costs $0.05 in the US (£0.04 UK, CA$0.07, A$0.08, €0.05); former Radar for Fraud Teams accounts pay the Radar Plus price ($0.07 in the US). Renewals and every payment method are screened and billed. Switching to Radar Lite keeps fraud screening for cards free.",
    source: S.radar2027,
    upcoming: true,
  },
  { date: "2026-10-21", text: "Radar now screens payments by every method (bank debits, wallets, buy now pay later, stablecoins), not only cards, ACH and SEPA Direct Debit.", source: S.radar2027 },
  { date: "2026-10-01", text: "Australia: domestic card fees cut from 1.70% to 1.65% + A$0.30 online (in person 1.70% → 1.65% + A$0.10).", source: S.auCards },
  {
    date: "2026-08-03",
    text: "UK and EEA: by this date Stripe’s pricing pages listed premium (business) cards at 2.8% (was 1.9%) and international cards at 3.15% (was 3.25%). Stripe hasn’t published the date existing accounts move to the new rates.",
    source: S.pricing.uk,
  },
  { date: "2026-07-29", text: "Radar split into Lite (free, cards only), Standard, Plus and Pro. Accounts already using Radar got a free Radar Standard trial until January 22, 2027; Radar for Fraud Teams accounts moved to Radar Plus.", source: S.radar2027 },
  { date: "2025-06-17", text: "New dispute countered fee: $15 in the US (£20 UK, CA$15, A$25, €20) when you respond to a dispute, returned if you win. The $15 dispute fee itself didn’t change.", source: S.disputes },
  { date: "2024-07-10", text: "Stripe Billing became one plan at 0.7% of Billing volume, replacing Starter (0.5%) and Scale (0.8%).", source: S.billing2024 },
];

/* ---------------- definition ---------------- */

const CARD_UK: SelectOption[] = [
  { value: "uk", label: "UK personal" },
  { value: "premium", label: "UK business" },
  { value: "eea", label: "EEA" },
  { value: "intl", label: "Other" },
];
const CARD_EEA: SelectOption[] = [
  { value: "eea", label: "EEA personal" },
  { value: "premium", label: "EEA business" },
  { value: "uk", label: "UK" },
  { value: "intl", label: "Other" },
];

export const stripe: CalculatorDef = {
  slug: "stripe",
  name: "Stripe",
  path: "/stripe-fee-calculator",
  category: "payments",
  priceNoun: "payment amount",
  sellerNoun: "merchant",
  blurb: "2.9% + 30¢ per card payment, +1.5% international card, +1% currency conversion (US)",
  markets: MARKETS,
  defaultMarket: "us",
  priceField: "price",
  fields: [
    { id: "price", kind: "money", label: "Payment amount", section: "sale", help: "Everything the customer pays, shipping and tax included: Stripe’s percentage applies to the whole charge." },
    { id: "method", kind: "select", label: "How does the customer pay?", section: "sale", options: methodOptions },
    {
      id: "cardFrom",
      kind: "segmented",
      label: "Where was the card issued?",
      section: "sale",
      options: [
        { value: "domestic", label: "Domestic" },
        { value: "international", label: "International" },
      ],
      help: "Stripe goes by the country of the bank that issued the card, not where the customer lives.",
      showIf: (i, m) => (m.id === "us" || m.id === "ca" || m.id === "au") && usesCard(methodOf(i, m)),
    },
    {
      id: "cardUk",
      kind: "segmented",
      label: "Which card did they use?",
      section: "sale",
      options: CARD_UK,
      help: "Business, corporate and commercial Visa or Mastercard cards cost 2.8%. Amex counts as personal.",
      showIf: (i, m) => m.id === "uk" && usesCard(methodOf(i, m)),
    },
    {
      id: "cardEea",
      kind: "segmented",
      label: "Which card did they use?",
      section: "sale",
      options: CARD_EEA,
      help: "Business, corporate and commercial Visa or Mastercard cards cost 2.8%. Amex counts as personal.",
      showIf: (i, m) => m.id === "de" && usesCard(methodOf(i, m)),
    },
    {
      id: "fx",
      kind: "toggle",
      label: "Does the customer pay in a foreign currency?",
      section: "sale",
      help: "Stripe adds 1% (2% outside the US) when it converts the payment to your payout currency.",
      showIf: (i, m) => Boolean(methodOf(i, m).fx),
    },
    {
      id: "salesTax",
      kind: "percent",
      label: "Sales tax or VAT included in the amount",
      section: "sale",
      advanced: true,
      max: 30,
      help: "We split it out as money you pass on. Stripe still charges its fee on it.",
    },
    { id: "product", kind: "select", label: "Is it a subscription or an invoice?", section: "options", advanced: true, options: productOptions, help: "Stripe Billing and Invoicing add their own percentage on top of the payment fee." },
    { id: "stripeTax", kind: "select", label: "Does Stripe Tax calculate the tax?", section: "options", advanced: true, options: taxOptions, help: "Only charged where you’re registered to collect tax. The 0.5% includes the tax itself." },
    { id: "radar", kind: "select", label: "Radar fraud screening", section: "options", advanced: true, options: radarOptions, help: "Paid tiers are charged once per screened payment. Radar Lite is free." },
    { id: "instantPayout", kind: "toggle", label: "Pay this out instantly", section: "options", advanced: true, help: "Standard payouts are free. Instant Payouts cost a percentage, with a minimum per payout." },
    {
      id: "dispute",
      kind: "select",
      label: "Did the customer dispute the charge?",
      section: "options",
      advanced: true,
      options: [
        { value: "none", label: "No" },
        { value: "accepted", label: "Yes, and I didn’t respond" },
        { value: "won", label: "Yes, I responded and won" },
        { value: "lost", label: "Yes, I responded and lost" },
        { value: "partial", label: "Yes, I responded and won part of it" },
        { value: "smart", label: "Yes, won with Smart Disputes" },
      ],
      help: "Card chargebacks only. Stripe’s dispute fee is never returned.",
      showIf: (i, m) => usesCard(methodOf(i, m)),
    },
    {
      id: "disputeWon",
      kind: "money",
      label: "Amount the bank let you keep",
      section: "options",
      advanced: true,
      showIf: (i, m) => usesCard(methodOf(i, m)) && str(i, "dispute", "none") === "partial",
    },
    { id: "itemCost", kind: "money", label: "What it cost you", section: "costs", help: "The product or service cost, to see your profit." },
    { id: "shippingCost", kind: "money", label: "Shipping you pay", section: "costs" },
    { id: "otherCost", kind: "money", label: "Other costs", section: "costs" },
  ],
  defaults: () => ({
    price: 100,
    method: "card",
    cardFrom: "domestic",
    cardUk: "uk",
    cardEea: "eea",
    fx: false,
    salesTax: 0,
    product: "none",
    stripeTax: "none",
    radar: "lite",
    instantPayout: false,
    dispute: "none",
    disputeWon: 0,
    itemCost: 0,
    shippingCost: 0,
    otherCost: 0,
  }),
  calculate,
  breakpoints: (inputs, market) => {
    const out: number[] = [];
    const m = methodOf(inputs, market);
    if (m.kind === "simple" && m.rate) {
      const fixed = m.fixed ?? 0;
      if (m.min !== undefined) out.push(Math.ceil(((m.min - fixed) * 100) / m.rate));
      if (m.cap !== undefined) out.push(Math.ceil(((m.cap - fixed) * 100) / m.rate));
    }
    if (str(inputs, "product", "none") === "receipt") out.push(Math.ceil((fromUsd(200, market.currency) * 100) / 0.4));
    const dispute = usesCard(m) ? str(inputs, "dispute", "none") : "none";
    // A partly won dispute: above the amount the bank let you keep, every extra cent goes back to the cardholder.
    if (dispute === "partial") out.push(toCents(num(inputs, "disputeWon")));
    // Instant Payout: the minimum gives way to the percentage once rate × net reaches it (net rises with the price).
    if (bool(inputs, "instantPayout") && dispute === "none") {
      const ip = cfgFor(market).instant;
      const netAt = (c: number) => calculate({ ...inputs, instantPayout: false, price: c / 100 }, market).payout;
      let lo = 1;
      let hi = 100_000_000;
      if (pct(netAt(hi), ip.rate) >= ip.min) {
        while (lo < hi) {
          const mid = Math.floor((lo + hi) / 2);
          if (pct(netAt(mid), ip.rate) >= ip.min) hi = mid;
          else lo = mid + 1;
        }
        out.push(lo);
      }
    }
    return out.filter((b) => b > 0);
  },
  verifiedAt: "2026-10-23",
  sources,
  changes,
  schedule,
  compare: {
    group: "pay",
    map: (c) => ({ price: c.price }),
    note: "US-issued card online, no Billing, Tax or Radar add-ons",
  },
};

export default stripe;
