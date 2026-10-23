/*
 * Shopify merchant fees. Every number is from Shopify's own pages (see `sources`), re-read on
 * 2026-10-23. Research notes with verbatim quotes: research/fees/shopify.md.
 *
 * How one order is costed (what this module reproduces):
 *  - Plan subscription: a flat monthly fee by plan and billing period (yearly = lower monthly
 *    price, charged upfront), spread across the orders of a month so it shows per sale.
 *  - Shopify Payments: rate + fixed fee per order on the amount captured, i.e. everything the
 *    customer pays (products after discounts + shipping + tax), less any gift card / store credit.
 *    US: standard (domestic consumer) vs premium (domestic business cards and all US-issued AmEx)
 *    rates, +1% cross-border for foreign cards. UK / CA / AU publish full AmEx and international
 *    rates (not surcharges). Separate in-person, keyed-in (US), Interac (CA) and PayPal Wallet (US)
 *    rates.
 *  - Currency conversion (Shopify Payments): rate × gross order amount since 2026-04-06.
 *  - Australia: GST is added to Shopify Payments processing fees (10% = Australia's GST rate;
 *    Shopify says tax is added but not the rate).
 *  - Third-party provider: Shopify's transaction fee by plan on [(products − discounts) + tax +
 *    shipping], plus the provider's own fee (an input). PayPal is exempt when Shopify Payments is
 *    the primary provider.
 *  - Gift cards / store credit (stores created on or after 2025-05-12): Shopify's transaction fee
 *    on the part paid that way, even on Shopify Payments.
 *  - Shopify Tax (optional, after the free threshold): rate × order, max 0.99 per order.
 * Shopify doesn't document its rounding; each line is rounded to the cent separately (half away
 * from zero), the way the payout transactions list them.
 */
import { M } from "../markets";
import { assemble, bool, costLines, formatMoney, formatRate, moneyFor, num, pct, str, toCents } from "../money";
import type { CalculatorDef, FeeChange, Inputs, Line, Market, ScheduleRow, SelectOption, Source } from "../types";

const MARKETS: Market[] = [M.us, M.uk, M.ca, M.au];

export type Plan = "basic" | "grow" | "advanced" | "plus";
const PLANS: Plan[] = ["basic", "grow", "advanced", "plus"];
const PLAN_NAME: Record<Plan, string> = { basic: "Basic", grow: "Grow", advanced: "Advanced", plus: "Plus" };

/** Percentage + fixed fee (fixed in cents of the market's currency). */
interface Rate {
  pct: number;
  fixed: number;
}
type ByPlan = Record<Plan, Rate>;
const byPlan = (pcts: [number, number, number, number], fixed: number | [number, number, number, number]): ByPlan => {
  const f = (i: number) => (Array.isArray(fixed) ? fixed[i] : fixed);
  return {
    basic: { pct: pcts[0], fixed: f(0) },
    grow: { pct: pcts[1], fixed: f(1) },
    advanced: { pct: pcts[2], fixed: f(2) },
    plus: { pct: pcts[3], fixed: f(3) },
  };
};

interface MarketData {
  /** Plan prices per month, cents. `yearly` is the per-month price when billed yearly. */
  monthly: Record<Exclude<Plan, "plus">, number>;
  yearly: Record<Exclude<Plan, "plus">, number>;
  /** Shopify Plus platform fee per month: 3-year and 1-year term. */
  plus3: number;
  plus1: number;
  posPro: number;
  /** Online, domestic standard / consumer cards. */
  online: ByPlan;
  /** US: premium cards (domestic business + all US AmEx). UK/CA/AU: American Express. */
  premium: ByPlan;
  /** Full international rate (UK/CA/AU). The US adds `intlSurcharge` to the base rate instead. */
  intl?: ByPlan;
  intlSurcharge?: number;
  inPerson: ByPlan;
  /** Manually entered cards (US only on the pricing page). */
  manual?: ByPlan;
  /** In-person Interac debit (Canada). */
  interac?: ByPlan;
  /** PayPal Wallet through Shopify Payments (US), a "starting at" rate. */
  paypal?: Rate;
  /** Currency conversion fee, percent. */
  fx: number;
  fxPaypal?: number;
  /** Chargeback fee, cents. */
  chargeback: number;
  /** Tax added to Shopify Payments processing fees (Australia: GST). */
  taxOnFees?: { rate: number; name: string };
  /** Smallest amount Shopify Payments can charge, cents. */
  minCharge: number;
  /** Shopify Tax calculation fee after the free threshold (stores outside US/UK/CA/EU: not offered here). */
  shopifyTax?: { nonPlus: number; plus: number; cap: number; threshold: number };
  /** Words for the card question. */
  country: string;
  premiumLabel: string;
}

