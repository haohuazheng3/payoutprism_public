/*
 * Swappa (US only) seller fees. Every number is from Swappa's own pages (see `sources`), re-read
 * and verified against the live pages on 2026-10-23. Research notes with verbatim quotes:
 * research/fees/swappa.md.
 *
 * How a sale settles (what this module reproduces):
 *  - The seller sets an Ask Price (A), with standard shipping built in: Swappa listings ship free
 *    and "Shipping costs are paid by the seller".
 *  - Buyer fee: 3% of A, added to make the Listing Price the buyer pays: L = A + 3% × A
 *    ("a $100 Ask Price will have a $103 listing price"). Shown in `buyerFees`, never deducted.
 *  - Sales tax: Swappa collects it as a marketplace facilitator for buyers in 46 states + DC, on the
 *    listing price ("Sales tax (8% of $309)"). Pass-through, also in `buyerFees`.
 *  - Seller fee: 3% of A (not of L, not of the payment total). On PayPal orders it sits inside the
 *    "Partner Fee" together with the buyer fee and the tax.
 *  - Payment processing on the payment total T = L + tax ("PayPal/Stripe take their standard
 *    transaction fees on the payment total"): PayPal 3.49% + $0.49; Stripe 2.9% + $0.30 (card
 *    checkout, Power and Enterprise sellers only). A buyer paying from a non-US PayPal account adds
 *    PayPal's 1.50% international fee, which Swappa says the buyer must pay back to the seller.
 *  - Featured listing: $5 per listing, paid up front, non-refundable.
 *  Payout = A − seller fee − processing (− Featured).
 *
 * Rounding: Swappa doesn't document it; every official example reproduces with each line rounded
 * half up to the cent. PayPal charges a non-US payer's fee as one amount (3.49% + 1.50% = 4.99% of
 * the total, + $0.49), rounded once, so it is one line here (Swappa-confirmed sale SZMK57478: $37.96 =
 * 4.99% × $750.87 + $0.49). The 1.50% share the buyer must pay back is that fee minus the domestic one.
 * The amount charged is the exact-cent listing price (Swappa-confirmed sale: Ask $729 → $750.87);
 * listing pages display it rounded UP to a whole dollar (checked on 50 of 50 live listings).
 */
import { M } from "../markets";
import { assemble, bool, costLines, formatRate, moneyFor, num, pct, str, toCents } from "../money";
import type { CalculatorDef, FeeChange, Inputs, Line, Market, ScheduleRow, SelectOption, Source } from "../types";

/** Swappa seller fee and buyer fee, % of the Ask Price. */
export const SELLER_RATE = 3;
export const BUYER_RATE = 3;
/** PayPal (domestic payer): 3.49% + $0.49 of the payment total. */
export const PAYPAL = { rate: 3.49, fixed: 49 } as const;
/** PayPal's extra fee when the buyer pays from a non-US PayPal account (on top of 3.49%). */
export const PAYPAL_INTL_RATE = 1.5;
/** Stripe card checkout (Power and Enterprise sellers): 2.9% + $0.30 of the payment total. */
export const STRIPE = { rate: 2.9, fixed: 30 } as const;
/** Featured listing, cents per listing. */
export const FEATURED = 500;

/**
 * Swappa's published average combined sales tax rate by state (Taxes on Swappa, "State Sales Tax
 * Rates for Swappa Sales", Avg Rate column, converted from decimals to %). Reference only: the exact
 * rate depends on the buyer's shipping address. DE, MT, NH and OR are not on the list (no tax).
 */
