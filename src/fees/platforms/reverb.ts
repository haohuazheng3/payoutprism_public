/*
 * Reverb seller fees. Every number is from Reverb's own pages (see `sources`), re-read on
 * 2026-10-23 (Help Center articles through their Zendesk JSON API, reverb.com pages in a browser).
 * Research notes with verbatim quotes: research/fees/reverb.md.
 *
 * How a sale is charged (what this module reproduces):
 *  - Selling fee 5% of the sale price + shipping, never on sales tax, with a minimum and maximum
 *    per sale: $0.50 / $500 (USD), C$0.50 / C$680 (CAD, Help Center; the Billing Policy says C$675),
 *    €0.50 / €500, £0.50 / £500. Shops paid in any other currency get the US-dollar equivalents.
 *  - Reverb Payments processing: a percentage of the order total (price + shipping + the sales tax
 *    Reverb collects) plus a fixed fee per transaction in the seller's local currency:
 *    3.19% + $0.49 / C$0.49 / €0.49, Switzerland 3.19% + CHF 0.50, Norway / Sweden / Denmark /
 *    Poland 3.3% + NOK 2.80 / SEK 3.25 / DKK 2.60 / PLN 1.35. UK sellers pay an all-in 5% with no
 *    processing fee. Existing Preferred Sellers pay 2.99% (US, Canada, euro countries).
 *  - Cross-border fee 1% of the transaction total when the buyer is in another country (sales
 *    inside the European Economic Area count as domestic; UK ↔ EU sales are cross-border).
 *  - Bump: the seller's rate × price + shipping, not tax; brand-new listings sold through a
 *    Direct Offer are capped at 1.5%.
 *  - Currency conversion 2.5% of the payout subtotal after processing, when the listing currency
 *    differs from the payout currency. Reverb doesn't define the subtotal further; we take
 *    price + shipping − processing, the literal reading of "after your regular payment
 *    processing fees".
 *  - Safe Shipping (US, bought with a Reverb label): 1%–3.5% of the item's sale price.
 *  - VAT on Reverb's fees for UK/EU sellers without a VAT ID (local standard rate).
 * Reverb doesn't publish a rounding rule; each line is rounded to the cent separately, the way the
 * Earnings page lists the deductions.
 */
import { M } from "../markets";
import { assemble, bool, clamp, costLines, formatRate, moneyFor, num, pct, str, toCents } from "../money";
import { fromUsd, FX_DATE } from "../fx";
import type { CalculatorDef, FeeChange, Inputs, Line, Market, ScheduleRow, Source } from "../types";

const MARKETS: Market[] = [M.us, M.uk, M.ca, M.de, M.fr, M.it, M.es, M.nl, M.ie, M.ch, M.se, M.dk, M.no, M.pl];

/** Sales inside the European Economic Area are domestic for the cross-border fee. */
const EEA = new Set(["de", "fr", "it", "es", "nl", "ie", "se", "dk", "no", "pl"]);

interface Processing {
  rate: number;
  /** Fixed fee per transaction in the market's currency, cents. */
  fixed: number;
  /** Preferred Seller rate, only where Reverb lists it with a fixed fee in the market's currency. */
  preferred?: number;
}

/** Reverb Payments processing by the seller's country ("How does Reverb Payments work?", edited 2026-10-13). */
const PROCESSING: Record<string, Processing> = {
  us: { rate: 3.19, fixed: 49, preferred: 2.99 },
  ca: { rate: 3.19, fixed: 49, preferred: 2.99 },
  de: { rate: 3.19, fixed: 49, preferred: 2.99 },
  fr: { rate: 3.19, fixed: 49, preferred: 2.99 },
  it: { rate: 3.19, fixed: 49, preferred: 2.99 },
  es: { rate: 3.19, fixed: 49, preferred: 2.99 },
  nl: { rate: 3.19, fixed: 49, preferred: 2.99 },
  ie: { rate: 3.19, fixed: 49, preferred: 2.99 },
  ch: { rate: 3.19, fixed: 50 },
  no: { rate: 3.3, fixed: 280 },
  se: { rate: 3.3, fixed: 325 },
  dk: { rate: 3.3, fixed: 260 },
  pl: { rate: 3.3, fixed: 135 },
  // UK: all-in 5%, no payment processing fee.
  uk: { rate: 0, fixed: 0 },
};