const DATA: Record<string, MarketData> = {
  us: {
    monthly: { basic: 3900, grow: 10500, advanced: 39900 },
    yearly: { basic: 2900, grow: 7900, advanced: 29900 },
    plus3: 230000,
    plus1: 250000,
    posPro: 8900,
    online: byPlan([2.9, 2.7, 2.5, 2.25], 30),
    premium: byPlan([3.5, 3.3, 3.1, 2.95], 30),
    intlSurcharge: 1,
    inPerson: byPlan([2.6, 2.5, 2.4, 2.3], 10),
    manual: byPlan([3.5, 3.5, 3.5, 3.4], 10),
    paypal: { pct: 3.49, fixed: 49 },
    fx: 1.5,
    fxPaypal: 3,
    chargeback: 1500,
    minCharge: 50,
    shopifyTax: { nonPlus: 0.35, plus: 0.25, cap: 99, threshold: 10000000 },
    country: "the US",
    premiumLabel: "Business card or American Express",
  },
  uk: {
    monthly: { basic: 2500, grow: 6500, advanced: 34400 },
    yearly: { basic: 1900, grow: 4900, advanced: 25900 },
    plus3: 180000,
    plus1: 195000,
    posPro: 6900,
    online: byPlan([2, 1.7, 1.5, 1.3], 25),
    premium: byPlan([3.1, 2.7, 2.5, 2.3], 25),
    intl: byPlan([3.1, 2.7, 2.5, 2.3], 25),
    inPerson: byPlan([1.7, 1.6, 1.5, 1.5], 0),
    fx: 2,
    chargeback: 1000,
    minCharge: 30,
    shopifyTax: { nonPlus: 0.25, plus: 0.15, cap: 99, threshold: 10000000 },
    country: "the UK",
    premiumLabel: "American Express",
  },
  ca: {
    monthly: { basic: 4900, grow: 13200, advanced: 51700 },
    yearly: { basic: 3700, grow: 9900, advanced: 38900 },
    plus3: 340000,
    plus1: 365000,
    posPro: 11900,
    online: byPlan([2.8, 2.6, 2.4, 2.15], 30),
    premium: byPlan([3.5, 3.4, 3.3, 3.15], 30),
    intl: byPlan([3.5, 3.4, 3.3, 3.15], 30),
    inPerson: byPlan([2.6, 2.5, 2.4, 2.4], 0),
    interac: byPlan([0, 0, 0, 0], [15, 15, 15, 10]),
    fx: 2,
    chargeback: 1500,
    minCharge: 50,
    shopifyTax: { nonPlus: 0.25, plus: 0.15, cap: 99, threshold: 10000000 },
    country: "Canada",
    premiumLabel: "American Express",
  },
  au: {
    monthly: { basic: 5600, grow: 14900, advanced: 57500 },
    yearly: { basic: 4200, grow: 11400, advanced: 43100 },
    plus3: 370000,
    plus1: 400000,
    posPro: 12900,
    online: byPlan([1.7, 1.55, 1.35, 1.15], 30),
    premium: byPlan([2.9, 2.8, 2.7, 2.6], 30),
    intl: byPlan([3.5, 3.4, 3.3, 3.2], 30),
    inPerson: byPlan([1.85, 1.75, 1.65, 1.45], 0),
    fx: 2,
    chargeback: 2500,
    taxOnFees: { rate: 10, name: "GST" },
    minCharge: 50,
    country: "Australia",
    premiumLabel: "American Express",
  },
};

/** Shopify's transaction fee when another provider takes the payment (same in every market). */
export const THIRD_PARTY: Record<Plan, number> = { basic: 2, grow: 1, advanced: 0.6, plus: 0.2 };

const S = {
  pricing: "shopify-pricing",
  pricingUk: "shopify-pricing-uk",
  pricingCa: "shopify-pricing-ca",
  pricingAu: "shopify-pricing-au",
  plus: "shopify-plus-plan",
  cardTypes: "shopify-card-rates-us",
  intlCards: "shopify-intl-cards",
  thirdParty: "shopify-third-party-fees",
  withThirdParty: "shopify-payments-with-third-party",
  fx: "shopify-fx-fees",
  fxCalc: "shopify-fx-calculation",
  payoutFees: "shopify-payout-fees",
  multiCurrency: "shopify-multi-currency-payouts",
  chargeback: "shopify-chargebacks",
  refunds: "shopify-refunds",
  minimum: "shopify-min-amounts",
  tax: "shopify-tax-pricing",
  taxPage: "shopify-tax",
  starter: "shopify-starter",
} as const;

const PRICING_SOURCE: Record<string, string> = { us: S.pricing, uk: S.pricingUk, ca: S.pricingCa, au: S.pricingAu };

const sources: Source[] = [
  { id: S.pricing, title: "Shopify Pricing: Find the Right Plan for Your Business", url: "https://www.shopify.com/pricing", publisher: "Shopify", checked: "2026-10-23" },
  { id: S.pricingUk, title: "Shopify Pricing (United Kingdom)", url: "https://www.shopify.com/uk/pricing", publisher: "Shopify", checked: "2026-10-23" },
  { id: S.pricingCa, title: "Shopify Pricing (Canada)", url: "https://www.shopify.com/ca/pricing", publisher: "Shopify", checked: "2026-10-23" },
  { id: S.pricingAu, title: "Shopify Pricing (Australia)", url: "https://www.shopify.com/au/pricing", publisher: "Shopify", checked: "2026-10-23" },
  { id: S.plus, title: "Shopify Plus plan", url: "https://help.shopify.com/en/manual/intro-to-shopify/pricing-plans/plans-features/shopify-plus-plan", publisher: "Shopify Help Center", checked: "2026-10-23" },
  {
    id: S.cardTypes,
    title: "Shopify Payments rates in the United States by card type",
    url: "https://help.shopify.com/en/manual/payments/shopify-payments/transactions/credit-card-rates",
    publisher: "Shopify Help Center",
    checked: "2026-10-23",
  },
  {
    id: S.intlCards,
    title: "Understanding domestic, international, and European Economic Area (EEA) credit cards",
    url: "https://help.shopify.com/en/manual/payments/shopify-payments/transactions/domestic-international-eu-credit-cards",
    publisher: "Shopify Help Center",
    checked: "2026-10-23",
  },
  {
    id: S.thirdParty,
    title: "Third-party transaction fees on your Shopify bills",
    url: "https://help.shopify.com/en/manual/your-account/manage-billing/billing-charges/types-of-charges/third-party-charges/third-party-transaction-fees",
    publisher: "Shopify Help Center",
    checked: "2026-10-23",
  },
  {
    id: S.withThirdParty,
    title: "Using Shopify Payments with a third-party provider",
    url: "https://help.shopify.com/en/manual/payments/shopify-payments/using-shopify-payments-with-a-third-party-provider",
    publisher: "Shopify Help Center",
    checked: "2026-10-23",
  },
  { id: S.fx, title: "Fees and costs", url: "https://help.shopify.com/en/manual/international/pricing/fees", publisher: "Shopify Help Center", checked: "2026-10-23" },
  {
    id: S.fxCalc,
    title: "Currency conversion fee calculation for Shopify Payments orders",
    url: "https://help.shopify.com/en/manual/payments/shopify-payments/store-currency/currency-conversion-calculation",
    publisher: "Shopify Help Center",
    checked: "2026-10-23",
  },
  {
    id: S.payoutFees,
    title: "Viewing your Shopify Payments payout fees",
    url: "https://help.shopify.com/en/manual/payments/shopify-payments/payouts/pay-periods-and-fees",
    publisher: "Shopify Help Center",
    checked: "2026-10-23",
  },
  {
    id: S.multiCurrency,
    title: "Managing Multi-Currency Payouts with Shopify Payments",
    url: "https://help.shopify.com/en/manual/payments/shopify-payments/store-currency/payouts-in-multiple-currencies",
    publisher: "Shopify Help Center",
    checked: "2026-10-23",
  },
  { id: S.chargeback, title: "Chargeback process", url: "https://help.shopify.com/en/manual/payments/chargebacks/chargeback-process", publisher: "Shopify Help Center", checked: "2026-10-23" },
  { id: S.refunds, title: "Shopify Payments refunds", url: "https://help.shopify.com/en/manual/payments/shopify-payments/payouts/refunds", publisher: "Shopify Help Center", checked: "2026-10-23" },
  {
    id: S.minimum,
    title: "Minimum transaction amounts for Shopify Payments",
    url: "https://help.shopify.com/en/manual/payments/shopify-payments/transactions/min-transaction-amounts",
    publisher: "Shopify Help Center",
    checked: "2026-10-23",
  },
  { id: S.tax, title: "Shopify Tax pricing", url: "https://help.shopify.com/en/manual/taxes/shopify-tax/pricing", publisher: "Shopify Help Center", checked: "2026-10-23" },
  { id: S.taxPage, title: "Shopify Tax", url: "https://www.shopify.com/tax", publisher: "Shopify", checked: "2026-10-23" },
  { id: S.starter, title: "Starter plan", url: "https://help.shopify.com/en/manual/intro-to-shopify/pricing-plans/plans-features/shopify-starter-plan", publisher: "Shopify Help Center", checked: "2026-10-23" },
];

