/*
 * Depop seller fees (and the buyer's marketplace fee). Every number is from Depop's own pages (see
 * `sources`), re-read 2026-10-23 through the help centre's Zendesk API. Research notes with verbatim
 * quotes: research/fees/depop.md.
 *
 * How a sale is settled (what this module reproduces):
 *  - Sellers based in the US, UK and Australia pay no selling fee. Sellers elsewhere pay 10% of the
 *    item price (excl. tax) plus the shipping they charge, VAT included, collected through PayPal.
 *  - Depop Payments (Stripe) processing, by the seller's market: US 3.3% + $0.45, UK 2.9% + £0.30,
 *    AU 2.6% + A$0.30, "charged on the item sale price plus shipping costs and any applicable taxes",
 *    once per transaction (a bundle is one transaction). US sales tax is in the base.
 *    The buyer's marketplace fee is not in the listed base, so it is left out here.
 *  - Sellers outside the US/UK/AU are paid through PayPal; Depop doesn't publish PayPal's rate, so the
 *    seller types it in (defaults to 0 with a note).
 *  - Boosting fee, only on a sale from a boosted listing: 12% in the UK and US, 8% in Australia and
 *    elsewhere, on the item price (excl. tax) plus shipping the seller arranges; never on a Depop label.
 *  - Depop Shipping labels: the buyer pays the label, Depop deducts it from the payout, so it nets to
 *    zero. Only a seller-funded shipping discount (US, iOS: $2/$3/$4 off or free) costs the seller.
 *    With a Depop label the shipping money never belongs to the seller, so `saleAmount` is the item
 *    price alone; with own shipping it is item + shipping (the seller then buys postage).
 *  - Buyers in the US, UK and AU pay a marketplace fee of "up to 5%" of the item price "plus a fixed
 *    amount of up to" 1 unit; Depop shows the exact amount only at checkout, so we show that maximum.
 *    US buyers pay sales tax on it; in the UK it includes VAT, in Australia GST.
 * Depop doesn't document rounding; each line is rounded to the cent separately (half away from zero).
 */
import { M } from "../markets";
import { assemble, bool, costLines, formatRate, moneyFor, num, pct, str, toCents } from "../money";
import type { CalculatorDef, FeeChange, Inputs, Line, Market, ScheduleRow, Source } from "../types";

/** Sellers outside the US, UK and Australia: one market, priced in euros (the percentages are the same in any currency). */
const OTHER: Market = { ...M.ie, id: "other", label: "Other countries (€)", flag: "🌍" };

/**
 * Australia formatted with en-GB rules so amounts print as "A$1.00": en-AU prints a bare "$", which
 * reads as US dollars next to the US row of the market table and in the A$ fixed fees.
 */
const AU: Market = { ...M.au, locale: "en-GB" };

const MARKETS: Market[] = [M.us, M.uk, AU, OTHER];

interface MarketRules {
  /** Depop Payments processing: percent and fixed cents in the market's currency. Null = PayPal. */
  processing: { rate: number; fixed: number } | null;
  /** Selling fee percent (0 for US/UK/AU sellers). */
  selling: number;
  /** Boosting fee percent for current listings. */
  boost: number;
  /** Buyer marketplace fee: maximum percent + maximum fixed cents (null = none). */
  buyerFee: { rate: number; fixed: number } | null;
  /** Depop Shipping carrier (null = no Depop labels for this market). */
  carrier: string | null;
}

const RULES: Record<string, MarketRules> = {
  us: { processing: { rate: 3.3, fixed: 45 }, selling: 0, boost: 12, buyerFee: { rate: 5, fixed: 100 }, carrier: "USPS" },
  uk: { processing: { rate: 2.9, fixed: 30 }, selling: 0, boost: 12, buyerFee: { rate: 5, fixed: 100 }, carrier: "Evri" },
  au: { processing: { rate: 2.6, fixed: 30 }, selling: 0, boost: 8, buyerFee: { rate: 5, fixed: 100 }, carrier: "Australia Post" },
  other: { processing: null, selling: 10, boost: 8, buyerFee: null, carrier: null },
};