/** Selling fee minimum / maximum, cents. Other currencies use the US-dollar equivalent. */
function sellingLimits(market: Market): { min: number; max: number; usdEquivalent: boolean } {
  switch (market.currency) {
    case "USD":
    case "EUR":
    case "GBP":
      return { min: 50, max: 50000, usdEquivalent: false };
    case "CAD":
      return { min: 50, max: 68000, usdEquivalent: false };
    default:
      return { min: fromUsd(50, market.currency), max: fromUsd(50000, market.currency), usdEquivalent: true };
  }
}

/** Standard VAT rate added to Reverb's fees for UK/EU sellers without a VAT ID (from each country's tax law; Reverb doesn't publish the rate). */
const VAT_ON_FEES: Record<string, number> = { uk: 20, de: 19, fr: 20, it: 22, es: 21, nl: 21, ie: 23, se: 25, dk: 25, pl: 23 };

/** Brand-new listings sold through a Direct Offer pay at most this Bump rate. */
const DIRECT_OFFER_BUMP_CAP = 1.5;

const S = {
  fees: "reverb-fees",
  processing: "reverb-processing",
  payments: "reverb-payments",
  billing: "reverb-billing",
  billingOld: "reverb-billing-2022",
  pricing: "reverb-pricing",
  uk: "reverb-uk",
  crossBorder: "reverb-cross-border",
  bump: "reverb-bump",
  preferred: "reverb-preferred",
  safe: "reverb-safe-shipping",
  salesTax: "reverb-sales-tax",
  vat: "reverb-vat",
  caTax: "reverb-canada-tax",
  available: "reverb-payments-available",
  availability: "reverb-availability-2026-07",
  billingArchive: "reverb-billing-2025-06",
  preferredJoin: "reverb-preferred-join",
  labelAdjust: "reverb-label-adjustment",
  paypal: "reverb-paypal",
  refunds: "reverb-refunds",
  cancellations: "reverb-cancellations",
} as const;

const help = (sourceId: string, id: string, slug: string, title: string): Source => ({
  id: sourceId,
  title,
  url: `https://help.reverb.com/hc/en-us/articles/${id}-${slug}`,
  publisher: "Reverb Help Center",
  checked: "2026-10-23",
  watch: `https://help.reverb.com/api/v2/help_center/en-us/articles/${id}.json`,
});

const sources: Source[] = [
  help(S.fees, "40917652290843", "What-fees-will-I-pay-for-selling-on-Reverb", "What fees will I pay for selling on Reverb?"),
  help(S.processing, "41988540155931", "What-is-a-payment-processing-fee", "What is a payment processing fee?"),
  help(S.payments, "52454911807259", "How-does-Reverb-Payments-work", "How does Reverb Payments work?"),
  { id: S.billing, title: "Reverb’s Billing Policy", url: "https://reverb.com/legal/reverbs-billing-policy", publisher: "Reverb", checked: "2026-10-23" },
  { id: S.billingOld, title: "Reverb’s Billing Policy (previous version, changed October 27, 2022)", url: "https://reverb.com/legal/previous-reverbs-billing-policy", publisher: "Reverb", checked: "2026-10-23" },
  {
    id: S.billingArchive,
    title: "Reverb’s Billing Policy (archived copy, June 17, 2025)",
    url: "https://web.archive.org/web/20250617112527/https://reverb.com/legal/reverbs-billing-policy",
    publisher: "Reverb (Internet Archive copy)",
    checked: "2026-10-23",
  },
  { id: S.pricing, title: "Reverb Pricing & Payouts", url: "https://reverb.com/selling/selling-fees", publisher: "Reverb", checked: "2026-10-23" },
  help(S.uk, "41988449682971", "What-s-new-for-UK-sellers-on-Reverb", "What’s new for UK sellers on Reverb?"),
  help(S.crossBorder, "41988349763739", "Are-there-extra-fees-for-selling-to-a-buyer-in-a-different-country", "Are there extra fees for selling to a buyer in a different country?"),
  help(S.bump, "41988532258587", "What-is-Bump-and-how-does-it-work", "What is “Bump” and how does it work?"),
  help(S.preferred, "41988469262107", "What-are-my-fees-as-a-Reverb-Preferred-Seller", "What are my fees as a Reverb Preferred Seller?"),
  help(S.preferredJoin, "41988376208283", "How-do-I-become-a-Reverb-Preferred-Seller", "How do I become a Reverb Preferred Seller?"),
  help(S.available, "41988432190363", "Where-is-Reverb-Payments-available", "Where is Reverb Payments available?"),
  help(S.availability, "41988473838491", "Availability-and-processing-fees-for-Reverb-Payments", "Availability and processing fees for Reverb Payments"),
  help(S.safe, "41988515167515", "How-does-Safe-Shipping-purchased-through-Reverb-work", "How does Safe Shipping purchased through Reverb work?"),
  help(S.salesTax, "41988351891227", "Why-am-I-being-charged-sales-tax-as-a-seller", "Why am I being charged sales tax as a seller?"),
  help(S.vat, "41988456427931", "How-VAT-and-GST-are-collected-on-fees-charged-to-sellers", "How VAT and GST are collected on fees charged to sellers"),
  help(S.caTax, "41988362686235", "Marketplace-Taxes-in-Canada", "Marketplace Taxes in Canada"),
  help(S.labelAdjust, "41988405274395", "Why-did-I-receive-a-shipping-label-adjustment", "Why did I receive a shipping label adjustment?"),
  help(S.paypal, "41988411420699", "How-to-get-paid-with-PayPal", "How to get paid with PayPal"),
  help(S.refunds, "41988468279067", "What-happens-after-I-initiate-a-refund", "What happens after I initiate a refund?"),
  help(
    S.cancellations,
    "41988366075419",
    "What-is-Reverb-s-policy-for-seller-initiated-canceled-or-refunded-orders",
    "What is Reverb’s policy for seller-initiated canceled or refunded orders?",
  ),
];