const changes: FeeChange[] = [
  {
    date: "2026-10-23",
    text: "Australian Shopify Payments rates lowered (listed on Shopify’s Australian pricing page by October 23, 2026; the old rates were still there on September 15): online cards 1.75% → 1.7% on Basic, 1.6% → 1.55% on Grow, 1.4% → 1.35% on Advanced, 1.2% → 1.15% on Plus; in person 1.95% → 1.85%, 1.85% → 1.75%, 1.75% → 1.65%, 1.55% → 1.45%. AmEx and international rates unchanged.",
    source: S.pricingAu,
  },
  { date: "2026-09-02", text: "By September 2, 2026 the US$5/month Starter plan was closed to new stores. Stores already on it can stay, but can’t switch back after changing plans.", source: S.starter },
  {
    date: "2026-05-13",
    text: "Shopify Tax for stores created from May 13, 2026: free on the first $100,000 of lifetime sales (was $100,000 per calendar year), then 0.35% per order in the US (0.25% on Plus), up to $0.99 per order, with no yearly cap.",
    source: S.tax,
  },
  {
    date: "2026-04-06",
    text: "Currency conversion fees are now charged on the gross order amount (1.5% × order for US stores) instead of (order − Shopify Payments fees) × rate ÷ (1 + rate), so the fee is slightly higher than before.",
    source: S.fxCalc,
  },
  {
    date: "2025-05-12",
    text: "Stores created from May 12, 2025 pay Shopify’s transaction fee (2% Basic, 1% Grow, 0.6% Advanced, 0.2% Plus) on the part of an order paid with gift cards or store credit, even on Shopify Payments.",
    source: S.thirdParty,
  },
  {
    date: "2025-04-25",
    text: "By April 25, 2025 Shopify’s US help center split online card rates into Standard and Premium: business, corporate and commercial cards and every US-issued American Express card pay the higher Premium rate (now 3.5% + 30¢ on Basic instead of 2.9% + 30¢).",
    source: S.cardTypes,
  },
  { date: "2025-04-05", text: "Trial changed from $1 for the first month to 3 days free, then $1 a month for the first 3 months (most plans).", source: S.pricing },
  {
    date: "2024-11-10",
    text: "Canadian rates lowered (by November 10, 2024): Basic online 2.9% → 2.8% + 30¢ and in person 2.7% → 2.6%; Grow online 2.7% → 2.6% + 30¢ and in person 2.6% → 2.5%.",
    source: S.pricingCa,
  },
];

const dataFor = (market: Market): MarketData => DATA[market.id] ?? DATA.us;

function planOf(inputs: Inputs): Plan {
  const p = str(inputs, "plan", "basic") as Plan;
  return PLANS.includes(p) ? p : "basic";
}

/** Monthly plan fee in cents for the chosen plan and billing period. */
export function planMonthly(market: Market, plan: Plan, billing: string, plusTerm: string): number {
  const d = dataFor(market);
  if (plan === "plus") return plusTerm === "1" ? d.plus1 : d.plus3;
  return billing === "yearly" ? d.yearly[plan] : d.monthly[plan];
}

type Channel = "online" | "inperson" | "manual" | "interac";
type Card = "standard" | "premium" | "international" | "paypal";

function channelOf(inputs: Inputs, d: MarketData): Channel {
  const c = str(inputs, "channel", "online") as Channel;
  if (c === "manual" && d.manual) return c;
  if (c === "interac" && d.interac) return c;
  return c === "inperson" ? c : "online";
}

function cardOf(inputs: Inputs, d: MarketData): Card {
  const c = str(inputs, "card", "standard") as Card;
  if (c === "paypal") return d.paypal ? c : "standard";
  return c === "premium" || c === "international" ? c : "standard";
}