export const STATE_TAX: Record<string, { name: string; avg: number }> = {
  AK: { name: "Alaska", avg: 1.54 },
  AL: { name: "Alabama", avg: 8.36 },
  AR: { name: "Arkansas", avg: 8.57 },
  AZ: { name: "Arizona", avg: 7.87 },
  CA: { name: "California", avg: 8.26 },
  CO: { name: "Colorado", avg: 6.47 },
  CT: { name: "Connecticut", avg: 6.35 },
  DC: { name: "District of Columbia", avg: 5.75 },
  FL: { name: "Florida", avg: 6.82 },
  GA: { name: "Georgia", avg: 7.33 },
  HI: { name: "Hawaii", avg: 4.24 },
  IA: { name: "Iowa", avg: 6.89 },
  ID: { name: "Idaho", avg: 6.04 },
  IL: { name: "Illinois", avg: 7.5 },
  IN: { name: "Indiana", avg: 7 },
  KS: { name: "Kansas", avg: 8.05 },
  KY: { name: "Kentucky", avg: 6 },
  LA: { name: "Louisiana", avg: 9.58 },
  MA: { name: "Massachusetts", avg: 6.25 },
  MD: { name: "Maryland", avg: 6 },
  ME: { name: "Maine", avg: 5.5 },
  MI: { name: "Michigan", avg: 6 },
  MN: { name: "Minnesota", avg: 7.18 },
  MO: { name: "Missouri", avg: 7.28 },
  MS: { name: "Mississippi", avg: 7.02 },
  NC: { name: "North Carolina", avg: 6.9 },
  ND: { name: "North Dakota", avg: 5.51 },
  NE: { name: "Nebraska", avg: 5.86 },
  NJ: { name: "New Jersey", avg: 6.63 },
  NM: { name: "New Mexico", avg: 7.03 },
  NV: { name: "Nevada", avg: 7.78 },
  NY: { name: "New York", avg: 8.19 },
  OH: { name: "Ohio", avg: 7.1 },
  OK: { name: "Oklahoma", avg: 7.86 },
  PA: { name: "Pennsylvania", avg: 6.1 },
  RI: { name: "Rhode Island", avg: 7 },
  SC: { name: "South Carolina", avg: 7.36 },
  SD: { name: "South Dakota", avg: 5.6 },
  TN: { name: "Tennessee", avg: 9.5 },
  TX: { name: "Texas", avg: 7.44 },
  UT: { name: "Utah", avg: 6.61 },
  VA: { name: "Virginia", avg: 5.46 },
  VT: { name: "Vermont", avg: 6.04 },
  WA: { name: "Washington", avg: 8.76 },
  WI: { name: "Wisconsin", avg: 5.46 },
  WV: { name: "West Virginia", avg: 6.1 },
  WY: { name: "Wyoming", avg: 5.29 },
};

const STATE_OPTIONS: SelectOption[] = [
  { value: "none", label: "No sales tax state", hint: "Delaware, Montana, New Hampshire, Oregon" },
  ...Object.entries(STATE_TAX)
    .sort((a, b) => a[1].name.localeCompare(b[1].name))
    .map(([code, s]) => ({ value: code, label: s.name, hint: `avg ${formatRate(s.avg)}` })),
  { value: "custom", label: "I know the exact rate", hint: "Type it below" },
];

const S = {
  fees: "swappa-fees",
  saleFee: "swappa-sale-fee",
  partner: "swappa-partner-fee",
  ask: "swappa-ask-price",
  shipping: "swappa-shipping",
  taxes: "swappa-taxes",
  featured: "swappa-featured",
  stripe: "swappa-stripe",
  intl: "swappa-international",
  intlFaq: "swappa-buy-international",
  partnerBlog: "swappa-partner-fee-blog",
  refunds: "swappa-refunds",
  payouts: "swappa-payouts",
  sellers: "swappa-sellers",
  policies: "swappa-policies",
  payment: "swappa-payment-options",
  sellingFees: "swappa-selling-fees-blog",
  taxBlog: "swappa-sales-tax-blog",
} as const;