const changes: FeeChange[] = [
  {
    date: "2026-10-13",
    text: "Reverb Payments’ fee table now lists sellers in Switzerland, Norway, Sweden, Denmark, Poland, Hungary and Czechia (absent from the July 2, 2026 version): processing is 3.19% + CHF 0.50 in Switzerland and 3.3% plus a local fixed fee elsewhere (NOK 2.80, SEK 3.25, DKK 2.60, PLN 1.35, HUF 90, CZK 10). Reverb hasn’t published a launch date; this is when the table was updated.",
    source: S.payments,
  },
  {
    date: "2026-10-06",
    text: "Reverb’s Bump rules are rewritten: rates run from 1% to 30%, Auto-Bump rules can Bump matching listings automatically, and a brand-new listing sold through a Direct Offer pays a Bump fee of at most 1.5%.",
    source: S.bump,
  },
  {
    date: "2026-05-13",
    text: "Sellers paid through PayPal move to the Reverb Payments timeline: Reverb’s fees come straight out of the PayPal payout instead of a month-end card charge, and tracking is required before payment is released.",
    source: S.paypal,
  },
  {
    date: "2025-09-09",
    text: "UK sellers move to an all-in 5% fee: payment processing for UK shops drops from 3.19% + £0.49 (Preferred Sellers 2.99% + £0.49) to 0%. Reverb hasn’t published the start date; this is when its Billing Policy was updated.",
    source: S.billing,
  },
  {
    date: "2022-10-27",
    text: "Payment processing raised from 2.7% + $0.25 to 3.19% + $0.49 (Canada C$0.25 → C$0.49, euro countries €0.25 → €0.49, UK £0.25 → £0.49 with the same rates; Preferred Sellers 2.5% → 2.99%).",
    source: S.billingOld,
  },
];

function abroad(inputs: Inputs): boolean {
  return str(inputs, "buyerRegion", "domestic") === "international";
}

function taxShown(inputs: Inputs, market: Market): boolean {
  return (market.id === "us" || market.id === "ca") && !abroad(inputs);
}

