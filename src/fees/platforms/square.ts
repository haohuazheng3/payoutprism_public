/*
 * Square payment processing fees (US, UK, Canada, Australia). Every number is from Square's own
 * pages (see `sources`), re-read verbatim on 2026-10-23. Research notes: research/fees/square.md.
 *
 * How a payment is charged (what this module reproduces):
 *  - One percentage (+ a fixed fee in some markets) per payment, taken from the WHOLE amount
 *    charged to the card: items, shipping, sales tax and tip ("Payment processing fees are taken
 *    out of the total amount of each transaction, including tax and tip", US help 5068).
 *  - The rate depends on how the customer pays (in person, online, invoice, keyed, ACH, Afterpay)
 *    and, in the US only, on the plan: Square Free / Plus / Premium (since 2025-10-06).
 *  - International cards (US, UK, CA): +1.5% of the payment total, shown as its own line
 *    (developer docs: "appears as a separate line item"). UK online payments already have a
 *    non-UK card rate (2.5% + 25p), so no extra 1.5% there. Not charged on ACH, Afterpay/Clearpay,
 *    EBT, bitcoin or Interac debit. Australia has no such fee.
 *  - ACH (US): 1%, $1 minimum; capped at $10 on Plus/Premium invoices, $5 via the API; Square's
 *    fee table lists no cap for invoices on Square Free. $0 into Square Checking.
 *  - Afterpay/Clearpay: 6% + 30¢/30p of the order on every plan. Australia: excl. GST, so 10% GST
 *    is added on the fee.
 *  - Instant (and US same-day) transfers: 1.95% of the amount transferred, i.e. the balance from
 *    the payment after processing fees (sales tax included), as a separate "payout" line. Only up to
 *    the daily limit in the UK (£3,500) and Australia (A$5,000); none on a US payment over $10,000
 *    (it can't go out instantly) or on ACH money paid into Square Checking (no transfer needed).
 * Square doesn't publish a rounding rule; each line is rounded to the cent, half away from zero.
 * The official worked example ($100 in person, Canadian card → $2.75 + $1.50) has no rounding.
 */
import { M } from "../markets";
import { assemble, bool, costLines, formatMoney, formatRate, moneyFor, num, pct, str, toCents } from "../money";
import type { CalculatorDef, FeeChange, Inputs, Line, Market, ScheduleRow, SelectOption, Source } from "../types";

const MARKETS: Market[] = [M.us, M.uk, M.ca, M.au];

type Plan = "free" | "plus" | "premium";
type PayType = "in_person" | "tap_to_pay" | "debit" | "ebt" | "bitcoin" | "online" | "invoice_card" | "ach" | "api" | "ach_api" | "keyed" | "afterpay";

interface Rate {
  pct: number;
  /** Fixed fee per payment, cents of the market currency. */
  fixed: number;
}

const PLAN_NAME: Record<Plan, string> = { free: "Free", plus: "Plus", premium: "Premium" };
/** US plan price per location per month, cents (pricing page: "$0/mo. per location $49/mo. per location $149/mo. per location"). */
const PLAN_MONTHLY: Record<Plan, number> = { free: 0, plus: 4900, premium: 14900 };

/* US rates on the Square Free / Plus / Premium plans (help 5068 and the "Our fees" table). */
const US_CARD_PRESENT: Record<Plan, Rate> = { free: { pct: 2.6, fixed: 15 }, plus: { pct: 2.5, fixed: 15 }, premium: { pct: 2.4, fixed: 15 } };
const US_ONLINE: Record<Plan, Rate> = { free: { pct: 3.3, fixed: 30 }, plus: { pct: 2.9, fixed: 30 }, premium: { pct: 2.9, fixed: 30 } };
const US_API: Rate = { pct: 2.9, fixed: 30 };
const US_KEYED: Rate = { pct: 3.5, fixed: 15 };
const US_EBT: Rate = { pct: 1.8, fixed: 5 };
const AFTERPAY: Rate = { pct: 6, fixed: 30 };
const ACH_PCT = 1;
const ACH_MIN = 100;
/** ACH via invoice: "1%, $1 min" on Free (no cap listed), "1%, $1 min, $10 fee cap" on Plus and Premium. */
const ACH_INVOICE_CAP: Record<Plan, number | undefined> = { free: undefined, plus: 1000, premium: 1000 };
/** ACH via API: "1%, $1 min, $5 fee cap" on every plan. */
const ACH_API_CAP = 500;

const INTL = 1.5;
const INSTANT = 1.95;
const AU_GST = 10;

/** Bitcoin payments: "0% processing fees until December 31, 2026, after which it will be 1%" (US help 5068). Midnight Pacific time. */
export function bitcoinRate(at: number = Date.now()): number {
  return at >= Date.UTC(2027, 0, 1, 8, 0) ? 1 : 0;
}

/**
 * Smallest / largest instant transfer, cents (US help 3807 + instant-transfers page, UK/CA/AU pricing pages).
 * `perDay`: the maximum is a daily limit (UK "maximum transfer limit is £3,500 per day", AU "Up to $5,000 AUD
 * per day"), so only that much of one payment can go out instantly and the rest follows on the free schedule.
 * Canada's C$5,000 and the US $10,000 are per transfer.
 */
const INSTANT_LIMITS: Record<string, { min: number; max: number; maxText: string; perDay: boolean }> = {
  us: { min: 2500, max: 1_000_000, maxText: "$10,000 per transfer", perDay: false },
  uk: { min: 1500, max: 350_000, maxText: "£3,500 a day", perDay: true },
  ca: { min: 2500, max: 500_000, maxText: "C$5,000 per transfer", perDay: false },
  au: { min: 500, max: 500_000, maxText: "A$5,000 a day", perDay: true },
};

const S = {
  help: "sq-help-us",
  ourFees: "sq-our-fees",
  pricing: "sq-pricing-us",
  transfers: "sq-transfers-us",
  instant: "sq-instant-us",
  dev: "sq-dev-pricing",
  press: "sq-press-2025",
  cpOffer: "sq-cp-offer",
  refunds: "sq-refunds-us",
  press2023: "sq-press-2023",
  community: "sq-community-online",
  tap: "sq-tap-us",
  ukFees: "sq-uk-fees",
  ukInstant: "sq-uk-instant",
  ukPricing: "sq-uk-pricing",
  ukHelp: "sq-uk-help",
  caPricing: "sq-ca-pricing",
  caHelp: "sq-ca-help",
  caTerms: "sq-ca-terms",
  auPricing: "sq-au-pricing",
  auHelp: "sq-au-help",
  auTerms: "sq-au-terms",
} as const;