const sources: Source[] = [
  { id: S.fees, title: "Fair Fees", url: "https://swappa.com/about/fees", publisher: "Swappa", checked: "2026-10-23" },
  { id: S.saleFee, title: "How do fees work on Swappa?", url: "https://swappa.com/faq/answer/sale-fee", publisher: "Swappa", checked: "2026-10-23" },
  { id: S.partner, title: "What is a PayPal Partner Fee?", url: "https://swappa.com/faq/answer/partner-fee", publisher: "Swappa", checked: "2026-10-23" },
  { id: S.ask, title: "What is an Ask Price?", url: "https://swappa.com/faq/answer/ask-price", publisher: "Swappa", checked: "2026-10-23" },
  { id: S.shipping, title: "Who covers the cost of shipping?", url: "https://swappa.com/faq/answer/buyer-seller-shipping-costs", publisher: "Swappa", checked: "2026-10-23" },
  { id: S.taxes, title: "Taxes on Swappa", url: "https://swappa.com/about/taxes", publisher: "Swappa", checked: "2026-10-23" },
  { id: S.featured, title: "What's a featured listing?", url: "https://swappa.com/faq/answer/what-is-featured-listing", publisher: "Swappa", checked: "2026-10-23" },
  {
    id: S.stripe,
    title: "Stripe on Swappa: How Business Sellers Accept Cards",
    url: "https://swappa.com/blog/stripe-payments-available-for-power-and-enterprise-sellers/",
    publisher: "Swappa Blog",
    checked: "2026-10-23",
  },
  {
    id: S.intl,
    title: "Buying on Swappa From Outside the US: International Guide",
    url: "https://swappa.com/blog/international-sales-on-swappa/",
    publisher: "Swappa Blog",
    checked: "2026-10-23",
  },
  { id: S.intlFaq, title: "Can I buy or sell on Swappa if I'm located outside of the US?", url: "https://swappa.com/faq/answer/buy-international", publisher: "Swappa", checked: "2026-10-23" },
  { id: S.partnerBlog, title: "What Is the PayPal Partner Fee on Swappa?", url: "https://swappa.com/blog/what-is-a-paypal-partner-fee/", publisher: "Swappa Blog", checked: "2026-10-23" },
  { id: S.refunds, title: "Swappa Refunds: How Returns Work for Buyers and Sellers", url: "https://swappa.com/blog/swappa-refunds/", publisher: "Swappa Blog", checked: "2026-10-23" },
  { id: S.payouts, title: "How Sellers Get Paid: Marketplace Payouts Explained", url: "https://swappa.com/blog/how-sellers-get-paid-marketplace-payouts/", publisher: "Swappa Blog", checked: "2026-10-23" },
  { id: S.payment, title: "What payment methods are supported on Swappa?", url: "https://swappa.com/faq/answer/payment-options", publisher: "Swappa", checked: "2026-10-23" },
  {
    id: S.sellingFees,
    title: "Marketplace Selling Fees: What You Pay on Every Platform",
    url: "https://swappa.com/blog/marketplace-selling-fees/",
    publisher: "Swappa Blog",
    checked: "2026-10-23",
  },
  {
    id: S.taxBlog,
    title: "Sales Tax on Swappa: What Buyers and Sellers Should Know",
    url: "https://swappa.com/blog/marketplace-sales-tax-swappa/",
    publisher: "Swappa Blog",
    checked: "2026-10-23",
  },
  { id: S.sellers, title: "Seller Accounts", url: "https://swappa.com/about/sellers", publisher: "Swappa", checked: "2026-10-23" },
  { id: S.policies, title: "Swappa Marketplace Policies", url: "https://swappa.com/policies", publisher: "Swappa", checked: "2026-10-23" },
];

/*
 * No change to Swappa's own fees is published for the last three years and none is announced
 * (fee pages, FAQ, policies and blog checked 2026-10-23). The date Swappa moved to 3% seller + 3%
 * buyer is not on any page that still exists, so it isn't listed.
 */
const changes: FeeChange[] = [];

type Payment = "paypal" | "paypal-intl" | "stripe";

function payment(inputs: Inputs): Payment {
  const p = str(inputs, "payment", "paypal");
  return p === "stripe" || p === "paypal-intl" ? p : "paypal";
}