/** "$100,000" / "$39": whole units for prices and thresholds Shopify quotes without cents. */
const whole = (cents: number, market: Market) => formatMoney(cents, market.currency, market.locale, { whole: cents % 100 === 0 });

const rateText = (r: Rate, money: (c: number) => string) => (r.fixed ? `${formatRate(r.pct)} + ${money(r.fixed)}` : formatRate(r.pct));

/** Amounts of one order in cents, shared by `calculate` and `breakpoints`. */
function orderAmounts(inputs: Inputs, market: Market, priceCents: number) {
  const discountPct = Math.min(100, Math.max(0, num(inputs, "discount")));
  const items = priceCents - pct(priceCents, discountPct);
  const shipping = toCents(num(inputs, "shippingCharged"));
  const taxRate = market.id === "us" || market.id === "ca" ? Math.max(0, num(inputs, "salesTax")) : 0;
  const tax = pct(items + shipping, taxRate);
  const gross = items + shipping + tax;
  const gift = Math.min(gross, toCents(num(inputs, "giftCard")));
  return { items, shipping, tax, gross, gift, card: gross - gift };
}

function calculate(inputs: Inputs, market: Market) {
  const money = moneyFor(market);
  const d = dataFor(market);
  const pricing = PRICING_SOURCE[market.id] ?? S.pricing;
  const plan = planOf(inputs);
  const { items, shipping, tax, gross, gift, card } = orderAmounts(inputs, market, toCents(num(inputs, "price")));
  const saleAmount = items + shipping;
  const viaShopify = str(inputs, "provider", "shopify") !== "other";
  const fees: Line[] = [];
  const notes: string[] = [];
  const warnings: string[] = [];

  // Plan subscription, spread over the month's orders.
  const orders = Math.max(0, Math.round(num(inputs, "ordersPerMonth")));
  const billing = str(inputs, "billing", "monthly");
  const plusTerm = str(inputs, "plusTerm", "3");
  const monthly = planMonthly(market, plan, billing, plusTerm);
  if (orders > 0) {
    const period = plan === "plus" ? (plusTerm === "1" ? "1-year term" : "3-year term") : billing === "yearly" ? "billed yearly" : "billed monthly";
    fees.push({
      id: "plan",
      label: `${PLAN_NAME[plan]} plan, per order`,
      amount: Math.round(monthly / orders),
      kind: "subscription",
      detail: `${whole(monthly, market)}/month (${period}) ÷ ${orders} order${orders > 1 ? "s" : ""}`,
      explain:
        plan === "plus"
          ? "Shopify Plus is a flat monthly platform fee (lower on a 3-year term), not a per-sale fee. We split it across your orders so you can see what it costs per sale; set your order count under More options."
          : "Your plan is a flat monthly fee, not a per-sale fee. We split it across a month’s orders so you can see what it costs per sale; set your order count and billing under More options. Yearly billing is charged upfront for 12 months.",
      source: plan === "plus" ? S.plus : pricing,
    });
    const apps = toCents(num(inputs, "appsMonthly"));
    if (apps) {
      fees.push({
        id: "apps",
        label: "Apps & other subscriptions, per order",
        amount: Math.round(apps / orders),
        kind: "subscription",
        detail: `${whole(apps, market)}/month ÷ ${orders} order${orders > 1 ? "s" : ""}`,
        explain: "Monthly app, theme and other subscriptions you entered, split across a month’s orders.",
      });
    }
  }

  // Gift card / store credit: Shopify's transaction fee on that part (stores created from 2025-05-12).
  const tpRate = THIRD_PARTY[plan];
  if (gift > 0) {
    const oldStore = bool(inputs, "oldStore");
    fees.push({
      id: "giftcard",
      label: "Transaction fee: gift card / store credit",
      amount: oldStore ? 0 : pct(gift, tpRate),
      kind: "platform",
      detail: oldStore ? "Store opened before May 12, 2025: not charged" : `${formatRate(tpRate)} × ${money(gift)}`,
      explain: `Stores opened on or after May 12, 2025 pay Shopify’s transaction fee (${formatRate(tpRate)} on ${PLAN_NAME[plan]}) on the part of an order paid with a gift card or store credit, even on Shopify Payments. Card fees only apply to the rest.`,
      source: S.thirdParty,
    });
  }

  if (viaShopify) {
    const channel = channelOf(inputs, d);
    const cardType = channel === "online" ? cardOf(inputs, d) : "standard";
    let rate: Rate;
    let detailRate: string;
    let explain: string;
    let source: string = pricing;
    const std = d.online[plan];
    if (channel === "inperson") {
      rate = d.inPerson[plan];
      detailRate = formatRate(rate.pct);
      explain = `Tap, chip and swipe payments through Shopify POS, Tap to Pay or a Shopify card reader cost ${rateText(rate, money)} on ${PLAN_NAME[plan]}. POS Pro, if you need it, is a separate ${whole(d.posPro, market)} a month per location.`;
    } else if (channel === "manual" && d.manual) {
      rate = d.manual[plan];
      detailRate = formatRate(rate.pct);
      explain = `Card numbers you type in yourself (draft orders, phone orders or POS) cost ${rateText(rate, money)} on ${PLAN_NAME[plan]}, because keyed-in payments carry more fraud risk.`;
    } else if (channel === "interac" && d.interac) {
      rate = d.interac[plan];
      detailRate = formatRate(rate.pct);
      explain = `Interac debit payments in person cost a flat ${money(rate.fixed)} on ${PLAN_NAME[plan]}, with no percentage.`;
    } else if (cardType === "paypal" && d.paypal) {
      rate = d.paypal;
      detailRate = formatRate(rate.pct);
      explain = `PayPal through Shopify Payments costs from ${rateText(rate, money)} on every plan. Shopify lists it as a starting rate, so your admin may show more.`;
    } else if (cardType === "premium") {
      rate = d.premium[plan];
      detailRate = formatRate(rate.pct);
      explain =
        market.id === "us"
          ? `Business, corporate and commercial cards, and every US-issued American Express card, are “premium” cards: ${rateText(rate, money)} on ${PLAN_NAME[plan]} instead of ${rateText(std, money)} for a personal card.`
          : `American Express cards cost ${rateText(rate, money)} on ${PLAN_NAME[plan]} instead of ${rateText(std, money)}.`;
      if (market.id === "us") source = S.cardTypes;
    } else if (cardType === "international") {
      if (d.intl) {
        rate = d.intl[plan];
        detailRate = formatRate(rate.pct);
        explain = `Cards issued outside ${d.country} cost ${rateText(rate, money)} on ${PLAN_NAME[plan]} instead of ${rateText(std, money)}.`;
      } else {
        const extra = d.intlSurcharge ?? 0;
        rate = { pct: std.pct + extra, fixed: std.fixed };
        detailRate = `(${formatRate(std.pct)} + ${formatRate(extra)})`;
        explain = `Cards issued outside ${d.country} pay your plan’s rate plus a ${formatRate(extra)} cross-border fee.`;
        source = S.intlCards;
      }
    } else {
      rate = std;
      detailRate = formatRate(rate.pct);
      explain =
        market.id === "us"
          ? `${rateText(rate, money)} on ${PLAN_NAME[plan]} for a personal Visa, Mastercard, Discover or Diners Club card issued in the US.`
          : `${rateText(rate, money)} on ${PLAN_NAME[plan]} for a card issued in ${d.country}.`;
    }
    const processing = card > 0 ? pct(card, rate.pct) + rate.fixed : 0;
    fees.push({
      id: "processing",
      label: "Shopify Payments processing",
      amount: processing,
      kind: "payment",
      detail: card <= 0 ? "Nothing charged to a card" : rate.pct === 0 ? `${money(rate.fixed)} flat` : `${detailRate} × ${money(card)}${rate.fixed ? ` + ${money(rate.fixed)}` : ""}`,
      explain: `Charged per order on everything the customer pays: products, shipping${market.id === "us" || market.id === "ca" ? " and the sales tax you collect" : " and tax"}. ${explain} Not returned if you refund.`,
      source,
    });

    let fx = 0;
    if (channel === "online" && bool(inputs, "currencyConversion") && card > 0) {
      const fxRate = cardType === "paypal" && d.fxPaypal ? d.fxPaypal : d.fx;
      fx = pct(card, fxRate);
      fees.push({
        id: "fx",
        label: "Currency conversion",
        amount: fx,
        kind: "payment",
        detail: `${formatRate(fxRate)} × ${money(card)}`,
        explain: `Charged when the customer pays in a currency other than your payout currency: ${formatRate(fxRate)} of the whole order since April 6, 2026${market.id === "us" ? "" : " (Shopify’s help center lists 2% for stores outside the US; its international pricing page says 1.5%)"}. With automatic exchange rates Shopify builds it into the converted price the customer sees.`,
        source: S.fx,
      });
    }

    if (d.taxOnFees && processing > 0) {
      fees.push({
        id: "gst",
        label: `${d.taxOnFees.name} on processing fee`,
        amount: pct(processing, d.taxOnFees.rate),
        kind: "tax",
        detail: `${formatRate(d.taxOnFees.rate)} × ${money(processing)}`,
        explain: `Shopify adds ${d.taxOnFees.name} to Shopify Payments processing fees for Australian businesses. ${formatRate(d.taxOnFees.rate)} is Australia’s ${d.taxOnFees.name} rate; registered businesses can usually claim it back.`,
        source: S.payoutFees,
      });
    }

    if (card > 0 && card < d.minCharge) warnings.push(`Shopify Payments can’t charge less than ${money(d.minCharge)} to a card.`);
    if (channel === "online" && cardType === "standard") {
      notes.push(
        market.id === "us"
          ? `A business card or American Express costs ${rateText(d.premium[plan], money)} instead, and a card from outside the US adds 1%. Switch “How did the customer pay?” to see it.`
          : `American Express costs ${rateText(d.premium[plan], money)} and a card from outside ${d.country} ${rateText(d.intl![plan], money)} instead.`,
      );
    }
  } else {
    // Another provider takes the card payment.
    const paypalExempt = bool(inputs, "paypalExempt");
    const tpBase = card;
    fees.push({
      id: "transaction",
      label: `Shopify transaction fee (${formatRate(tpRate)})`,
      amount: paypalExempt ? 0 : pct(tpBase, tpRate),
      kind: "platform",
      detail: paypalExempt ? "PayPal with Shopify Payments as main provider: not charged" : `${formatRate(tpRate)} × ${money(tpBase)}`,
      explain: paypalExempt
        ? "PayPal payments aren’t charged Shopify’s transaction fee when Shopify Payments is your main payment provider."
        : `Because another provider takes the payment, Shopify charges ${formatRate(tpRate)} on ${PLAN_NAME[plan]}, on products after discounts plus tax plus shipping. It’s added to your Shopify bill every 30 days and isn’t returned if you refund. Shopify Payments doesn’t charge it.`,
      source: S.thirdParty,
    });
    const pRate = Math.max(0, num(inputs, "providerRate"));
    const pFixed = toCents(num(inputs, "providerFixed"));
    fees.push({
      id: "provider",
      label: "Payment provider’s fee",
      amount: card > 0 ? pct(card, pRate) + pFixed : 0,
      kind: "payment",
      detail: card > 0 ? `${formatRate(pRate)} × ${money(card)}${pFixed ? ` + ${money(pFixed)}` : ""}` : "Nothing charged to a card",
      explain: "Your own provider’s fee (Stripe, PayPal, Authorize.net…) as you entered it, on the full amount the customer pays. Shopify doesn’t set it; check your provider’s price list.",
    });
    notes.push(
      `Shopify’s ${formatRate(tpRate)} transaction fee comes on top of your provider’s fee. On Shopify Payments it doesn’t apply, and the card fee would be ${rateText(d.online[plan], money)}.`,
    );
  }

  if (d.shopifyTax && bool(inputs, "shopifyTax")) {
    const st = d.shopifyTax;
    const rate = plan === "plus" ? st.plus : st.nonPlus;
    const raw = pct(gross, rate);
    const capped = raw > st.cap;
    fees.push({
      id: "shopifytax",
      label: "Shopify Tax calculation fee",
      amount: capped ? st.cap : raw,
      kind: "platform",
      detail: capped ? `${formatRate(rate)} would be ${money(raw)}, capped at ${money(st.cap)}` : `${formatRate(rate)} × ${money(gross)}`,
      explain: `Once your store passes ${whole(st.threshold, market)} in sales, Shopify Tax charges ${formatRate(rate)} on orders to places where you collect tax, up to ${money(st.cap)} per order. It’s added to your Shopify bill.`,
      source: S.tax,
    });
  }

  const ads = toCents(num(inputs, "adCost"));
  if (ads) {
    fees.push({
      id: "ads",
      label: "Ads, per order",
      amount: ads,
      kind: "ads",
      detail: "What your ads cost per order",
      explain: "Shopify doesn’t send shoppers to your store, so most stores pay for traffic: search, social or marketplace ads. Enter your average ad cost per order.",
    });
  }

  if (market.id === "us" || market.id === "ca") {
    if (tax > 0) notes.unshift(`The customer also pays ${money(tax)} of tax, which reaches you with the payment and goes to the tax authority. It still counts toward the card fee; we leave it out of what you keep.`);
    else notes.unshift("Card fees are also charged on the sales tax you collect. Add the tax rate under “More options” for the exact figure.");
  }

  return assemble({
    market,
    buyerPays: gross,
    saleAmount,
    fees,
    costs: costLines(inputs, market),
    notes: notes.slice(0, 2),
    warnings,
  });
}