function calculate(inputs: Inputs, market: Market) {
  const money = moneyFor(market);
  const uk = market.id === "uk";
  const item = toCents(num(inputs, "price"));
  const shipping = toCents(num(inputs, "shippingCharged"));
  const sale = item + shipping; // selling fee, Bump and payout base (no tax)
  const taxRate = taxShown(inputs, market) ? Math.max(0, num(inputs, "salesTax")) : 0;
  const tax = pct(sale, taxRate);
  const total = sale + tax; // processing and cross-border base
  const intl = abroad(inputs);

  const fees: Line[] = [];

  // Selling fee: 5% of price + shipping, min/max per sale.
  const lim = sellingLimits(market);
  const raw = pct(sale, 5);
  const selling = sale > 0 ? clamp(raw, lim.min, lim.max) : 0;
  const approx = lim.usdEquivalent ? "≈ " : "";
  const limitsText = lim.usdEquivalent
    ? `the US-dollar equivalents of $0.50 and $500 (${approx}${money(lim.min)} and ${approx}${money(lim.max)})`
    : `${money(lim.min)} and ${money(lim.max)}`;
  const limitsSentence = lim.usdEquivalent
    ? `The fee is at least and at most ${limitsText} per sale.`
    : `The fee is at least ${money(lim.min)} and at most ${money(lim.max)} per sale.`;
  fees.push({
    id: "selling",
    label: uk ? "Selling fee (all-in 5%)" : "Selling fee",
    amount: selling,
    kind: "platform",
    detail:
      raw > lim.max
        ? `5% would be ${money(raw)}, capped at ${approx}${money(lim.max)}`
        : sale > 0 && raw < lim.min
          ? `5% would be ${money(raw)}, minimum ${approx}${money(lim.min)}`
          : `5% × ${money(sale)}`,
    explain: `5% of the sale price plus the shipping the buyer pays, never on sales tax or VAT Reverb collects. ${limitsSentence}${uk ? " UK sellers pay no separate payment processing fee." : ""}`,
    source: uk ? S.uk : S.fees,
  });

  // Payment processing (Reverb Payments).
  const proc = PROCESSING[market.id] ?? PROCESSING.us;
  if (uk) {
    fees.push({
      id: "processing",
      label: "Payment processing",
      amount: 0,
      kind: "payment",
      detail: "0%: included in the all-in 5%",
      explain: "Sellers in the UK pay an all-in 5% with no payment processing fee on top.",
      source: S.uk,
    });
  } else {
    const preferred = proc.preferred !== undefined && bool(inputs, "preferred");
    const rate = preferred ? proc.preferred! : proc.rate;
    fees.push({
      id: "processing",
      label: "Payment processing",
      amount: total > 0 ? pct(total, rate) + proc.fixed : 0,
      kind: "payment",
      detail: `${formatRate(rate)} × ${money(total)} + ${money(proc.fixed)}`,
      explain: `${formatRate(rate)} of everything the buyer pays${tax ? " (price, shipping and the sales tax Reverb collects)" : ", shipping and any sales tax included,"} plus ${money(proc.fixed)} per transaction, whatever payment method the buyer uses.${preferred ? " Preferred Seller rate; Reverb isn’t accepting new Preferred Sellers." : ""}`,
      source: preferred ? S.preferred : S.payments,
    });
  }

  if (intl) {
    fees.push({
      id: "crossborder",
      label: "Cross-border fee",
      amount: pct(total, 1),
      kind: "payment",
      detail: `1% × ${money(total)}`,
      explain: EEA.has(market.id)
        ? "1% of the transaction total when the buyer is outside the European Economic Area (the UK, Switzerland and the US count as abroad). Sales between EEA countries are domestic."
        : uk
          ? "1% of the transaction total when the buyer is outside the UK. Sales between the UK and the EU count as cross-border."
          : "1% of the transaction total when the buyer’s billing address is in another country from your shop.",
      source: uk ? S.uk : S.crossBorder,
    });
  }

  const bumpSet = Math.min(30, Math.max(0, num(inputs, "bump")));
  if (bumpSet > 0) {
    const capped = bool(inputs, "directOfferNew") && bumpSet > DIRECT_OFFER_BUMP_CAP;
    const rate = capped ? DIRECT_OFFER_BUMP_CAP : bumpSet;
    fees.push({
      id: "bump",
      label: `Bump fee (${formatRate(rate)})`,
      amount: pct(sale, rate),
      kind: "ads",
      detail: capped ? `${formatRate(rate)} × ${money(sale)} (Direct Offer cap, your rate ${formatRate(bumpSet)})` : `${formatRate(rate)} × ${money(sale)}`,
      explain:
        "Charged only when a Bumped listing sells: your Bump rate on the price plus shipping, not tax. If the sale came from an offer, the rate in effect when the offer was made applies. Brand-new listings sold through a Direct Offer pay at most 1.5%.",
      source: S.bump,
    });
  }

  if (market.id === "us") {
    const safeRate = Math.min(3.5, Math.max(0, num(inputs, "safeShipping")));
    if (safeRate > 0) {
      fees.push({
        id: "safeshipping",
        label: `Safe Shipping (${formatRate(safeRate)})`,
        amount: pct(item, safeRate),
        kind: "shipping",
        detail: `${formatRate(safeRate)} × ${money(item)}`,
        explain:
          "Optional protection added to a label bought through Reverb: 1% to 3.5% of the item’s sale price depending on the gear and destination, shown when you buy the label. Required for items priced $1,500 to $10,000; not offered on international shipments over $2,500.",
        source: S.safe,
      });
    }
  }

  const procAmount = fees.find((l) => l.id === "processing")!.amount;
  if (market.id !== "us" && bool(inputs, "currencyConversion")) {
    const base = Math.max(0, sale - procAmount);
    fees.push({
      id: "fx",
      label: "Currency conversion",
      amount: pct(base, 2.5),
      kind: "payment",
      detail: `2.5% × (${money(sale)} − ${money(procAmount)})`,
      explain: "Charged when you list in a different currency from the one you’re paid out in: 2.5% of your payout subtotal after payment processing. Listing in your payout currency avoids it.",
      source: S.fees,
    });
  }

  const vatRate = VAT_ON_FEES[market.id];
  if (vatRate && bool(inputs, "vatOnFees")) {
    const reverbFees = fees.reduce((s, l) => s + l.amount, 0);
    fees.push({
      id: "vat",
      label: `VAT on Reverb fees (${formatRate(vatRate)})`,
      amount: pct(reverbFees, vatRate),
      kind: "tax",
      detail: `${formatRate(vatRate)} × ${money(reverbFees)}`,
      explain: `Reverb’s fees exclude VAT. Sellers without a VAT ID on their Reverb account are charged VAT on them (${formatRate(vatRate)} is ${market.label}’s standard rate), billed on the monthly statement. Registered businesses that add their VAT ID aren’t charged it.`,
      source: S.vat,
    });
  }

  const notes: string[] = [];
  if (market.id === "us" && taxShown(inputs, market) && !taxRate)
    notes.push("Processing is also charged on the sales tax your buyer pays. Add their tax rate under “More options” for the exact figure.");
  if (market.id === "us" && item >= 150000 && item < 1000000 && !num(inputs, "safeShipping"))
    notes.push("If you buy the label through Reverb, items priced $1,500 to $10,000 must add Safe Shipping (1% to 3.5% of the price). Set its rate under “More options”.");
  if (market.id === "us" && item >= 1000000) notes.push("Reverb labels and Safe Shipping aren’t available for items priced $10,000 or more: arrange shipping and insurance yourself.");
  if (market.id === "ca" && raw > lim.max) notes.push("Reverb’s Help Center caps the CAD selling fee at C$680; its Billing Policy says C$675. We use C$680.");
  if (market.id === "ca") notes.push("Reverb also charges GST/HST (and PST or QST where they apply) on its fees to Canadian sellers, depending on your tax status. It isn’t included here.");
  if (lim.usdEquivalent) notes.push(`The selling fee’s minimum and maximum are converted from US dollars at the ECB reference rate of ${FX_DATE}; Reverb uses its own rate.`);
  if (!bumpSet) notes.push("If the listing is Bumped (check your Auto-Bump rules too), add its rate above: it’s charged on the price plus shipping.");

  return assemble({
    market,
    buyerPays: total,
    saleAmount: sale,
    fees,
    costs: costLines(inputs, market),
    notes,
  });
}