/** Sales tax rate (%) for the buyer: Swappa's state average, a typed exact rate, or 0. */
function taxRate(inputs: Inputs): { rate: number; label: string } {
  const st = str(inputs, "buyerState", "none");
  if (st === "custom") {
    const rate = Math.min(20, Math.max(0, num(inputs, "salesTax")));
    return { rate, label: "Sales tax" };
  }
  const s = STATE_TAX[st];
  return s ? { rate: s.avg, label: `Sales tax (${s.name} avg)` } : { rate: 0, label: "Sales tax" };
}

interface Core {
  ask: number;
  buyerFee: number;
  listing: number;
  tax: number;
  total: number;
  sellerFee: number;
  processing: number;
  /** The part of `processing` due to a non-US PayPal payer (PayPal's 1.50%), which the buyer must repay. */
  intlExtra: number;
  featured: number;
  payout: number;
}

/** The arithmetic alone (cents), shared by `calculate()` and the notes' "what if" figures. */
function core(ask: number, rate: number, pay: Payment, featured: boolean): Core {
  const buyerFee = pct(ask, BUYER_RATE);
  const listing = ask + buyerFee;
  const tax = pct(listing, rate);
  const total = listing + tax;
  const sellerFee = pct(ask, SELLER_RATE);
  let processing: number;
  let intlExtra = 0;
  if (pay === "stripe") {
    processing = pct(total, STRIPE.rate) + STRIPE.fixed;
  } else if (pay === "paypal-intl") {
    // One PayPal fee at the combined rate, rounded once; the 1.50% share is what the buyer must repay.
    processing = pct(total, PAYPAL.rate + PAYPAL_INTL_RATE) + PAYPAL.fixed;
    intlExtra = processing - (pct(total, PAYPAL.rate) + PAYPAL.fixed);
  } else {
    processing = pct(total, PAYPAL.rate) + PAYPAL.fixed;
  }
  const feat = featured ? FEATURED : 0;
  return { ask, buyerFee, listing, tax, total, sellerFee, processing, intlExtra, featured: feat, payout: ask - sellerFee - processing - feat };
}