function schedule(market: Market): ScheduleRow[] {
  const money = moneyFor(market);
  const d = dataFor(market);
  const pricing = PRICING_SOURCE[market.id] ?? S.pricing;
  const fixedOf = (r: ByPlan) => {
    const vals = Array.from(new Set(PLANS.map((p) => r[p].fixed)));
    return vals.length === 1 ? (vals[0] ? ` + ${money(vals[0])}` : "") : ` + ${PLANS.map((p) => money(r[p].fixed)).join(" / ")}`;
  };
  const tiers = (r: ByPlan) => `${PLANS.map((p) => formatRate(r[p].pct)).join(" / ")}${fixedOf(r)}`;
  const byPlanNote = "Basic / Grow / Advanced / Plus";
  const rows: ScheduleRow[] = [
    {
      fee: "Plan (billed monthly)",
      amount: `${whole(d.monthly.basic, market)} / ${whole(d.monthly.grow, market)} / ${whole(d.monthly.advanced, market)} a month`,
      appliesTo: "Basic / Grow / Advanced, per store",
      when: "Every month",
      source: pricing,
    },
    {
      fee: "Plan (billed yearly)",
      amount: `${whole(d.yearly.basic, market)} / ${whole(d.yearly.grow, market)} / ${whole(d.yearly.advanced, market)} a month`,
      appliesTo: "Basic / Grow / Advanced, charged for 12 months upfront",
      when: "Every year",
      source: pricing,
    },
    { fee: "Shopify Plus", amount: `${whole(d.plus3, market)} a month (3-year term), ${whole(d.plus1, market)} (1-year)`, appliesTo: "Standard setups; complex, higher-volume brands may pay a variable platform fee", when: "Every month", source: S.plus },
    { fee: "Online card payments", amount: tiers(d.online), appliesTo: "Everything the customer pays: products, shipping and tax", when: `${market.id === "us" ? "Personal US cards" : `Cards issued in ${d.country}`} (${byPlanNote})`, source: pricing },
    {
      fee: market.id === "us" ? "Premium cards" : "American Express",
      amount: tiers(d.premium),
      appliesTo: "Everything the customer pays",
      when: market.id === "us" ? "US business/corporate cards and all US American Express" : byPlanNote,
      source: market.id === "us" ? S.cardTypes : pricing,
    },
    {
      fee: "International cards",
      amount: d.intl ? tiers(d.intl) : `+${formatRate(d.intlSurcharge ?? 0)} on top of the rate`,
      appliesTo: "Everything the customer pays",
      when: `Card issued outside ${d.country}`,
      source: d.intl ? pricing : S.intlCards,
    },
  ];
  if (d.paypal) rows.push({ fee: "PayPal (through Shopify Payments)", amount: `from ${rateText(d.paypal, money)}`, appliesTo: "Everything the customer pays", when: "Every plan", source: pricing });
  rows.push({ fee: "In-person card payments", amount: tiers(d.inPerson), appliesTo: "The amount charged", when: `POS, Tap to Pay, card readers (${byPlanNote})`, source: pricing });
  if (d.manual) rows.push({ fee: "Keyed-in card payments", amount: tiers(d.manual), appliesTo: "The amount charged", when: "Draft orders or POS manual entry", source: pricing });
  if (d.interac) rows.push({ fee: "Interac (in person)", amount: `${PLANS.map((p) => money(d.interac![p].fixed)).join(" / ")} flat`, appliesTo: "Each payment", when: byPlanNote, source: pricing });
  rows.push(
    {
      fee: "Third-party transaction fee",
      amount: PLANS.map((p) => formatRate(THIRD_PARTY[p])).join(" / "),
      appliesTo: "(Products − discounts) + tax + shipping",
      when: "Another provider takes the payment; billed every 30 days",
      source: S.thirdParty,
    },
    { fee: "Gift card / store credit", amount: PLANS.map((p) => formatRate(THIRD_PARTY[p])).join(" / "), appliesTo: "The part paid with gift cards or store credit", when: "Stores opened on or after May 12, 2025", source: S.thirdParty },
    { fee: "Shopify Payments next to another provider", amount: "Standard rate + 1.25%", appliesTo: "Shop Pay and other payments Shopify Payments handles", when: "Another provider is your main card processor", source: S.withThirdParty },
    { fee: "Currency conversion", amount: formatRate(d.fx) + (d.fxPaypal ? ` (PayPal ${formatRate(d.fxPaypal)})` : ""), appliesTo: "The gross order amount", when: "Customer pays in another currency", source: S.fx },
  );
  if (d.taxOnFees) rows.push({ fee: `${d.taxOnFees.name} on processing fees`, amount: `${formatRate(d.taxOnFees.rate)} (${d.taxOnFees.name} rate)`, appliesTo: "Shopify Payments processing fees", when: "Businesses in Australia", source: S.payoutFees });
  rows.push(
    {
      fee: "Multi-currency payouts",
      amount: market.id === "us" ? "1% (Plus 0.75%)" : market.id === "ca" ? "1.5% (Plus 1.25%)" : "1.5% (Plus 1%)",
      appliesTo: "Payouts to a bank account in another currency",
      when: "Advanced and Plus only",
      source: S.multiCurrency,
    },
  );
  if (market.id === "ca") rows.push({ fee: "USD default payout", amount: "1.5%", appliesTo: "The payout", when: "Basic or Grow with USD as default payout currency", source: S.multiCurrency });
  rows.push(
    { fee: "Chargeback", amount: whole(d.chargeback, market) + (market.id === "ca" ? " (or US$15)" : ""), appliesTo: "Each disputed payment", when: "Returned if you win the dispute", source: S.chargeback },
    { fee: "Refunds", amount: "Fees kept", appliesTo: "Card, conversion and transaction fees", when: "Any refund; no extra fee for refunding", source: S.refunds },
  );
  if (d.shopifyTax)
    rows.push({
      fee: "Shopify Tax",
      amount: `${formatRate(d.shopifyTax.nonPlus)} (Plus ${formatRate(d.shopifyTax.plus)}), max ${money(d.shopifyTax.cap)} per order`,
      appliesTo: "Orders where you collect tax",
      when: `After ${whole(d.shopifyTax.threshold, market)} in sales`,
      source: S.tax,
    });
  rows.push({ fee: "POS Pro", amount: `${whole(d.posPro, market)} a month per location`, appliesTo: "Each store location", when: "Optional (Plus includes 20)", source: pricing });
  return rows;
}