/** Boosting fee for UK/US listings created before 12% began ("^new listings from 23 March 2026"; UK: 3 December 2025). */
const OLD_BOOST = 8;

/** Seller-funded discounts on a Depop label (US sellers on iOS). */
const SHIPPING_DISCOUNTS: Record<string, number> = { none: 0, "2": 200, "3": 300, "4": 400 };

/**
 * Australia: from 26 October 2026 (existing accounts; new accounts since 6 October) new listings must
 * use Depop Shipping. Midnight in Sydney (AEDT, UTC+11) = 13:00 UTC the day before.
 */
export function auDepopShippingRequired(at: number = Date.now()): boolean {
  return at >= Date.UTC(2026, 9, 25, 13, 0);
}

const HELP = (id: string) => `https://depophelp.zendesk.com/hc/en-gb/articles/${id}`;
const API = (id: string) => `https://depophelp.zendesk.com/api/v2/help_center/en-gb/articles/${id.split("-")[0]}.json`;

const S = {
  fees: "depop-seller-fees",
  feesArchive: "depop-seller-fees-2026-01",
  marketplace: "depop-marketplace-fee",
  marketplaceAu: "depop-marketplace-fee-au",
  boost: "depop-boosted",
  boostPolicy: "depop-boosted-policy",
  tos: "depop-terms",
  salesTax: "depop-sales-tax",
  discounts: "depop-discounts",
  charges: "depop-fee-or-charge",
  pricingAu: "depop-pricing-au",
  shippingAu: "depop-shipping-policy-au",
  switchAu: "depop-payments-au",
  shipWorldwide: "depop-ship-worldwide",
  payoutUs: "depop-paid-us",
  payoutUk: "depop-paid-uk",
  payoutAu: "depop-paid-au",
  ebay: "depop-ebay-faq",
  newsUk: "depop-news-uk",
  newsUs: "depop-news-us",
  newsAu: "depop-news-au",
} as const;

function help(id: string, slugged: string, title: string): Source {
  return { id, title, url: HELP(slugged), publisher: "Depop Help", checked: "2026-10-23", watch: API(slugged) };
}

const sources: Source[] = [
  help(S.fees, "360001791127-Seller-fees-and-charges", "Seller fees and charges"),
  help(S.marketplace, "21752555753361-What-is-the-Marketplace-fee", "What is the Marketplace fee?"),
  help(S.marketplaceAu, "48318981043217-What-is-the-Marketplace-fee-Australia", "What is the Marketplace fee? - Australia"),
  help(S.boost, "10110299060753-Boosted-Listings", "Boosted Listings"),
  help(S.boostPolicy, "9253129255569-Boosted-Listings-Policy", "Boosted Listings Policy"),
  help(S.tos, "360001773148-Terms-of-Service", "Terms of Service"),
  help(S.salesTax, "360012516318-State-Sales-Tax-in-the-US", "State Sales Tax in the US"),
  help(S.discounts, "360033415634-Discounts", "Discounts"),
  help(S.charges, "360047922234-I-don-t-recognise-a-fee-or-charge", "I don't recognise a fee or charge"),
  help(S.pricingAu, "50990472732561-How-pricing-works-on-Depop-Australia", "How pricing works on Depop - Australia"),
  help(S.shippingAu, "49349901419409-Shipping-Policy-Australia", "Shipping Policy - Australia"),
  help(S.switchAu, "17659492828305-Switching-to-Depop-Payments-in-Australia", "Switching to Depop Payments in Australia"),
  help(S.shipWorldwide, "360001771988-How-to-ship-Worldwide", "How to ship - Worldwide"),
  help(S.payoutUs, "9057092334865-How-do-I-get-paid-US", "How do I get paid? - US"),
  help(S.payoutUk, "360001791147-How-do-I-get-paid-UK", "How do I get paid? - UK"),
  help(S.payoutAu, "29758489111185-How-do-I-get-paid-Australia", "How do I get paid? - Australia"),
  help(S.ebay, "43972530939665-eBay-to-acquire-Depop-FAQ", "eBay to acquire Depop - FAQ"),
  {
    id: S.feesArchive,
    title: "Seller fees and charges (archived copy, 13 January 2026)",
    url: "https://web.archive.org/web/20260113090025/https://depophelp.zendesk.com/hc/en-gb/articles/360001791127-Seller-fees-and-charges",
    publisher: "Depop Help (Internet Archive copy)",
    checked: "2026-10-23",
  },
  {
    id: S.newsUk,
    title: "Evolving our fee structure, with zero selling fees on Depop",
    url: "https://news.depop.com/company-news/evolving-our-fee-structure-with-zero-selling-fees-on-depop/",
    publisher: "Depop Newsroom",
    checked: "2026-10-23",
  },
  {
    id: S.newsUs,
    title: "Depop removes selling fees in the United States, evolves fee structure",
    url: "https://news.depop.com/company-news/depop-removes-selling-fees-in-the-united-states-evolves-fee-structure/",
    publisher: "Depop Newsroom",
    checked: "2026-10-23",
  },
  {
    id: S.newsAu,
    title: "Depop makes selling free in Australia, helping people earn more from fashion resale",
    url: "https://news.depop.com/company-news/depop-makes-selling-free-in-australia-helping-people-earn-more-from-fashion-resale/",
    publisher: "Depop Newsroom",
    checked: "2026-10-23",
  },
];