function calculate(inputs: Inputs, market: Market) {
  const money = moneyFor(market);
  const ask = toCents(num(inputs, "ask"));
  const pay = payment(inputs);
  const { rate, label: taxLabel } = taxRate(inputs);
  const featured = bool(inputs, "featured");
  const c = core(ask, rate, pay, featured);
  const shown = Math.ceil(c.listing / 100) * 100; // listing pages round the price up to a whole dollar

  const fees: Line[] = [
    {
      id: "seller",
      label: "Swappa seller fee (3%)",
      amount: c.sellerFee,
      kind: "platform",
      detail: `3% × ${money(ask)} Ask price`,
      explain:
        "3% of your Ask price, charged only when it sells. It is not charged on the buyer’s 3% or on sales tax. On PayPal orders it is part of the “Partner Fee” line, along with the buyer’s fee and tax, which aren’t yours.",
      source: S.partner,
    },
  ];
  if (pay === "stripe") {
    fees.push({
      id: "processing",
      label: "Stripe card fee",
      amount: c.processing,
      kind: "payment",
      detail: `2.9% × ${money(c.total)} + $0.30`,
      explain:
        "Stripe takes 2.9% of everything the buyer pays (listing price plus sales tax) plus $0.30 per order. Card checkout through Stripe is only for Power and Enterprise sellers in good standing.",
      source: S.stripe,
    });
  } else if (pay === "paypal-intl") {
    fees.push({
      id: "processing",
      label: "PayPal fee (non-US buyer)",
      amount: c.processing,
      kind: "payment",
      detail: `4.99% × ${money(c.total)} + $0.49 (3.49% + 1.50% international)`,
      explain: `PayPal adds 1.50% to its 3.49% + $0.49 when the buyer pays from a non-US PayPal account, all charged on everything the buyer pays. Swappa requires the buyer to pay back the ${money(c.intlExtra)} difference before you ship.`,
      source: S.intl,
    });
  } else {
    fees.push({
      id: "processing",
      label: "PayPal fee",
      amount: c.processing,
      kind: "payment",
      detail: `3.49% × ${money(c.total)} + $0.49`,
      explain: `PayPal takes 3.49% of everything the buyer pays${c.tax ? " (listing price plus sales tax)" : ", including the buyer’s 3% and any sales tax,"} plus $0.49 per order. PayPal keeps it even if you refund the buyer in full.`,
      source: S.fees,
    });
  }
  if (c.featured) {
    fees.push({
      id: "featured",
      label: "Featured listing",
      amount: c.featured,
      kind: "ads",
      detail: "$5.00 per listing",
      explain: "An orange star and a spot at the top of the category page. Paid when you feature the listing, not taken from the sale, and not refundable.",
      source: S.featured,
    });
  }

  const buyerFees: Line[] = [
    {
      id: "buyer",
      label: "3% buyer fee",
      amount: c.buyerFee,
      kind: "platform",
      detail: `3% × ${money(ask)} · listing shows ${money(shown).replace(/\.00$/, "")}`,
      explain: `Added to your Ask price to make the listing price (${money(c.listing)}). Listing pages round it up to the next whole dollar. The buyer pays it; it never comes out of your payout.`,
      source: S.ask,
    },
    {
      id: "tax",
      label: `${taxLabel}${rate ? ` ${formatRate(rate)}` : ""}`,
      amount: c.tax,
      kind: "tax",
      detail: `${formatRate(rate)} × ${money(c.listing)}`,
      explain: "Swappa adds sales tax for buyers in 46 states and DC, on the listing price, and pays it to the state at no charge. It doesn’t come from you, but it raises the payment total the processing fee is charged on.",
      source: S.taxes,
    },
  ];

  const notes: string[] = [];
  if (c.intlExtra) {
    notes.push(`${money(c.intlExtra)} of the PayPal fee is the international extra over the domestic 3.49% + $0.49. Swappa requires the buyer to pay it back before you ship; once they do, you keep ${money(c.payout + c.intlExtra)}.`);
  }
  if (pay !== "stripe") {
    const partner = c.sellerFee + c.buyerFee + c.tax;
    notes.push(
      `PayPal will show a “Partner Fee” of ${money(partner)}: your ${money(c.sellerFee)} seller fee plus the buyer’s ${money(c.buyerFee)} fee${c.tax ? ` and ${money(c.tax)} sales tax` : ""}. Only the ${money(c.sellerFee)} is yours.`,
    );
  }
  if (!toCents(num(inputs, "shippingCost")) && ask > 0) {
    notes.push("Swappa listings ship free, so the label is on you (ground, tracked, insured for the full price). Enter it under “Shipping you pay” to see what’s left.");
  }
  if (!c.tax && ask > 0) {
    const taxed = core(ask, 8, pay, featured);
    notes.push(`Buyers in 46 states and DC pay sales tax, and the ${pay === "stripe" ? "Stripe" : "PayPal"} fee is charged on it: with 8% tax you’d keep ${money(taxed.payout)}.`);
  }

  return assemble({
    market,
    buyerPays: c.total,
    saleAmount: ask,
    fees,
    buyerFees,
    costs: costLines(inputs, market),
    notes: notes.slice(0, 3),
  });
}