const sources: Source[] = [
  { id: S.help, title: "Learn about Square fees", url: "https://squareup.com/help/us/en/article/5068-what-are-square-s-fees", publisher: "Square Support Center (US)", checked: "2026-10-23" },
  { id: S.ourFees, title: "Understanding Our Fees | Square Payments", url: "https://squareup.com/us/en/payments/our-fees", publisher: "Square (US)", checked: "2026-10-23" },
  { id: S.pricing, title: "Square Processing Fees, Plans, and Software Pricing", url: "https://squareup.com/us/en/pricing", publisher: "Square (US)", checked: "2026-10-23" },
  { id: S.transfers, title: "Set up and edit transfer options", url: "https://squareup.com/help/us/en/article/3807-deposit-options-with-square", publisher: "Square Support Center (US)", checked: "2026-10-23" },
  { id: S.instant, title: "Same-Day and Instant Transfers — Get Paid Instantly", url: "https://squareup.com/us/en/payments/instant-transfers", publisher: "Square (US)", checked: "2026-10-23" },
  { id: S.dev, title: "Payments Pricing with Square APIs and SDKs", url: "https://developer.squareup.com/docs/payments-pricing", publisher: "Square Developer", checked: "2026-10-23" },
  { id: S.press, title: "Square Simplifies Commerce Software with New Unified Plans & Pricing", url: "https://squareup.com/us/en/press/unified-pricing-and-packaging", publisher: "Square Press", checked: "2026-10-23" },
  { id: S.cpOffer, title: "Square Extended Rate Offer Terms and Conditions", url: "https://squareup.com/us/en/legal/general/extended-cp-rate-offer-2025", publisher: "Square Legal (US)", checked: "2026-10-23" },
  { id: S.refunds, title: "Manage customer refunds", url: "https://squareup.com/help/us/en/article/6116-process-refunds", publisher: "Square Support Center (US)", checked: "2026-10-23" },
  { id: S.press2023, title: "Square Policy and Pricing Updates", url: "https://squareup.com/us/en/press/policy-and-pricing-updates", publisher: "Square Press", checked: "2026-10-23" },
  {
    id: S.community,
    title: "Square Plus Plan (reply from Square’s Community Program Manager, November 3, 2025)",
    url: "https://community.squareup.com/t5/Appointments-Bookings/Square-Plus-Plan/td-p/823159",
    publisher: "Square Community",
    checked: "2026-10-23",
  },
  { id: S.tap, title: "Tap to Pay on iPhone Contactless Payments", url: "https://squareup.com/us/en/payments/tap-to-pay", publisher: "Square (US)", checked: "2026-10-23" },
  { id: S.ukFees, title: "Fee Schedule", url: "https://squareup.com/gb/en/legal/general/fees", publisher: "Square Legal (UK)", checked: "2026-10-23" },
  { id: S.ukInstant, title: "Instant Transfer Terms", url: "https://squareup.com/gb/en/legal/general/instant-transfer-terms", publisher: "Square Legal (UK)", checked: "2026-10-23" },
  { id: S.ukPricing, title: "Square Processing Fees, Plans and Software Pricing", url: "https://squareup.com/gb/en/pricing", publisher: "Square (UK)", checked: "2026-10-23" },
  { id: S.ukHelp, title: "Learn about Square fees", url: "https://squareup.com/help/gb/en/article/5068-what-are-square-s-fees", publisher: "Square Support Centre (UK)", checked: "2026-10-23" },
  { id: S.caPricing, title: "Square Processing Fees, Plans and Software Pricing", url: "https://squareup.com/ca/en/pricing", publisher: "Square (Canada)", checked: "2026-10-23" },
  { id: S.caHelp, title: "Learn about Square fees", url: "https://squareup.com/help/ca/en/article/5068-what-are-square-s-fees", publisher: "Square Support Centre (Canada)", checked: "2026-10-23" },
  { id: S.caTerms, title: "Payment Terms", url: "https://squareup.com/ca/en/legal/general/payment", publisher: "Square Legal (Canada)", checked: "2026-10-23" },
  { id: S.auPricing, title: "Square Processing Fees, Plans, and Software Pricing", url: "https://squareup.com/au/en/pricing", publisher: "Square (Australia)", checked: "2026-10-23" },
  { id: S.auHelp, title: "Learn about Square fees", url: "https://squareup.com/help/au/en/article/5068-what-are-square-s-fees", publisher: "Square Support Centre (Australia)", checked: "2026-10-23" },
  { id: S.auTerms, title: "Payment Terms", url: "https://squareup.com/au/en/legal/general/payment", publisher: "Square Legal (Australia)", checked: "2026-10-23" },
];

const changes: FeeChange[] = [
  { date: "2027-01-01", text: "US bitcoin payments go from 0% to 1% (Square: “0% processing fees until December 31, 2026, after which it will be 1%”).", source: S.help, upcoming: true },
  { date: "2026-10-15", text: "UK instant transfers rise from 1.5% to 1.95% of the balance transferred (fee schedule dated 15 October 2026).", source: S.ukFees },
  { date: "2026-10-01", text: "Australia: instant transfers rise from 1.5% to 1.95%, and Square sellers may no longer add a surcharge to card payments.", source: S.auTerms },
  { date: "2026-03-03", text: "Canada: a 1.5% international transaction fee starts for sellers who had a Square account on February 2, 2026, on cards issued outside Canada (not Interac or Afterpay).", source: S.caTerms },
  {
    date: "2026-02-19",
    text: "US: a 1.5% international card fee on top of every card rate is listed on Square’s US pricing page by this date (it wasn’t on February 2). Square published no start date.",
    source: S.pricing,
  },
  {
    date: "2026-02-17",
    text: "US instant and same-day transfers go from 1.75% to 1.95% per transfer (Square’s help center showed 1.75% on February 7 and 1.95% by February 17; no announcement).",
    source: S.transfers,
  },
  { date: "2026-02-02", text: "UK: a 1.5% international transaction fee is added for non-UK cards (online payments keep their own 2.5% + 25p non-UK rate instead).", source: S.ukFees },
  {
    date: "2026-01-13",
    text: "US legacy plans: the standard online rate (Square Online Free/Personal, payment links, subscriptions, eGift cards) rises from 2.9% + 30¢ to 3.3% + 30¢, matching Square Free.",
    source: S.community,
  },
  {
    date: "2025-10-06",
    text: "US: new Square Free / Plus / Premium plans ($0 / $49 / $149 a month per location). In person 2.6% / 2.5% / 2.4% + 15¢; online and invoices 3.3% + 30¢ on Free, 2.9% + 30¢ on Plus and Premium.",
    source: S.press,
  },
  { date: "2025-03-27", text: "US in-person rate goes from 2.6% + 10¢ to 2.6% + 15¢ for existing sellers (new sellers from February 25, 2025).", source: S.cpOffer },
  { date: "2024-05-30", text: "Australia: sellers signing up from this date pay 1.6% in person on every device; earlier sellers on Square Reader, Stand or Tap to Pay stay at 1.9%.", source: S.auHelp },
];