const cardOptions = (_i: Inputs, market: Market): SelectOption[] => {
  const d = dataFor(market);
  const money = moneyFor(market);
  const plan = planOf(_i);
  const opts: SelectOption[] = [
    { value: "standard", label: market.id === "us" ? "Personal card from the US" : `Card from ${d.country}`, hint: rateText(d.online[plan], money) },
    { value: "premium", label: d.premiumLabel, hint: rateText(d.premium[plan], money) },
    {
      value: "international",
      label: `Card from outside ${d.country}`,
      hint: d.intl ? rateText(d.intl[plan], money) : rateText({ pct: d.online[plan].pct + (d.intlSurcharge ?? 0), fixed: d.online[plan].fixed }, money),
    },
  ];
  if (d.paypal) opts.push({ value: "paypal", label: "PayPal", hint: `from ${rateText(d.paypal, money)}` });
  return opts;
};

const channelOptions = (_i: Inputs, market: Market): SelectOption[] => {
  const d = dataFor(market);
  const opts: SelectOption[] = [
    { value: "online", label: "Online checkout" },
    { value: "inperson", label: "In person: tap, chip or swipe" },
  ];
  if (d.manual) opts.push({ value: "manual", label: "Card number typed in (phone / draft order)" });
  if (d.interac) opts.push({ value: "interac", label: "In person: Interac debit" });
  return opts;
};