function schedule(market: Market): ScheduleRow[] {
  void market;
  return [
    { fee: "Seller fee", amount: "3%", appliesTo: "Your Ask price", when: "When the item sells", source: S.partner },
    { fee: "Buyer fee", amount: "3%, paid by the buyer", appliesTo: "Your Ask price (added to make the listing price)", when: "Every sale; never taken from you", source: S.partner },
    { fee: "PayPal fee", amount: "3.49% + $0.49", appliesTo: "Buyer’s total: listing price + sales tax", when: "PayPal orders (most sales)", source: S.fees },
    { fee: "PayPal international fee", amount: "+1.50%", appliesTo: "Buyer’s total", when: "Buyer pays from a non-US PayPal account (the buyer must pay it back)", source: S.intl },
    { fee: "Stripe card fee", amount: "2.9% + $0.30", appliesTo: "Buyer’s total: listing price + sales tax", when: "Card orders; Power and Enterprise sellers only", source: S.stripe },
    { fee: "Featured listing", amount: "$5.00", appliesTo: "Each featured listing", when: "Optional; non-refundable", source: S.featured },
    { fee: "Listing", amount: "Free", appliesTo: "Each listing", when: "Always", source: S.fees },
    { fee: "Shipping", amount: "Paid by you", appliesTo: "Build it into your Ask price", when: "Ground, tracked, insured for the full price", source: S.shipping },
    { fee: "Sales tax", amount: "Buyer’s state rate, paid by the buyer", appliesTo: "Listing price", when: "Buyers in 46 states + DC", source: S.taxes },
  ];
}

export const swappa: CalculatorDef = {
  slug: "swappa",
  name: "Swappa",
  path: "/swappa-fee-calculator",
  category: "marketplaces",
  priceNoun: "Ask price",
  sellerNoun: "seller",
  blurb: "3% seller fee + 3% buyer fee + PayPal 3.49% + $0.49 on the buyer’s total",
  markets: [M.us],
  defaultMarket: "us",
  priceField: "ask",
  fields: [
    { id: "ask", kind: "money", label: "Your Ask price", section: "sale", help: "The price you set, with shipping built in. Buyers see it plus 3%." },
    {
      id: "payment",
      kind: "segmented",
      label: "How did the buyer pay?",
      section: "sale",
      options: [
        { value: "paypal", label: "PayPal" },
        { value: "paypal-intl", label: "Non-US PayPal" },
        { value: "stripe", label: "Card (Stripe)" },
      ],
      help: "Card checkout through Stripe is only for Power and Enterprise sellers. A non-US PayPal account adds 1.50%.",
    },
    {
      id: "buyerState",
      kind: "select",
      label: "Where is the buyer?",
      section: "sale",
      searchable: true,
      options: STATE_OPTIONS,
      help: "Swappa adds their state’s sales tax. You don’t pay it, but the PayPal or Stripe fee is charged on it.",
    },
    {
      id: "salesTax",
      kind: "percent",
      label: "Buyer’s exact sales tax rate",
      section: "sale",
      max: 20,
      step: 0.01,
      help: "The rate for the buyer’s shipping address. It applies to the listing price (your Ask + 3%).",
      showIf: (i) => str(i, "buyerState", "none") === "custom",
    },
    { id: "shippingCost", kind: "money", label: "Shipping you pay", section: "shipping", help: "Swappa listings ship free: ground, tracked and insured for the full price, all on you." },
    { id: "featured", kind: "toggle", label: "I paid $5 to feature this listing", section: "options", advanced: true, help: "Paid up front and not refundable, even if it doesn’t sell." },
    { id: "itemCost", kind: "money", label: "What the item cost you", section: "costs" },
    { id: "otherCost", kind: "money", label: "Packaging & other", section: "costs" },
  ],
  defaults: () => ({
    ask: 300,
    payment: "paypal",
    buyerState: "none",
    salesTax: 0,
    shippingCost: 0,
    featured: false,
    itemCost: 0,
    otherCost: 0,
  }),
  calculate,
  // Every fee is a straight percentage (plus a fixed amount) of the Ask price: no tiers, caps or minimums.
  breakpoints: () => [],
  verifiedAt: "2026-10-23",
  sources,
  changes,
  schedule,
  compare: {
    group: "sell",
    map: (c) => ({ ask: c.price + c.shipping, shippingCost: c.shippingCost, itemCost: c.itemCost }),
    note: "Shipping built into the Ask price; PayPal; buyer in a no-sales-tax state",
  },
};

export default swappa;