const changes: FeeChange[] = [
  {
    date: "2026-10-26",
    text: "Australia: existing sellers must use Depop Shipping (Australia Post) for new listings, as new accounts have since October 6, 2026. Rates don’t change, but on those listings the 8% boosting fee no longer applies to shipping, because it isn’t charged on Depop labels.",
    source: S.shippingAu,
    upcoming: true,
  },
  {
    date: "2026-07-22",
    text: "Australia: the 10% selling fee is removed for AUD sales (0%), and buyers start paying a marketplace fee of up to 5% of the item price plus up to A$1. Processing (2.6% + A$0.30) and boosting fees still apply.",
    source: S.newsAu,
  },
  {
    date: "2026-07-20",
    text: "Australia: PayPal is removed as a way to get paid; sellers must set up Depop Payments to keep listing. Depop says the fees don’t change: the processing fee PayPal used to take is now charged through Depop Payments (2.6% + A$0.30 per sale).",
    source: S.switchAu,
  },
  { date: "2026-03-23", text: "US: boosting fee raised from 8% to 12% for new listings, matching the UK. Australia and other countries stay at 8%.", source: S.fees },
  { date: "2025-12-03", text: "UK: boosting fee raised from 8% to 12% for new listings.", source: S.feesArchive },
  { date: "2024-07-18", text: "US: buyers start paying a marketplace fee of up to 5% of the item price plus up to $1 (plus sales tax where it applies).", source: S.newsUs },
  { date: "2024-07-15", text: "US: the 10% selling fee is removed for new listings sold in USD (10% → 0%). The 3.3% + $0.45 processing fee still applies.", source: S.newsUs },
  { date: "2024-04-15", text: "UK: buyers start paying a marketplace fee of up to 5% of the item price plus up to £1, VAT included.", source: S.newsUk },
  { date: "2024-03-20", text: "UK: the 10% selling fee is removed for new listings sold in GBP (10% → 0%). The 2.9% + £0.30 processing fee still applies.", source: S.newsUk },
];

/** "depop" (Depop Shipping label) or "own" (seller arranges shipping). Outside the US/UK/AU there are no Depop labels. */
function shippingMethod(inputs: Inputs, market: Market): "depop" | "own" {
  if (!RULES[market.id]?.carrier) return "own";
  return str(inputs, "shippingMethod", "depop") === "own" ? "own" : "depop";
}

function boostRate(inputs: Inputs, market: Market): number {
  const rules = RULES[market.id] ?? RULES.us;
  if ((market.id === "us" || market.id === "uk") && bool(inputs, "boostOld")) return OLD_BOOST;
  return rules.boost;
}

const SELLER_PLACE: Record<string, string> = { us: "the US", uk: "the UK", au: "Australia" };
const ZERO_SINCE: Record<string, string> = {
  us: "on USD sales of listings created since July 15, 2024",
  uk: "on GBP sales of listings created since March 20, 2024",
  au: "on AUD sales since July 22, 2026",
};