function schedule(market: Market): ScheduleRow[] {
  const money = moneyFor(market);
  const uk = market.id === "uk";
  const lim = sellingLimits(market);
  const approx = lim.usdEquivalent ? "≈ " : "";
  const proc = PROCESSING[market.id] ?? PROCESSING.us;
  const rows: ScheduleRow[] = [
    {
      fee: uk ? "Selling fee (all-in)" : "Selling fee",
      amount: `5% (min ${approx}${money(lim.min)}, max ${approx}${money(lim.max)})`,
      appliesTo: "Sale price + shipping (not sales tax or VAT)",
      when: "Only when an item sells",
      source: uk ? S.uk : S.fees,
    },
    uk
      ? { fee: "Payment processing", amount: "0%", appliesTo: "Included in the all-in 5%", source: S.uk }
      : { fee: "Payment processing", amount: `${formatRate(proc.rate)} + ${money(proc.fixed)}`, appliesTo: "Order total incl. shipping and sales tax", when: "Every Reverb Payments sale", source: S.payments },
  ];
  if (proc.preferred !== undefined)
    rows.push({ fee: "Preferred Seller processing", amount: `${formatRate(proc.preferred)} + ${money(proc.fixed)}`, appliesTo: "Order total incl. shipping and sales tax", when: "Existing Preferred Sellers (closed to new sellers)", source: S.payments });
  rows.push(
    {
      fee: "Cross-border fee",
      amount: "1%",
      appliesTo: "Transaction total",
      when: EEA.has(market.id) ? "Buyer outside the EEA" : uk ? "Buyer outside the UK (incl. the EU)" : "Buyer in another country",
      source: uk ? S.uk : S.crossBorder,
    },
    { fee: "Bump", amount: "Your rate, 1%–30%", appliesTo: "Sale price + shipping (not tax)", when: "Only if a Bumped listing sells; brand-new Direct Offer sales max 1.5%", source: S.bump },
  );
  if (market.id !== "us")
    rows.push({ fee: "Currency conversion", amount: "2.5%", appliesTo: "Payout subtotal after processing", when: "Listing currency ≠ payout currency", source: S.fees });
  if (market.id === "us")
    rows.push({ fee: "Safe Shipping", amount: "1%–3.5%", appliesTo: "Item sale price", when: "Optional with a Reverb label; required $1,500–$10,000", source: S.safe });
  const vat = VAT_ON_FEES[market.id];
  if (vat) rows.push({ fee: "VAT on fees", amount: `${formatRate(vat)} (standard rate)`, appliesTo: "All Reverb fees", when: "No VAT ID on your Reverb account", source: S.vat });
  rows.push({ fee: "Listing, renewal, membership", amount: "Free", appliesTo: "Every listing", when: "Always", source: S.billing });
  return rows;
}