const planOptions = (inputs: Inputs, market: Market): SelectOption[] => {
  const d = dataFor(market);
  const money = moneyFor(market);
  const yearly = str(inputs, "billing", "monthly") === "yearly";
  return PLANS.map((p) => ({
    value: p,
    label: PLAN_NAME[p],
    hint:
      p === "plus"
        ? `from ${whole(d.plus3, market)}/mo · ${rateText(d.online.plus, money)}`
        : `${whole(yearly ? d.yearly[p] : d.monthly[p], market)}/mo · ${rateText(d.online[p], money)}`,
  }));
};

const usesShopifyPayments = (i: Inputs) => str(i, "provider", "shopify") !== "other";

export const shopify: CalculatorDef = {
  slug: "shopify",
  name: "Shopify",
  path: "/shopify-fee-calculator",
  category: "marketplaces",
  priceNoun: "product price",
  sellerNoun: "merchant",
  blurb: "2.9% + 30¢ online on Basic ($39/mo), +2% if you use another provider (US)",
  markets: MARKETS,
  defaultMarket: "us",
  priceField: "price",
  fields: [
    { id: "price", kind: "money", label: "Product price", section: "sale", help: "What the products in the order sell for, before shipping and tax. For several items, enter their total." },
    { id: "discount", kind: "percent", label: "Discount code", section: "sale", advanced: true, max: 100, help: "Fees are charged on the discounted price." },
    {
      id: "salesTax",
      kind: "percent",
      label: "Sales tax you charge",
      section: "sale",
      advanced: true,
      max: 20,
      help: "On products and shipping. You pass it on to the government, but the card fee is charged on it too. In Canada: GST/HST plus any PST.",
      showIf: (_i, m) => m.id === "us" || m.id === "ca",
    },
    { id: "giftCard", kind: "money", label: "Paid with a gift card or store credit", section: "sale", advanced: true, help: "Newer stores pay Shopify’s transaction fee on this part, even on Shopify Payments." },
    { id: "oldStore", kind: "toggle", label: "My store opened before May 12, 2025", section: "sale", advanced: true, help: "Older stores aren’t charged on gift card and store credit payments.", showIf: (i) => num(i, "giftCard") > 0 },
    { id: "shippingCharged", kind: "money", label: "Shipping the customer pays", section: "shipping", help: "Card fees are charged on shipping too, so free shipping built into the price costs the same." },
    { id: "plan", kind: "select", label: "Your Shopify plan", section: "options", options: planOptions, help: "Higher plans cost more a month but take a lower card rate." },
    {
      id: "provider",
      kind: "segmented",
      label: "Who processes the payment?",
      section: "options",
      options: [
        { value: "shopify", label: "Shopify Payments" },
        { value: "other", label: "Another provider" },
      ],
      help: "With another provider (Stripe, PayPal, Authorize.net…) Shopify adds its own transaction fee.",
    },
    {
      id: "card",
      kind: "select",
      label: "How did the customer pay?",
      section: "options",
      options: cardOptions,
      help: "Business cards, American Express and foreign cards cost more. Shop Pay is charged like the card behind it.",
      showIf: (i) => usesShopifyPayments(i) && (str(i, "channel", "online") === "online"),
    },
    { id: "providerRate", kind: "percent", label: "Your provider’s rate", section: "options", max: 10, step: 0.01, help: "The percentage your payment provider charges per payment.", showIf: (i) => !usesShopifyPayments(i) },
    { id: "providerFixed", kind: "money", label: "Your provider’s fixed fee", section: "options", help: "The fixed amount per payment, if any.", showIf: (i) => !usesShopifyPayments(i) },
    {
      id: "billing",
      kind: "segmented",
      label: "How do you pay for the plan?",
      section: "options",
      advanced: true,
      options: [
        { value: "monthly", label: "Monthly" },
        { value: "yearly", label: "Yearly" },
      ],
      help: "Yearly billing lowers the monthly price but is charged 12 months upfront.",
      showIf: (i) => planOf(i) !== "plus",
    },
    {
      id: "plusTerm",
      kind: "segmented",
      label: "Shopify Plus term",
      section: "options",
      advanced: true,
      options: [
        { value: "3", label: "3-year term" },
        { value: "1", label: "1-year term" },
      ],
      showIf: (i) => planOf(i) === "plus",
    },
    {
      id: "ordersPerMonth",
      kind: "number",
      label: "Orders per month",
      section: "options",
      advanced: true,
      integer: true,
      min: 0,
      max: 1000000,
      unit: "orders",
      help: "We split your plan fee across these orders. Set 0 to leave the plan out.",
    },
    { id: "channel", kind: "select", label: "Where was the sale made?", section: "options", advanced: true, options: channelOptions, help: "In-person payments cost less than online ones.", showIf: usesShopifyPayments },
    {
      id: "currencyConversion",
      kind: "toggle",
      label: "Customer paid in another currency",
      section: "options",
      advanced: true,
      help: "Shopify charges a conversion fee on the whole order. Enter the amounts in your own currency.",
      showIf: (i) => usesShopifyPayments(i) && str(i, "channel", "online") === "online",
    },
    {
      id: "paypalExempt",
      kind: "toggle",
      label: "It’s PayPal, and Shopify Payments is my main provider",
      section: "options",
      advanced: true,
      help: "Then Shopify doesn’t charge its transaction fee on the PayPal payment.",
      showIf: (i) => !usesShopifyPayments(i),
    },
    {
      id: "shopifyTax",
      kind: "toggle",
      label: "I use Shopify Tax and my store is past the free threshold",
      section: "options",
      advanced: true,
      help: "Free until your store reaches 100,000 in sales, then a small fee per taxed order.",
      showIf: (_i, m) => Boolean(dataFor(m).shopifyTax),
    },
    { id: "appsMonthly", kind: "money", label: "Apps & other monthly subscriptions", section: "options", advanced: true, help: "Split across your orders like the plan fee." },
    { id: "adCost", kind: "money", label: "Ad cost per order", section: "options", advanced: true, help: "Shopify doesn’t bring you buyers: what your ads cost per order, on average." },
    { id: "itemCost", kind: "money", label: "What the products cost you", section: "costs", help: "Materials, wholesale or manufacturing cost." },
    { id: "shippingCost", kind: "money", label: "Postage / label you pay", section: "costs" },
    { id: "otherCost", kind: "money", label: "Packaging & other", section: "costs" },
  ],
  defaults: () => ({
    price: 50,
    discount: 0,
    salesTax: 0,
    giftCard: 0,
    oldStore: false,
    shippingCharged: 5,
    plan: "basic",
    provider: "shopify",
    card: "standard",
    providerRate: 2.9,
    providerFixed: 0.3,
    billing: "monthly",
    plusTerm: "3",
    ordersPerMonth: 100,
    channel: "online",
    currencyConversion: false,
    paypalExempt: false,
    shopifyTax: false,
    appsMonthly: 0,
    adCost: 0,
    itemCost: 0,
    shippingCost: 0,
    otherCost: 0,
  }),
  calculate,
  breakpoints: (inputs, market) => {
    // Card fees (with their fixed part) start only once the order is more than the gift card
    // covers, so the payout drops at that price. Find the first price where a card is charged.
    if (toCents(num(inputs, "giftCard")) <= 0) return [];
    const charged = (p: number) => orderAmounts(inputs, market, p).card > 0;
    let lo = 0;
    let hi = 100_000_000;
    if (!charged(hi)) return [];
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (charged(mid)) hi = mid;
      else lo = mid + 1;
    }
    return [lo];
  },
  verifiedAt: "2026-10-23",
  sources,
  changes,
  schedule,
  compare: {
    group: "sell",
    map: (c) => ({ price: c.price, shippingCharged: c.shipping, itemCost: c.itemCost, shippingCost: c.shippingCost }),
    note: "Basic plan billed monthly over 100 orders, Shopify Payments, US card; you bring your own traffic",
  },
};

export default shopify;