/* ---------------- payment methods per market ---------------- */

interface Method {
  id: PayType;
  /** What the person picks, in their words. */
  option: string;
  group: string;
  /** Statement-style line label. */
  line: string;
  rate: Rate;
  /** How international cards are priced: an add-on, not at all, or (UK online) a rate of their own. */
  intl: "addon" | "none" | "own";
  intlRate?: Rate;
  ach?: { cap?: number };
  /** GST added on the fee (Australia Afterpay is quoted excluding GST). */
  gstOnFee?: number;
  /** Shipping is part of what the card is charged (online, invoices, phone orders). */
  shipping: boolean;
  /** The rate depends on the US plan. */
  byPlan?: boolean;
  explain: string;
  source: string;
}

function cents(market: Market, c: number): string {
  return market.currency === "GBP" ? `${c}p` : `${c}¢`;
}

/** "2.6% + 15¢" / "1.75%" in Square's own style. */
function rateText(market: Market, r: Rate): string {
  return r.fixed ? `${formatRate(r.pct)} + ${cents(market, r.fixed)}` : formatRate(r.pct);
}

function methods(market: Market, plan: Plan, auLegacy: boolean, at: number = Date.now()): Method[] {
  if (market.id === "uk") {
    return [
      { id: "in_person", option: "In person: tap, chip and PIN or swipe", group: "In person", line: "Card processing: in person", rate: { pct: 1.75, fixed: 0 }, intl: "addon", shipping: false, explain: "1.75% of the whole amount charged, including any VAT and tip, for contactless, chip and PIN and swiped payments.", source: S.ukFees },
      { id: "tap_to_pay", option: "Tap to Pay on iPhone or Android", group: "In person", line: "Card processing: Tap to Pay", rate: { pct: 1.75, fixed: 0 }, intl: "addon", shipping: false, explain: "Tap to Pay is a contactless, card-present payment, so it costs the in-person 1.75% of the whole amount.", source: S.ukFees },
      {
        id: "online",
        option: "Online store or Online Checkout link",
        group: "Online & invoices",
        line: "Card processing: online",
        rate: { pct: 1.4, fixed: 25 },
        intl: "own",
        intlRate: { pct: 2.5, fixed: 25 },
        shipping: true,
        explain: "1.4% + 25p for UK cards and 2.5% + 25p for non-UK cards, on Square Online, Online Checkout, the eCommerce API and digital gift cards. Non-UK cards don’t pay the extra 1.5% on top of that.",
        source: S.ukFees,
      },
      { id: "invoice_card", option: "Invoice paid by card", group: "Online & invoices", line: "Card processing: invoice", rate: { pct: 2.5, fixed: 0 }, intl: "addon", shipping: true, explain: "2.5% of the invoice total when the customer pays by card, plus 1.5% if the card is from outside the UK.", source: S.ukFees },
      { id: "keyed", option: "Card keyed in, Virtual Terminal or card on file", group: "Phone & saved cards", line: "Card processing: keyed in", rate: { pct: 2.5, fixed: 0 }, intl: "addon", shipping: true, explain: "2.5% when you key in card details, take a payment on Virtual Terminal or charge a card on file, plus 1.5% for non-UK cards.", source: S.ukFees },
      { id: "afterpay", option: "Clearpay (customer pays in instalments)", group: "Buy now, pay later", line: "Clearpay fee", rate: AFTERPAY, intl: "none", shipping: true, explain: "6% + 30p of the whole order. You’re paid in full straight away, and the international transaction fee doesn’t apply to Clearpay.", source: S.ukPricing },
    ];
  }
  if (market.id === "ca") {
    return [
      { id: "in_person", option: "In person: credit card (incl. Tap to Pay)", group: "In person", line: "Card processing: credit in person", rate: { pct: 2.5, fixed: 0 }, intl: "addon", shipping: false, explain: "2.5% of the whole amount, tax and tip included, for Visa, Mastercard, American Express and Discover credit cards tapped, inserted or swiped, Tap to Pay included.", source: S.caPricing },
      { id: "debit", option: "In person: debit card (Interac)", group: "In person", line: "Debit processing: in person", rate: { pct: 0.75, fixed: 7 }, intl: "none", shipping: false, explain: "0.75% + 7¢ for a debit card tapped or inserted in person, Tap to Pay included. The international fee doesn’t apply to Interac.", source: S.caPricing },
      { id: "online", option: "Online store, Online Checkout or eCommerce API", group: "Online & invoices", line: "Card processing: online", rate: { pct: 2.8, fixed: 30 }, intl: "addon", shipping: true, explain: "2.8% + 30¢ of everything the card is charged (items, shipping, tax and tip) for your online store, Online Checkout, the eCommerce API and subscriptions.", source: S.caPricing },
      { id: "invoice_card", option: "Invoice paid online by card", group: "Online & invoices", line: "Card processing: invoice", rate: { pct: 2.8, fixed: 30 }, intl: "addon", shipping: true, explain: "An invoice paid online by card is a card-not-present payment: 2.8% + 30¢ of the invoice total.", source: S.caPricing },
      { id: "keyed", option: "Card keyed in, card on file or Virtual Terminal link", group: "Phone & saved cards", line: "Card processing: keyed in", rate: { pct: 3.3, fixed: 15 }, intl: "addon", shipping: true, explain: "3.3% + 15¢ when you key in a card, charge a card on file or use a payment link from Virtual Terminal.", source: S.caPricing },
      { id: "afterpay", option: "Afterpay (customer pays in instalments)", group: "Buy now, pay later", line: "Afterpay fee", rate: AFTERPAY, intl: "none", shipping: true, explain: "6% + 30¢ of the whole order. You’re paid in full up front and the international fee doesn’t apply.", source: S.caPricing },
    ];
  }
  if (market.id === "au") {
    const cp: Rate = { pct: auLegacy ? 1.9 : 1.6, fixed: 0 };
    const cpExplain = `${formatRate(cp.pct)} of the whole amount, GST and tip included. Sellers who signed up on or after 30 May 2024 pay 1.6% on every device; earlier sellers pay 1.9% on Square Reader, Stand and Tap to Pay unless a paid plan gives them 1.6% (Terminal and Register are always 1.6%).`;
    return [
      { id: "in_person", option: "In person: tap, insert or swipe", group: "In person", line: "Card processing: in person", rate: cp, intl: "none", shipping: false, explain: cpExplain, source: S.auHelp },
      { id: "tap_to_pay", option: "Tap to Pay on iPhone or Android", group: "In person", line: "Card processing: Tap to Pay", rate: cp, intl: "none", shipping: false, explain: cpExplain, source: S.auHelp },
      { id: "online", option: "Online store, payment link or Online Checkout", group: "Online & invoices", line: "Card processing: online", rate: { pct: 2.2, fixed: 0 }, intl: "none", shipping: true, explain: "2.2% of everything the card is charged, with no fixed fee, for your online store, Online Checkout, payment links, the eCommerce API and subscriptions.", source: S.auPricing },
      { id: "invoice_card", option: "Invoice paid online by card", group: "Online & invoices", line: "Card processing: invoice", rate: { pct: 2.2, fixed: 0 }, intl: "none", shipping: true, explain: "2.2% of the invoice total when the customer pays it online.", source: S.auPricing },
      { id: "keyed", option: "Card keyed in (MOTO) or card on file", group: "Phone & saved cards", line: "Card processing: keyed in (MOTO)", rate: { pct: 2.2, fixed: 0 }, intl: "none", shipping: true, explain: "2.2% when you key in card details on the app, an invoice or Virtual Terminal, or charge a card on file.", source: S.auPricing },
      { id: "afterpay", option: "Afterpay (customer pays in instalments)", group: "Buy now, pay later", line: "Afterpay fee", rate: AFTERPAY, intl: "none", gstOnFee: AU_GST, shipping: true, explain: "6% + 30¢ of the whole order, quoted excluding GST. You’re paid in full up front and there’s no fee on the later instalments.", source: S.auPricing },
    ];
  }
  const cp = US_CARD_PRESENT[plan];
  const on = US_ONLINE[plan];
  const btc = bitcoinRate(at);
  return [
    { id: "in_person", option: "In person: tap, dip or swipe", group: "In person", line: "Card processing: in person", rate: cp, intl: "addon", shipping: false, byPlan: true, explain: "2.6% + 15¢ on Square Free, 2.5% + 15¢ on Plus and 2.4% + 15¢ on Premium, taken from the whole amount charged to the card, sales tax and tip included.", source: S.help },
    { id: "tap_to_pay", option: "Tap to Pay on iPhone or Android", group: "In person", line: "Card processing: Tap to Pay", rate: cp, intl: "addon", shipping: false, byPlan: true, explain: "Tap to Pay is an in-person card payment: 2.6% + 15¢ per tap on Square Free (the in-person rate of 2.5% or 2.4% + 15¢ on Plus or Premium), on the whole amount including tax and tip.", source: S.tap },
    { id: "ebt", option: "EBT (SNAP) card", group: "In person", line: "EBT processing", rate: US_EBT, intl: "none", shipping: false, explain: "1.8% + 5¢ per EBT payment for SNAP-eligible items, on every plan. The international card fee doesn’t apply.", source: S.ourFees },
    {
      id: "bitcoin",
      option: "Bitcoin (customer scans a QR code)",
      group: "In person",
      line: "Bitcoin payment fee",
      rate: { pct: btc, fixed: 0 },
      intl: "none",
      shipping: false,
      explain: btc ? "1% of the payment since January 1, 2027." : "Square charges 0% on bitcoin payments until December 31, 2026. From January 1, 2027 it will be 1%.",
      source: S.help,
    },
    { id: "online", option: "Online store or payment link", group: "Online & invoices", line: "Card processing: online", rate: on, intl: "addon", shipping: true, byPlan: true, explain: "3.3% + 30¢ on Square Free, 2.9% + 30¢ on Plus and Premium, on everything the card is charged: items, shipping, tax and tip. Covers Square Online, payment links, subscriptions and eGift cards.", source: S.help },
    { id: "invoice_card", option: "Invoice paid by card", group: "Online & invoices", line: "Card processing: invoice", rate: on, intl: "addon", shipping: true, byPlan: true, explain: "Invoices paid by card cost the same as online payments: 3.3% + 30¢ on Square Free, 2.9% + 30¢ on Plus and Premium, on the full invoice total.", source: S.help },
    { id: "ach", option: "Invoice paid by bank transfer (ACH)", group: "Online & invoices", line: "ACH bank transfer fee", rate: { pct: ACH_PCT, fixed: 0 }, intl: "none", ach: { cap: ACH_INVOICE_CAP[plan] }, shipping: true, byPlan: true, explain: "1% of the payment, at least $1. Square Plus, Square Premium and older (legacy) plans cap it at $10; Square’s fee table lists no cap on Square Free. No fee when the money goes into Square Checking.", source: S.help },
    { id: "api", option: "Your own website or app (Square API)", group: "Online & invoices", line: "Card processing: Online API", rate: US_API, intl: "addon", shipping: true, explain: "2.9% + 30¢ on every plan for cards taken inside your own website or app with Square’s payments APIs and SDKs.", source: S.ourFees },
    { id: "ach_api", option: "Bank transfer (ACH) on your own site (API)", group: "Online & invoices", line: "ACH bank transfer fee (API)", rate: { pct: ACH_PCT, fixed: 0 }, intl: "none", ach: { cap: ACH_API_CAP }, shipping: true, explain: "1% of the payment, at least $1 and at most $5, for bank payments taken with Square’s Web Payments SDK and Payments API. No fee into Square Checking.", source: S.dev },
    { id: "keyed", option: "Card typed in, or card on file", group: "Phone & saved cards", line: "Card processing: keyed in / card on file", rate: US_KEYED, intl: "addon", shipping: true, explain: "3.5% + 15¢ on every plan when a card number is typed in (Virtual Terminal, the app or an invoice) or a saved card on file is charged. It costs more because neither the card nor the cardholder is present.", source: S.help },
    { id: "afterpay", option: "Afterpay (customer pays in 4)", group: "Buy now, pay later", line: "Afterpay fee", rate: AFTERPAY, intl: "none", shipping: true, explain: "6% + 30¢ of the whole order on every plan. You’re paid in full up front; there’s no fee on the customer’s later installments, and the international card fee doesn’t apply.", source: S.help },
  ];
}