export const reverb: CalculatorDef = {
  slug: "reverb",
  name: "Reverb",
  path: "/reverb-fee-calculator",
  category: "marketplaces",
  priceNoun: "sale price",
  sellerNoun: "seller",
  blurb: "5% selling fee ($0.50 min, $500 max) + 3.19% + $0.49 processing (US)",
  markets: MARKETS,
  defaultMarket: "us",
  priceField: "price",
  fields: [
    { id: "price", kind: "money", label: "Sale price", section: "sale", help: "Your listing price, or the offer you accepted." },
    {
      id: "salesTax",
      kind: "percent",
      label: "Buyer’s sales tax rate",
      section: "sale",
      advanced: true,
      max: 20,
      help: (_i, m) =>
        m.id === "ca"
          ? "GST/HST (and PST or QST) Reverb collects when you haven’t added a tax ID. Processing is charged on it too."
          : "Reverb collects it for the state and passes it on, but processing is charged on it too.",
      showIf: taxShown,
    },
    { id: "shippingCharged", kind: "money", label: "Shipping the buyer pays", section: "shipping", help: "Reverb’s 5% and processing are charged on shipping too." },
    {
      id: "buyerRegion",
      kind: "segmented",
      label: "Where is the buyer?",
      section: "shipping",
      options: (_i, m) => {
        if (EEA.has(m.id))
          return [
            { value: "domestic", label: "In the EEA" },
            { value: "international", label: "Outside the EEA" },
          ];
        const home = m.id === "us" ? "the US" : m.id === "uk" ? "the UK" : m.label;
        return [
          { value: "domestic", label: `In ${home}` },
          { value: "international", label: `Outside ${home}` },
        ];
      },
      help: (_i, m) =>
        EEA.has(m.id)
          ? "Sales within the European Economic Area count as domestic; buyers in the UK, Switzerland or the US add 1%."
          : m.id === "uk"
            ? "Reverb adds 1% when the buyer is outside the UK, EU buyers included."
            : m.id === "ch"
              ? "Reverb adds 1% when the buyer is outside Switzerland, EU buyers included."
              : "Reverb adds 1% when the buyer’s billing address is in another country.",
    },
    {
      id: "safeShipping",
      kind: "percent",
      label: "Safe Shipping rate (with a Reverb label)",
      section: "shipping",
      advanced: true,
      max: 3.5,
      step: 0.5,
      help: "1% to 3.5% of the item price, shown when you buy the label. Required for items $1,500 to $10,000.",
      showIf: (_i, m) => m.id === "us",
    },
    {
      id: "bump",
      kind: "percent",
      label: "Bump rate on this listing",
      section: "options",
      max: 30,
      step: 0.5,
      help: "Only charged if the Bumped listing sells, on price plus shipping. Leave at 0% if it isn’t Bumped; Reverb usually suggests 4.5%.",
    },
    {
      id: "directOfferNew",
      kind: "toggle",
      label: "Brand-new item sold through a Direct Offer",
      section: "options",
      advanced: true,
      help: "Reverb caps the Bump fee at 1.5% on these sales.",
      showIf: (i) => num(i, "bump") > DIRECT_OFFER_BUMP_CAP,
    },
    {
      id: "vatOnFees",
      kind: "toggle",
      label: "Reverb adds VAT to my fees",
      section: "options",
      help: "Yes unless you’ve added a VAT ID to your Reverb account.",
      showIf: (_i, m) => m.id in VAT_ON_FEES,
    },
    {
      id: "preferred",
      kind: "toggle",
      label: "I’m a Reverb Preferred Seller",
      section: "options",
      advanced: true,
      help: "Existing Preferred Sellers pay 2.99% processing. The program isn’t taking new sellers.",
      showIf: (_i, m) => PROCESSING[m.id]?.preferred !== undefined,
    },
    {
      id: "currencyConversion",
      kind: "toggle",
      label: "I list in a different currency from my payout",
      section: "options",
      advanced: true,
      help: (_i, m) =>
        m.id === "ca"
          ? "For example listing in US dollars while you’re paid in Canadian dollars. Reverb takes 2.5%."
          : m.currency === "EUR" || m.currency === "GBP"
            ? `For example listing in US dollars while you’re paid in ${m.currency === "EUR" ? "euros" : "pounds"}. Reverb takes 2.5%.`
            : "For example listing in euros while you’re paid in your local currency. Reverb takes 2.5%.",
      showIf: (_i, m) => m.id !== "us",
    },
    { id: "itemCost", kind: "money", label: "What the gear cost you", section: "costs", help: "What you paid for it, or your cost to make it." },
    { id: "shippingCost", kind: "money", label: "Shipping label / postage", section: "costs", help: "A label bought on Reverb comes out of your payout; enter it here to see your profit." },
    { id: "otherCost", kind: "money", label: "Packing & other costs", section: "costs" },
  ],
  defaults: (market) => {
    const typical: Record<string, [number, number]> = { SEK: [3000, 250], NOK: [3000, 250], DKK: [2000, 150], PLN: [1200, 80], GBP: [300, 20], EUR: [300, 20], CHF: [300, 20], CAD: [400, 30] };
    const [price, shipping] = typical[market.currency] ?? [300, 25];
    return {
      price,
      salesTax: 0,
      shippingCharged: shipping,
      buyerRegion: "domestic",
      safeShipping: 0,
      bump: 0,
      directOfferNew: false,
      vatOnFees: market.id in VAT_ON_FEES,
      preferred: false,
      currencyConversion: false,
      itemCost: 0,
      shippingCost: 0,
      otherCost: 0,
    };
  },
  calculate,
  breakpoints: (inputs, market) => {
    // The selling fee is flat below its minimum and above its maximum.
    const { min, max } = sellingLimits(market);
    const shipping = toCents(num(inputs, "shippingCharged"));
    return [Math.ceil(min * 20) - shipping, Math.ceil(max * 20) - shipping].filter((b) => b > 0);
  },
  verifiedAt: "2026-10-23",
  sources,
  changes,
  schedule,
  compare: {
    group: "sell",
    map: (c) => ({ price: c.price, shippingCharged: c.shipping, itemCost: c.itemCost, shippingCost: c.shippingCost }),
    note: "US seller on Reverb Payments, domestic buyer, no Bump",
  },
};

export default reverb;