function calculate(inputs: Inputs, market: Market) {
  const money = moneyFor(market);
  const rules = RULES[market.id] ?? RULES.us;
  const us = market.id === "us";
  const method = shippingMethod(inputs, market);
  const depopLabel = method === "depop";

  const item = toCents(num(inputs, "price"));
  const label = depopLabel ? toCents(num(inputs, "labelPrice")) : 0;
  const discountChoice = str(inputs, "shippingDiscount", "none");
  const discount = us && depopLabel ? (discountChoice === "free" ? label : Math.min(label, SHIPPING_DISCOUNTS[discountChoice] ?? 0)) : 0;
  /** What the buyer pays for shipping. */
  const buyerShipping = depopLabel ? label - discount : toCents(num(inputs, "shippingCharged"));
  /** Shipping that is the seller's money (own shipping only): part of the selling-fee and boosting-fee base. */
  const ownShipping = depopLabel ? 0 : buyerShipping;
  const feeBase = item + ownShipping;

  const taxRate = us ? Math.min(100, Math.max(0, num(inputs, "salesTax"))) : 0;
  const tax = pct(item + buyerShipping, taxRate);
  const processingBase = item + buyerShipping + tax;

  const fees: Line[] = [];

  if (rules.selling) {
    fees.push({
      id: "selling",
      label: "Depop selling fee",
      amount: pct(feeBase, rules.selling),
      kind: "platform",
      detail: `${formatRate(rules.selling)} × ${money(feeBase)}`,
      explain:
        "Sellers outside the US, UK and Australia pay 10% of the item price (excluding tax) plus the shipping they charge, VAT included. Depop collects it from your PayPal account, sometimes up to 21 days after the sale; in a bundle it shows once per item.",
      source: S.fees,
    });
  } else {
    fees.push({
      id: "selling",
      label: "Selling fee",
      amount: 0,
      kind: "platform",
      detail: `0% (sellers based in ${SELLER_PLACE[market.id]})`,
      explain: `Depop charges no selling fee to sellers based in ${SELLER_PLACE[market.id]} ${ZERO_SINCE[market.id]}. Payment processing and boosting fees still apply.`,
      source: S.fees,
    });
  }

  if (rules.processing) {
    const p = rules.processing;
    fees.push({
      id: "processing",
      label: "Payment processing",
      amount: pct(processingBase, p.rate) + p.fixed,
      kind: "payment",
      detail: `${formatRate(p.rate)} × ${money(processingBase)} + ${money(p.fixed)}`,
      explain: `Depop Payments (Stripe) takes ${formatRate(p.rate)} + ${money(p.fixed)} per sale, charged on the item price plus shipping${
        us ? " and the sales tax the buyer pays, even though the tax goes to the state" : " and any tax"
      }. A bundle is one sale, so it pays the fixed part once.`,
      source: us && tax ? S.salesTax : S.fees,
    });
  } else {
    const rate = Math.min(100, Math.max(0, num(inputs, "paypalRate")));
    const fixed = toCents(num(inputs, "paypalFixed"));
    const base = item + buyerShipping;
    const amount = pct(base, rate) + fixed;
    fees.push({
      id: "paypal",
      label: "PayPal processing fee",
      amount,
      kind: "payment",
      detail: amount ? `${formatRate(rate)} × ${money(base)} + ${money(fixed)}` : "Not included: add your PayPal rate under More options",
      explain:
        "Outside the US, UK and Australia you’re paid through PayPal, which charges its own fee on the payment. Depop doesn’t publish it because it depends on your country and PayPal account; check your PayPal fees page.",
      source: S.fees,
    });
  }

  if (bool(inputs, "boosted")) {
    const rate = boostRate(inputs, market);
    fees.push({
      id: "boost",
      label: `Boosting fee (${formatRate(rate)})`,
      amount: pct(feeBase, rate),
      kind: "ads",
      detail: `${formatRate(rate)} × ${money(feeBase)}`,
      explain: depopLabel
        ? `Charged because the buyer saw your boosted listing in the 28 days before buying (seeing it counts, no click needed). ${formatRate(rate)} of the item price excluding tax; not charged on a Depop Shipping label.`
        : `Charged because the buyer saw your boosted listing in the 28 days before buying (seeing it counts, no click needed). ${formatRate(rate)} of the item price excluding tax plus the shipping you charge, because you arrange your own shipping.`,
      source: S.boostPolicy,
    });
  }

  if (depopLabel) {
    fees.push({
      id: "label",
      label: discount ? "Shipping discount you cover" : "Depop Shipping label",
      amount: discount,
      kind: "shipping",
      detail: discount
        ? `${money(label)} label deducted, buyer paid ${buyerShipping ? money(buyerShipping) : "nothing"}`
        : `${money(label)} paid by the buyer, ${money(label)} deducted`,
      explain: discount
        ? "Depop deducts the full label from your payout; the buyer only paid part of it, so the difference comes out of your earnings."
        : `The buyer pays for the ${rules.carrier} label and Depop deducts the same amount from your payout, so it costs you nothing. No boosting or selling fee is charged on it; processing is.`,
      source: discount ? S.discounts : S.charges,
    });
  }

  const buyerFees: Line[] = [];
  if (rules.buyerFee && item > 0) {
    const bf = rules.buyerFee;
    const amount = pct(item, bf.rate) + bf.fixed;
    buyerFees.push({
      id: "marketplace",
      label: "Marketplace fee (maximum)",
      amount,
      kind: "platform",
      detail: `up to ${formatRate(bf.rate)} × ${money(item)} + ${money(bf.fixed)}`,
      explain: `Depop charges the buyer up to ${formatRate(bf.rate)} of the item price plus up to ${money(bf.fixed)}, not on shipping or tax${
        market.id === "uk" ? " (VAT included)" : market.id === "au" ? " (GST included)" : ""
      }. The exact amount only shows at checkout, so this is the most it can be. It doesn’t come out of your payout.`,
      source: market.id === "au" ? S.marketplaceAu : S.marketplace,
    });
    if (us && taxRate) {
      buyerFees.push({
        id: "marketplace-tax",
        label: "Sales tax on the marketplace fee",
        amount: pct(amount, taxRate),
        kind: "tax",
        detail: `${formatRate(taxRate)} × ${money(amount)}`,
        explain: "In the US, sales tax is payable on the marketplace fee where it applies.",
        source: S.tos,
      });
    }
  }

  const notes: string[] = [];
  if (market.id === "au" && rules.buyerFee && item > 0) {
    notes.push(`Buyers in Australia see up to ${money(item + buyerFees[0].amount)} on your listing (your price plus the marketplace fee), with shipping shown separately.`);
  }
  if (market.id === "au" && !depopLabel) {
    notes.push(
      auDepopShippingRequired()
        ? "Since October 26, 2026, new listings in Australia must use Depop Shipping. Own shipping only applies to listings created before then."
        : "From October 26, 2026, new listings in Australia must use Depop Shipping (Australia Post). Own shipping will only apply to older listings.",
    );
  }
  if (us && !taxRate) notes.push("Processing is also charged on the sales tax your buyer pays. Add their tax rate under “More options” for the exact figure.");
  if (!rules.processing && !num(inputs, "paypalRate") && !num(inputs, "paypalFixed")) {
    notes.push("PayPal’s own fee isn’t included yet: add your PayPal rate under “More options”. The 10% selling fee is the same in any currency.");
  }
  if (!bool(inputs, "boosted")) {
    notes.push(
      `If the buyer saw this item as a boosted listing in the 28 days before buying, add ${formatRate(rules.boost)} of the item price${depopLabel ? "" : " and shipping"}. Turn on “Sold from a boosted listing?” to see it.`,
    );
  }

  const costs = costLines(inputs, market).filter((l) => !(depopLabel && l.id === "shippingCost"));

  return assemble({
    market,
    buyerPays: item + buyerShipping + tax + buyerFees.reduce((s, l) => s + l.amount, 0),
    saleAmount: item + ownShipping,
    fees,
    buyerFees,
    costs,
    notes: notes.slice(0, 3),
  });
}