function planOf(inputs: Inputs): Plan {
  const p = str(inputs, "plan", "free");
  return p === "plus" || p === "premium" ? p : "free";
}

function methodFor(inputs: Inputs, market: Market, at?: number): Method {
  const list = methods(market, planOf(inputs), str(inputs, "auRate", "1.6") === "1.9", at);
  return list.find((m) => m.id === str(inputs, "paymentType", "in_person")) ?? list[0];
}

const INTL_TYPES = (m: Method, market: Market) => market.id !== "au" && m.intl !== "none";

/** Smallest price in cents (up to $1,000,000) where `reached` holds, for a condition that stays true once met. */
function firstPrice(reached: (cents: number) => boolean, ceiling = 100_000_000): number | null {
  if (!reached(ceiling)) return null;
  let lo = 0;
  let hi = ceiling;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (reached(mid)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/* ---------------- the calculation ---------------- */

function calculate(inputs: Inputs, market: Market) {
  const money = moneyFor(market);
  const method = methodFor(inputs, market);
  const plan = market.id === "us" ? planOf(inputs) : "free";

  const price = toCents(num(inputs, "price"));
  const shipping = method.shipping ? toCents(num(inputs, "shippingCharged")) : 0;
  const taxRate = market.id === "us" || market.id === "ca" ? Math.min(30, Math.max(0, num(inputs, "salesTax"))) : 0;
  const tax = pct(price, taxRate);
  const tip = toCents(num(inputs, "tip"));
  const total = price + shipping + tax + tip; // what the card (or bank account) is charged
  const taxTip = tax + tip;
  const intl = INTL_TYPES(method, market) && bool(inputs, "intlCard");
  const intoChecking = market.id === "us" && Boolean(method.ach) && bool(inputs, "squareChecking");

  const fees: Line[] = [];
  const onTaxTip = (rate: number) => (taxTip ? pct(total, rate) - pct(total - taxTip, rate) : 0);
  const taxTipText = (rate: number) => {
    const part = onTaxTip(rate);
    if (!part) return "";
    const what = tax && tip ? "the sales tax and tip" : tax ? "the sales tax" : "the tip";
    return ` ${money(part)} of it is the fee on ${what}.`;
  };

  if (total > 0) {
    if (method.ach) {
      const raw = pct(total, ACH_PCT);
      const cap = method.ach.cap;
      let amount = Math.max(ACH_MIN, raw);
      if (cap !== undefined) amount = Math.min(cap, amount);
      const detail = intoChecking
        ? "Paid into Square Checking: no fee"
        : raw < ACH_MIN
          ? `1% would be ${money(raw)}; minimum ${money(ACH_MIN)}`
          : cap !== undefined && raw > cap
            ? `1% would be ${money(raw)}, capped at ${money(cap)}`
            : `1% × ${money(total)}`;
      fees.push({ id: "processing", label: method.line, amount: intoChecking ? 0 : amount, kind: "payment", detail, explain: method.explain, source: method.source });
    } else {
      const r = intl && method.intl === "own" && method.intlRate ? method.intlRate : method.rate;
      const amount = pct(total, r.pct) + r.fixed;
      const label = intl && method.intl === "own" ? `${method.line} (non-UK card)` : method.line;
      fees.push({
        id: "processing",
        label,
        amount,
        kind: "payment",
        detail: r.fixed ? `${formatRate(r.pct)} × ${money(total)} + ${money(r.fixed)}` : `${formatRate(r.pct)} × ${money(total)}`,
        explain: `${method.explain}${taxTipText(r.pct)}`,
        source: method.source,
      });
      if (method.gstOnFee) {
        fees.push({
          id: "gst",
          label: `GST on the ${method.id === "afterpay" ? "Afterpay " : ""}fee (${formatRate(method.gstOnFee)})`,
          amount: pct(amount, method.gstOnFee),
          kind: "tax",
          detail: `${formatRate(method.gstOnFee)} × ${money(amount)}`,
          explain: "Square quotes the Australian Afterpay fee excluding GST, so 10% GST is added to it. GST-registered businesses can usually claim it back.",
          source: S.auPricing,
        });
      }
    }
    if (intl && method.intl === "addon") {
      fees.push({
        id: "intl",
        label: "International card fee",
        amount: pct(total, INTL),
        kind: "payment",
        detail: `${formatRate(INTL)} × ${money(total)}`,
        explain: `Square adds 1.5% of the payment total when the card was issued in a different country from your Square account, on top of the normal rate. It goes by where the card was issued, not where the customer is.`,
        source: market.id === "uk" ? S.ukFees : market.id === "ca" ? S.caPricing : S.help,
      });
    }
  }

  const processing = fees.reduce((s, l) => s + l.amount, 0);
  const balance = total - processing; // what this payment adds to your Square balance

  const notes: string[] = [];
  const instant = str(inputs, "payout", "standard") === "instant";
  if (instant && balance > 0) {
    const lim = INSTANT_LIMITS[market.id] ?? INSTANT_LIMITS.us;
    const label = market.id === "us" ? "Instant / same-day transfer fee" : "Instant transfer fee";
    if (intoChecking) {
      // "Your money is instantly available in a free business checking account after every sale — no transfers needed."
      fees.push({
        id: "instant",
        label,
        amount: 0,
        kind: "payout",
        detail: "Paid into Square Checking: nothing to transfer",
        explain: "Money paid into Square Checking is available there straight away, with no transfer needed, so no instant transfer fee applies.",
        source: S.instant,
      });
    } else {
      const tooBig = market.id === "us" && total > lim.max;
      // UK and Australia: the limit is per day, so only that much of this payment goes out instantly.
      const capped = !tooBig && lim.perDay && balance > lim.max;
      const base = capped ? lim.max : balance;
      const src = market.id === "uk" ? S.ukInstant : market.id === "ca" ? S.caHelp : market.id === "au" ? S.auTerms : S.transfers;
      fees.push({
        id: "instant",
        label,
        amount: tooBig ? 0 : pct(base, INSTANT),
        kind: "payout",
        detail: tooBig ? "Payments over $10,000 go out next business day, free" : `${formatRate(INSTANT)} × ${money(base)}${capped ? " (daily limit)" : ""}`,
        explain: tooBig
          ? "Square doesn’t send single payments over $10,000 by instant or same-day transfer; they arrive in one to two business days at no charge."
          : capped
            ? `1.95% of the amount transferred. Square sends at most ${lim.maxText} by instant transfer, so the rest of this payment goes out on the free standard schedule.`
            : `1.95% of the amount transferred: what this payment leaves in your Square balance after processing fees${tax ? ", sales tax included" : ""}. Standard transfers are free.`,
        source: src,
      });
      if (!tooBig && balance < lim.min) notes.push(`Square only sends instant transfers of ${money(lim.min)} or more, so this payment would go out together with other sales.`);
      if (capped) notes.push(`Instant transfers are limited to ${lim.maxText}, so the rest of this payment follows on the free standard schedule.`);
      if (!tooBig && !lim.perDay && balance > lim.max) notes.push(`Square caps each instant transfer at ${lim.maxText.replace(" per transfer", "")}, so moving this balance instantly takes more than one transfer.`);
    }
  }

  const totalFees = fees.reduce((s, l) => s + l.amount, 0);
  if (tax) {
    notes.push(`Square deposits ${money(total - totalFees)} for this payment. That includes the ${money(tax)} sales tax you collected and owe, which isn’t counted in what you keep.`);
  } else if (!tip && (market.id === "us" || market.id === "ca") && !method.ach && method.id !== "ebt" && method.id !== "bitcoin") {
    notes.push("Square takes its percentage of sales tax and tips too. Add them under “More options” for the exact fee.");
  }

  if (market.id === "us" && method.byPlan) {
    const k = (c: number) => formatMoney(c, market.currency, market.locale, { whole: true });
    if (plan === "free" && (method.id === "online" || method.id === "invoice_card")) {
      const be = Math.round((PLAN_MONTHLY.plus * 100) / (US_ONLINE.free.pct - US_ONLINE.plus.pct));
      notes.push(`Square Plus ($49 a month per location) charges 2.9% + 30¢ instead of 3.3% + 30¢ online. It covers its cost above about ${k(be)} a month of online and invoice card payments.`);
    } else if (plan === "free" && (method.id === "in_person" || method.id === "tap_to_pay")) {
      const be = Math.round((PLAN_MONTHLY.plus * 100) / (US_CARD_PRESENT.free.pct - US_CARD_PRESENT.plus.pct));
      notes.push(`Square Plus ($49 a month per location) lowers this to 2.5% + 15¢, which only covers its cost above about ${k(be)} a month of in-person card sales.`);
    } else if (plan === "free" && method.ach && !bool(inputs, "squareChecking") && pct(total, ACH_PCT) > (ACH_INVOICE_CAP.plus ?? 0)) {
      notes.push(`On Square Plus, Square Premium or an older (legacy) Square plan this ACH fee would be capped at ${money(ACH_INVOICE_CAP.plus ?? 0)}.`);
    } else if (plan !== "free") {
      notes.push(`Square ${PLAN_NAME[plan]} also costs ${k(PLAN_MONTHLY[plan])} a month per location, which isn’t included in these per-payment fees.`);
    }
  }
  if (market.id === "au") notes.push("Since 1 October 2026 Square sellers in Australia can’t add a surcharge to card payments, so build the fee into your prices.");
  const kept = fees.filter((l) => l.id !== "instant").reduce((s, l) => s + l.amount, 0);
  if (kept > 0) notes.push(`If you refund this payment, Square keeps the ${money(kept)} in processing fees.`);

  return assemble({
    market,
    buyerPays: total,
    saleAmount: price + shipping + tip,
    fees,
    costs: costLines(inputs, market),
    notes: notes.slice(0, 3),
  });
}

/* ---------------- the fee table ---------------- */

function schedule(market: Market): ScheduleRow[] {
  if (market.id === "uk") {
    return [
      { fee: "In person (incl. Tap to Pay)", amount: "1.75%", appliesTo: "Whole amount, incl. VAT and tip", when: "Contactless, chip and PIN, swipe", source: S.ukFees },
      { fee: "Online", amount: "1.4% + 25p (UK cards) · 2.5% + 25p (non-UK cards)", appliesTo: "Whole amount charged", when: "Square Online, Online Checkout, eCommerce API, digital gift cards", source: S.ukFees },
      { fee: "Invoices, Virtual Terminal, keyed, card on file", amount: "2.5%", appliesTo: "Whole amount charged", when: "Card not present", source: S.ukFees },
      { fee: "International cards", amount: "+1.5%", appliesTo: "Payment total", when: "Non-UK card (not online, which has its own rate; not Clearpay)", source: S.ukFees },
      { fee: "Clearpay", amount: "6% + 30p", appliesTo: "Whole order", when: "Customer pays in instalments", source: S.ukPricing },
      { fee: "Instant transfer", amount: "1.95%", appliesTo: "Balance transferred (after card fees)", when: "Only if you choose it; min £15, max £3,500 a day", source: S.ukInstant },
      { fee: "Chargebacks", amount: "£0", appliesTo: "—", when: "No dispute fee", source: S.ukHelp },
      { fee: "Refunds", amount: "Fee not returned", appliesTo: "The original processing fee", when: "Full or partial refund", source: S.press2023 },
      { fee: "Plan", amount: "Free £0 · Plus from £29/mo", appliesTo: "Per month", when: "Processing rates are the same on both", source: S.ukPricing },
    ];
  }
  if (market.id === "ca") {
    return [
      { fee: "Credit card in person (incl. Tap to Pay)", amount: "2.5%", appliesTo: "Whole amount, incl. tax and tip", when: "Tap, insert or swipe", source: S.caPricing },
      { fee: "Debit card in person", amount: "0.75% + 7¢", appliesTo: "Whole amount", when: "Interac / debit tapped or inserted", source: S.caPricing },
      { fee: "Online & invoices paid online", amount: "2.8% + 30¢", appliesTo: "Whole amount, incl. shipping and tax", when: "Online store, Online Checkout, eCommerce API, invoices", source: S.caPricing },
      { fee: "Keyed in, card on file, Virtual Terminal link", amount: "3.3% + 15¢", appliesTo: "Whole amount", when: "Card not present", source: S.caPricing },
      { fee: "International cards", amount: "+1.5%", appliesTo: "Payment total", when: "Card issued outside Canada (not Interac or Afterpay)", source: S.caTerms },
      { fee: "Afterpay", amount: "6% + 30¢", appliesTo: "Whole order", when: "Customer pays in instalments", source: S.caPricing },
      { fee: "Instant transfer", amount: "1.95%", appliesTo: "Amount transferred", when: "Only if you choose it; C$25 to C$5,000", source: S.caHelp },
      { fee: "Gift card load", amount: "2.5%", appliesTo: "Amount loaded", when: "Plus normal processing on the sale", source: S.caHelp },
      { fee: "Chargebacks", amount: "$0", appliesTo: "—", when: "No dispute fee", source: S.caHelp },
      { fee: "Refunds", amount: "Fee not returned", appliesTo: "The original processing fee", when: "Full or partial refund", source: S.caTerms },
    ];
  }
  if (market.id === "au") {
    return [
      { fee: "In person (incl. Tap to Pay)", amount: "1.6% (1.9% for some older accounts)", appliesTo: "Whole amount, incl. GST and tip", when: "1.9%: signed up before 30 May 2024, on Reader, Stand or Tap to Pay", source: S.auHelp },
      { fee: "Online & invoices paid online", amount: "2.2%", appliesTo: "Whole amount charged", when: "Online store, Online Checkout, payment links, eCommerce API", source: S.auPricing },
      { fee: "MOTO (keyed in, card on file)", amount: "2.2%", appliesTo: "Whole amount charged", when: "Card not present", source: S.auPricing },
      { fee: "Afterpay", amount: "6% + 30¢ + GST", appliesTo: "Whole order", when: "Customer pays in instalments", source: S.auPricing },
      { fee: "Instant transfer", amount: "1.95%", appliesTo: "Proceeds transferred", when: "Only if you choose it; A$5 to A$5,000 a day", source: S.auTerms },
      { fee: "Gift card load", amount: "2.5%", appliesTo: "Amount loaded", when: "Plus normal processing on the sale", source: S.auHelp },
      { fee: "Chargebacks", amount: "$0", appliesTo: "—", when: "No dispute fee", source: S.auHelp },
      { fee: "Surcharges", amount: "Not allowed", appliesTo: "Card payments", when: "From 1 October 2026", source: S.auTerms },
      { fee: "Refunds", amount: "Fee not returned", appliesTo: "The original processing fee", when: "Full or partial refund", source: S.press2023 },
    ];
  }
  return [
    { fee: "Tap, dip or swipe (incl. Tap to Pay)", amount: "2.6% + 15¢ · Plus 2.5% + 15¢ · Premium 2.4% + 15¢", appliesTo: "Whole amount, incl. tax and tip", when: "Card present in person", source: S.ourFees },
    { fee: "Online & invoices paid by card", amount: "3.3% + 30¢ · Plus & Premium 2.9% + 30¢", appliesTo: "Whole amount, incl. shipping, tax and tip", when: "Square Online, payment links, invoices, subscriptions", source: S.ourFees },
    { fee: "Online API", amount: "2.9% + 30¢", appliesTo: "Whole amount charged", when: "Your own site or app via Square’s APIs (every plan)", source: S.ourFees },
    { fee: "Manual entry or card on file", amount: "3.5% + 15¢", appliesTo: "Whole amount charged", when: "Card typed in or saved card charged (every plan)", source: S.ourFees },
    { fee: "ACH bank transfer (invoice)", amount: "1%, $1 min · $10 cap on Plus & Premium", appliesTo: "Invoice payment", when: "No cap listed on Free; $0 into Square Checking", source: S.ourFees },
    { fee: "ACH bank transfer (API)", amount: "1%, $1 min, $5 cap", appliesTo: "Payment amount", when: "Web Payments SDK + Payments API", source: S.ourFees },
    { fee: "Afterpay", amount: "6% + 30¢", appliesTo: "Whole order", when: "Every plan", source: S.ourFees },
    { fee: "EBT (SNAP)", amount: "1.8% + 5¢", appliesTo: "Payment amount", when: "In person, SNAP-eligible items", source: S.ourFees },
    { fee: "Bitcoin payments", amount: bitcoinRate() ? "1%" : "0% (1% from Jan 1, 2027)", appliesTo: "Payment amount", when: "Customer scans a QR code in person", source: S.help },
    { fee: "International cards", amount: "+1.5%", appliesTo: "Payment total", when: "Card issued outside the US (not ACH, Afterpay, Cash App Pay, EBT, bitcoin)", source: S.help },
    { fee: "Instant or same-day transfer", amount: "1.95%", appliesTo: "Amount transferred", when: "Only if you choose it; next-business-day is free", source: S.transfers },
    { fee: "Gift card load", amount: "2.5% · Premium 0%", appliesTo: "Amount loaded", when: "Plus normal processing on the sale", source: S.help },
    { fee: "Plan", amount: "Free $0 · Plus $49 · Premium $149", appliesTo: "Per location, per month", when: "Plus & Premium lower the rates above", source: S.pricing },
    { fee: "Chargebacks", amount: "$0", appliesTo: "—", when: "No chargeback or dispute fee", source: S.help },
    { fee: "Refunds", amount: "Fee not returned", appliesTo: "The original processing fee", when: "Full or partial refund", source: S.refunds },
  ];
}

/* ---------------- fields ---------------- */

const ONLINE_ISH = (inputs: Inputs, market: Market) => methodFor(inputs, market).shipping;

function paymentOptions(inputs: Inputs, market: Market): SelectOption[] {
  return methods(market, planOf(inputs), str(inputs, "auRate", "1.6") === "1.9").map((m) => {
    let hint = m.ach ? `1%, $1 min${m.ach.cap !== undefined ? `, $${m.ach.cap / 100} cap` : ""}` : rateText(market, m.rate);
    if (m.gstOnFee) hint += " + GST";
    return { value: m.id, label: m.option, hint, group: m.group };
  });
}

export const square: CalculatorDef = {
  slug: "square",
  name: "Square",
  path: "/square-fee-calculator",
  category: "payments",
  priceNoun: "sale amount",
  sellerNoun: "seller",
  blurb: "2.6% + 15¢ in person, 3.3% + 30¢ online, 3.5% + 15¢ keyed in (US, Square Free)",
  markets: MARKETS,
  defaultMarket: "us",
  priceField: "price",
  fields: [
    { id: "price", kind: "money", label: "Sale amount", section: "sale", help: "Before any sales tax and tip you add. Checking a past payment? Enter the total charged and leave tax and tip at zero." },
    { id: "paymentType", kind: "select", label: "How does the customer pay?", section: "sale", options: paymentOptions, help: "This changes the rate more than anything else." },
    {
      id: "plan",
      kind: "segmented",
      label: "Your Square plan",
      section: "sale",
      options: [
        { value: "free", label: "Free" },
        { value: "plus", label: "Plus" },
        { value: "premium", label: "Premium" },
      ],
      help: "Plus and Premium cost $49 and $149 a month per location and lower some rates. On an older Square plan, pick Free.",
      showIf: (i, m) => m.id === "us" && Boolean(methodFor(i, m).byPlan),
    },
    { id: "salesTax", kind: "percent", label: "Sales tax you add", section: "sale", advanced: true, max: 30, help: "Square takes its percentage of the tax too, because it’s part of what the card is charged.", showIf: (_i, m) => m.id === "us" || m.id === "ca" },
    { id: "tip", kind: "money", label: "Tip", section: "sale", advanced: true, help: "Square’s percentage applies to tips as well." },
    { id: "shippingCharged", kind: "money", label: "Shipping or delivery you charge", section: "shipping", help: "It’s part of what the card is charged, so Square takes its percentage of it too.", showIf: ONLINE_ISH },
    {
      id: "payout",
      kind: "segmented",
      label: "How do you get your money?",
      section: "options",
      options: [
        { value: "standard", label: "Standard · free" },
        { value: "instant", label: "Instant · 1.95%" },
      ],
      help: "Standard transfers are free. Instant transfers (and same-day transfers in the US) cost 1.95% of the amount sent.",
    },
    {
      id: "intlCard",
      kind: "toggle",
      label: "The customer’s card is from another country",
      section: "options",
      advanced: true,
      help: "Square adds 1.5% when the card was issued abroad. It goes by the card, not where the customer is.",
      showIf: (i, m) => INTL_TYPES(methodFor(i, m), m),
    },
    {
      id: "squareChecking",
      kind: "toggle",
      label: "The ACH payment goes into Square Checking",
      section: "options",
      advanced: true,
      help: "Square charges no ACH fee when the money lands in a Square Checking account.",
      showIf: (i, m) => m.id === "us" && Boolean(methodFor(i, m).ach),
    },
    {
      id: "auRate",
      kind: "segmented",
      label: "Your in-person rate",
      section: "options",
      advanced: true,
      options: [
        { value: "1.6", label: "1.6% (most sellers)" },
        { value: "1.9", label: "1.9% (older accounts)" },
      ],
      help: "1.9% applies if you signed up before 30 May 2024 and use Square Reader, Stand or Tap to Pay without a paid plan.",
      showIf: (i, m) => m.id === "au" && (str(i, "paymentType", "in_person") === "in_person" || str(i, "paymentType") === "tap_to_pay"),
    },
    { id: "itemCost", kind: "money", label: "What the item or service cost you", section: "costs", help: "Stock, materials or your direct cost." },
    { id: "shippingCost", kind: "money", label: "Postage / delivery you pay", section: "costs" },
    { id: "otherCost", kind: "money", label: "Packaging & other", section: "costs" },
  ],
  defaults: () => ({
    price: 50,
    paymentType: "in_person",
    plan: "free",
    salesTax: 0,
    tip: 0,
    shippingCharged: 0,
    payout: "standard",
    intlCard: false,
    squareChecking: false,
    auRate: "1.6",
    itemCost: 0,
    shippingCost: 0,
    otherCost: 0,
  }),
  calculate,
  breakpoints: (inputs, market) => {
    // Where the formula changes shape, as prices: the ACH $1 minimum and cap, the US instant transfer
    // dropping away above a $10,000 payment, and the UK/AU daily instant limit. The payment total and the
    // balance both rise with the price, so each edge is found exactly by bisection on the real calculation.
    const method = methodFor(inputs, market);
    const at = (c: number) => calculate({ ...inputs, price: c / 100, payout: "standard" }, market);
    const out: number[] = [];
    const add = (p: number | null) => {
      if (p !== null && p > 0) out.push(p);
    };
    const intoChecking = market.id === "us" && bool(inputs, "squareChecking");
    if (method.ach && !intoChecking) {
      add(firstPrice((c) => at(c).buyerPays >= ACH_MIN * 100)); // 1% of a $100 payment is the $1 minimum
      const cap = method.ach.cap;
      if (cap !== undefined) add(firstPrice((c) => at(c).buyerPays >= cap * 100));
    }
    if (str(inputs, "payout", "standard") === "instant" && !(method.ach && intoChecking)) {
      const lim = INSTANT_LIMITS[market.id] ?? INSTANT_LIMITS.us;
      if (market.id === "us") add(firstPrice((c) => at(c).buyerPays > lim.max));
      else if (lim.perDay)
        add(
          firstPrice((c) => {
            const r = at(c);
            return r.buyerPays - r.totalFees >= lim.max;
          }),
        );
    }
    return out;
  },
  verifiedAt: "2026-10-23",
  sources,
  changes,
  schedule,
  compare: {
    group: "pay",
    map: (c) => ({ price: c.price, shippingCharged: c.shipping, paymentType: "online", plan: "free", itemCost: c.itemCost, shippingCost: c.shippingCost }),
    note: "US online payment or payment link, Square Free plan, standard transfer",
  },
};

export default square;