function schedule(market: Market): ScheduleRow[] {
  const money = moneyFor(market);
  const rules = RULES[market.id] ?? RULES.us;
  const rows: ScheduleRow[] = [];
  if (rules.selling) {
    rows.push({
      fee: "Selling fee",
      amount: `${formatRate(rules.selling)} (VAT included)`,
      appliesTo: "Item price (excl. tax) + the shipping you charge; shown per item in a bundle",
      when: "Sellers outside the US, UK and Australia, selling in other currencies",
      source: S.fees,
    });
    rows.push({ fee: "Payment processing (PayPal)", amount: "Set by PayPal", appliesTo: "The payment PayPal receives", when: "Depop doesn’t publish it; check your PayPal account", source: S.fees });
  } else {
    rows.push({ fee: "Selling fee", amount: "0%", appliesTo: "—", when: `Sellers based in ${SELLER_PLACE[market.id]}, ${ZERO_SINCE[market.id]}`, source: S.fees });
    const p = rules.processing!;
    rows.push({
      fee: "Payment processing (Depop Payments)",
      amount: `${formatRate(p.rate)} + ${money(p.fixed)}`,
      appliesTo: market.id === "us" ? "Item price + shipping + sales tax" : "Item price + shipping + any tax",
      when: "Every sale (once per bundle)",
      source: S.fees,
    });
  }
  rows.push({
    fee: "Boosting fee",
    amount: formatRate(rules.boost),
    appliesTo: rules.carrier ? "Item price (excl. tax) + shipping if you ship yourself; never a Depop label" : "Item price (excl. tax) + the shipping you charge",
    when: "Buyer saw the boosted listing within 28 days before buying",
    source: market.id === "au" || market.id === "other" ? S.fees : S.boostPolicy,
  });
  if (rules.carrier) {
    rows.push({ fee: `Depop Shipping label (${rules.carrier})`, amount: "Paid by the buyer", appliesTo: "Deducted from your payout, covered by the buyer’s shipping", when: "When you use a Depop label", source: S.charges });
  }
  if (market.id === "us") {
    rows.push({ fee: "Shipping discount", amount: "$2, $3, $4 or the whole label", appliesTo: "Your payout", when: "If you offer one (iOS)", source: S.discounts });
  }
  if (rules.buyerFee) {
    const bf = rules.buyerFee;
    rows.push({
      fee: "Marketplace fee (paid by the buyer)",
      amount: `Up to ${formatRate(bf.rate)} + up to ${money(bf.fixed)}${market.id === "us" ? " + sales tax" : market.id === "uk" ? " (VAT incl.)" : " (GST incl.)"}`,
      appliesTo: "Item price, not shipping or tax",
      when: market.id === "au" ? "Every purchase; already included in the price buyers see" : "Every purchase, added at checkout",
      source: market.id === "au" ? S.marketplaceAu : S.marketplace,
    });
  }
  return rows;
}

export const depop: CalculatorDef = {
  slug: "depop",
  name: "Depop",
  path: "/depop-fee-calculator",
  category: "marketplaces",
  priceNoun: "item price",
  sellerNoun: "seller",
  blurb: "No selling fee + 3.3% + $0.45 processing; 12% if boosted (US)",
  markets: MARKETS,
  defaultMarket: "us",
  priceField: "price",
  fields: [
    { id: "price", kind: "money", label: "Item price", section: "sale", help: "What the buyer pays for the item, before shipping and tax. For a bundle, enter all items together." },
    {
      id: "salesTax",
      kind: "percent",
      label: "Buyer’s sales tax rate",
      section: "sale",
      advanced: true,
      max: 20,
      help: "Depop collects it for the state, but the 3.3% processing fee is charged on it too.",
      showIf: (_i, m) => m.id === "us",
    },
    {
      id: "shippingMethod",
      kind: "segmented",
      label: "How are you shipping?",
      section: "shipping",
      options: [
        { value: "depop", label: "Depop label" },
        { value: "own", label: "My own shipping" },
      ],
      help: "The buyer pays for a Depop label, so it nets to zero. Ship it yourself and a boosting fee also applies to the shipping you charge.",
      showIf: (_i, m) => Boolean(RULES[m.id]?.carrier),
    },
    {
      id: "labelPrice",
      kind: "money",
      label: "Label price the buyer pays",
      section: "shipping",
      help: "Shown when you pick the parcel size. Depop deducts it from your payout, so it isn’t your money, but the processing fee is charged on it.",
      showIf: (i, m) => shippingMethod(i, m) === "depop",
    },
    {
      id: "shippingCharged",
      kind: "money",
      label: "Shipping you charge",
      section: "shipping",
      help: "You get it with the sale and buy the postage yourself. Depop’s fees are charged on it too.",
      showIf: (i, m) => shippingMethod(i, m) === "own",
    },
    {
      id: "shippingDiscount",
      kind: "select",
      label: "Shipping discount you offer",
      section: "shipping",
      advanced: true,
      options: [
        { value: "none", label: "No discount" },
        { value: "2", label: "$2 off" },
        { value: "3", label: "$3 off" },
        { value: "4", label: "$4 off" },
        { value: "free", label: "Free shipping" },
      ],
      help: "US sellers on iOS can cover part or all of a Depop label. Depop takes the difference from your payout.",
      showIf: (i, m) => m.id === "us" && shippingMethod(i, m) === "depop",
    },
    {
      id: "boosted",
      kind: "toggle",
      label: "Sold from a boosted listing?",
      section: "options",
      help: "Yes if the buyer saw your “Boosted” tile in the 28 days before buying, even without clicking. 12% in the US and UK, 8% in Australia and elsewhere.",
    },
    {
      id: "boostOld",
      kind: "toggle",
      label: "Listing created before the 12% boost rate",
      section: "options",
      advanced: true,
      help: "Depop applies 12% to new listings from March 23, 2026 (UK: December 3, 2025). If your receipt shows 8%, turn this on.",
      showIf: (i, m) => (m.id === "us" || m.id === "uk") && bool(i, "boosted"),
    },
    {
      id: "paypalRate",
      kind: "percent",
      label: "Your PayPal fee rate",
      section: "options",
      advanced: true,
      max: 10,
      step: 0.01,
      help: "Depop doesn’t publish it: PayPal sets it by country and account type. Check your PayPal fees page.",
      showIf: (_i, m) => m.id === "other",
    },
    {
      id: "paypalFixed",
      kind: "money",
      label: "PayPal fixed fee per sale",
      section: "options",
      advanced: true,
      help: "The flat amount PayPal takes from each payment you receive, if your PayPal fees page lists one.",
      showIf: (_i, m) => m.id === "other",
    },
    { id: "itemCost", kind: "money", label: "What the item cost you", section: "costs", help: "What you paid for it, if you bought it to resell." },
    { id: "shippingCost", kind: "money", label: "Postage you pay", section: "costs", help: "Only when you ship it yourself.", showIf: (i, m) => shippingMethod(i, m) === "own" },
    { id: "otherCost", kind: "money", label: "Packaging & other", section: "costs" },
  ],
  defaults: (market) => ({
    price: market.id === "au" ? 40 : market.id === "uk" ? 25 : 30,
    salesTax: 0,
    shippingMethod: RULES[market.id]?.carrier ? "depop" : "own",
    labelPrice: market.id === "au" ? 10 : market.id === "uk" ? 3.5 : 6,
    shippingCharged: market.id === "other" ? 5 : market.id === "au" ? 10 : market.id === "uk" ? 3.5 : 6,
    shippingDiscount: "none",
    boosted: false,
    boostOld: false,
    paypalRate: 0,
    paypalFixed: 0,
    itemCost: 0,
    shippingCost: 0,
    otherCost: 0,
  }),
  calculate,
  // Every Depop fee is a straight percentage (plus a fixed part) of the price: no tiers, caps or minimums.
  breakpoints: () => [],
  verifiedAt: "2026-10-23",
  sources,
  changes,
  schedule,
  compare: {
    group: "sell",
    map: (c) => ({ price: c.price, shippingMethod: "own", shippingCharged: c.shipping, itemCost: c.itemCost, shippingCost: c.shippingCost }),
    note: "US seller shipping it themselves, not boosted; the buyer also pays up to 5% + $1",
  },
};

export default depop;
