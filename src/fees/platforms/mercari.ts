/*
 * Mercari (US) seller fees. Every number is from Mercari's own pages (see `sources`), verified
 * 2026-10-23 against the live pages. Research notes with verbatim quotes: research/fees/mercari.md.
 *
 * How an order is settled (what this module reproduces):
 *  - Selling fee: 10% of the item price (after any accepted offer) PLUS the shipping the buyer pays.
 *    Not charged on sales tax, on the buyer's 3.6% fee, or on a label the seller pays for.
 *  - Buyer Protection fee: 3.6% of the same base, added to the buyer's checkout (shown in
 *    `buyerFees`, never deducted from the seller). No payment processing fee since 2025-01-06.
 *  - Shipping with a Mercari prepaid label: buyer-paid → the buyer pays the label at checkout and the
 *    seller never receives that money; seller-paid ("free shipping") → the label is deducted from the
 *    seller's earnings. "Ship on your own": the seller buys postage elsewhere (a cost, not a deduction).
 *  - Cash-out: direct deposit free; Instant Pay $3 flat per cash-out (a payout line).
 *  - Mercari Authenticate ($5, certificate $10) is charged to the seller's card when photos are
 *    submitted, so it is a cost line, not a deduction from the sale.
 * Mercari doesn't publish its rounding; each line is rounded half up to the cent separately, the way
 * the Gross Sales Report lists them (item price, buyer/seller shipping fee, selling fee).
 *
 * `saleAmount` is the item price: buyer-paid shipping passes through Mercari to the carrier and
 * never reaches the seller, so the headline rate is fees ÷ item price (12% on a $40 item with a $7.99
 * buyer-paid label, not 10%).
 */
import { M } from "../markets";
import { assemble, costLines, formatRate, moneyFor, num, pct, str, toCents } from "../money";
import type { CalculatorDef, FeeChange, Inputs, Line, Market, ScheduleRow, Source } from "../types";

/** Selling fee, % of item price + buyer-paid shipping (listings created or updated since 2025-01-06). */
export const SELLING_RATE = 10;
/** Buyer Protection fee, % of item price + buyer-paid shipping, paid by the buyer. */
export const BUYER_PROTECTION_RATE = 3.6;
/** Instant Pay, cents per cash-out. */
export const INSTANT_PAY = 300;
/** Instant Pay monthly limit, cents ("up to $600 per month"). */
const INSTANT_PAY_MONTHLY = 60000;
/** Mercari Authenticate and the optional certificate, cents. */
const AUTHENTICATE = 500;
const CERTIFICATE = 1000;
/** Cancelation fee for sellers who cancel often: 5% of the item price, max $25. */
const CANCEL_RATE = 5;
const CANCEL_CAP = 2500;
/** Listing price limits, cents: $1–$2,000; up to $5,000 for Authenticate-eligible items with extra ID verification. */
const PRICE_MIN = 100;
const PRICE_MAX = 200000;
const PRICE_MAX_AUTH = 500000;

/**
 * Mercari prepaid label prices effective 2026-10-19 (Fees on Mercari and the Best vs Standard rates
 * article, identical on both pages), cents, keyed by label weight in lb: [Best rate, Standard rate].
 * Best rate = package up to 1 cubic foot with the longest side 22" or less; otherwise Standard.
 */
export const LABEL_RATES = {
  uspsGround: { "0.25": [539, 649], "0.5": [599, 749], "0.75": [739, 849], "1": [799, 899], "2": [1309, 1499], "3": [1399, 1699], "4": [1499, 1799], "5": [1599, 1899], "6": [1709, 1999], "7": [1799, 2099], "8": [1909, 2199], "9": [2099, 2299], "10": [2199, 2399], "11": [2599, 2799], "12": [2699, 2899], "13": [2799, 2999], "14": [2899, 3099], "15": [2999, 3199], "16": [3099, 3299], "17": [3199, 3499], "18": [3299, 3599], "19": [3499, 3799], "20": [3599, 3899] },
  uspsPriority: { "2": [1629, 1799], "3": [1999, 2099], "4": [2299, 2499], "5": [2499, 2699], "6": [2699, 2899], "7": [2999, 3199], "8": [3299, 3499], "9": [3499, 3699], "10": [3799, 3999], "11": [4099, 4299], "12": [4399, 4599], "13": [4699, 4899], "14": [4999, 5199], "15": [5199, 5399], "16": [5499, 5699], "17": [5799, 5999], "18": [6099, 6299], "19": [6399, 6599], "20": [6799, 6999] },
  upsSurePost: { "0.25": [794, 919], "0.5": [799, 929], "0.75": [804, 939], "1": [809, 979], "2": [849, 999], "3": [869, 1049], "4": [899, 1099], "5": [939, 1299] },
  upsGround: { "0.25": [1499, 1799], "0.5": [1509, 1799], "0.75": [1519, 1799], "1": [1549, 1799], "2": [1599, 1849], "3": [1649, 1899], "4": [1699, 1949], "5": [1729, 1999], "6": [1749, 2099], "7": [1779, 2199], "8": [1799, 2299], "9": [1829, 2399], "10": [1849, 2499], "11": [1879, 2599], "12": [1899, 2699], "13": [1899, 2799], "14": [2099, 3299], "15": [2299, 3399], "16": [2499, 3499], "17": [2699, 3599], "18": [2899, 3699], "19": [3099, 3899], "20": [3599, 4299], "30": [4099, 5599], "40": [4599, 9599], "50": [5099, 14099], "60": [8500, 19099], "70": [9000, 20099], "80": [11000, 25099], "90": [11500, 27599], "100": [12000, 35099] },
  fedexEconomy: { "0.25": [794, 919], "0.5": [799, 929], "0.75": [804, 939], "1": [809, 979], "2": [849, 999], "3": [869, 1049], "4": [899, 1099], "5": [939, 1299], "6": [1049, 1699], "7": [1099, 1799], "8": [1149, 1899], "9": [1199, 1999], "10": [1249, 2099] },
  fedexHome: { "0.25": [2099, 2299], "0.5": [2119, 2329], "0.75": [2129, 2349], "1": [2199, 2379], "2": [2219, 2399], "3": [2249, 2419], "4": [2299, 2449], "5": [2339, 2499], "6": [2369, 2549], "7": [2399, 2599], "8": [2449, 2699], "9": [2499, 2799], "10": [2549, 2899], "11": [2599, 2999], "12": [2649, 3099], "13": [2699, 3199], "14": [2749, 3349], "15": [2799, 3449], "16": [2819, 3449], "17": [2849, 3549], "18": [2899, 3649], "19": [3099, 3749], "20": [3599, 4299], "30": [4099, 7099], "40": [4599, 9599], "50": [5099, 16099], "60": [8500, 19099], "70": [9000, 20099], "80": [11000, 25099], "90": [11500, 27599], "100": [12000, 37599] },
} as const satisfies Record<string, Record<string, readonly [number, number]>>;

/** USPS Media Mail labels from 2026-10-19 (one price, no Best/Standard), cents by lb. */
export const MEDIA_MAIL = { "1": 447, "2": 522, "3": 597 } as const;

/** USPS First-Class Envelope labels (trading cards & paper collectibles), cents by oz. */
export const ENVELOPE = {
  promo: { "1": 0, "2": 49, "3": 49 },
  /** The non-promotional rates the fees page lists; Mercari says envelopes revert to "the then-current rate". */
  regular: { "1": 74, "2": 103, "3": 132 },
} as const;

/** $0 (1 oz) / 49¢ (2–3 oz) envelope promotion: through January 4, 2027 at 11:59 p.m. PT. */
export function envelopePromoActive(at: number = Date.now()): boolean {
  return at < Date.UTC(2027, 0, 5, 8, 0); // 2027-01-05 00:00 PST
}

/** Free buyer-paid shipping on $50+ orders: October 22, 2026 9:00 a.m. PT through January 4, 2027 4:59 p.m. PT. */
export function freeShipping50Active(at: number = Date.now()): boolean {
  const start = Date.UTC(2026, 9, 22, 16, 0); // 09:00 PDT
  const end = Date.UTC(2027, 0, 5, 1, 0); // 17:00 PST on Jan 4
  return at >= start && at < end;
}
const FREE_SHIPPING_MIN = 5000;

const S = {
  fees: "mercari-fees",
  change2025: "mercari-fee-change",
  buyerProtection: "mercari-buyer-protection",
  paid: "mercari-getting-paid",
  shipping: "mercari-shipping-sellers",
  bestRate: "mercari-best-rate",
  overweight: "mercari-overweight",
  shippingNews: "mercari-shipping-news",
  cancel: "mercari-cancelations",
  authenticate: "mercari-authenticate",
  salesTax: "mercari-sales-tax",
  grossSales: "mercari-gross-sales",
  listing: "mercari-listing",
  promote: "mercari-promote",
  freeShipping: "mercari-free-shipping-50",
  envelopes: "mercari-envelope-promo",
  tiers: "mercari-seller-tiers",
} as const;

const sources: Source[] = [
  { id: S.fees, title: "Fees on Mercari", url: "https://www.mercari.com/us/help_center/article/169/", publisher: "Mercari Help", checked: "2026-10-23" },
  { id: S.change2025, title: "Changes to our fee structure", url: "https://www.mercari.com/us/help_center/article/2517/", publisher: "Mercari Help", checked: "2026-10-23" },
  { id: S.buyerProtection, title: "Buyer Protection", url: "https://www.mercari.com/us/help_center/article/235/", publisher: "Mercari Help", checked: "2026-10-23" },
  { id: S.paid, title: "Getting Paid", url: "https://www.mercari.com/us/help_center/topics/payouts/guides/getting-paid/", publisher: "Mercari Help", checked: "2026-10-23" },
  { id: S.shipping, title: "Shipping for Sellers", url: "https://www.mercari.com/us/help_center/topics/shipping/guides/shipping-for-sellers/", publisher: "Mercari Help", checked: "2026-10-23" },
  { id: S.bestRate, title: "New shipping pricing structure with Best vs Standard rates", url: "https://www.mercari.com/us/help_center/article/632/", publisher: "Mercari Help", checked: "2026-10-23" },
  { id: S.overweight, title: "Why was I charged for an overweight or oversized package?", url: "https://www.mercari.com/us/help_center/article/172/", publisher: "Mercari Help", checked: "2026-10-23" },
  { id: S.shippingNews, title: "Mercari shipping change announcements", url: "https://www.mercari.com/us/help_center/article/485/", publisher: "Mercari Help", checked: "2026-10-23" },
  { id: S.cancel, title: "Cancelations on Mercari", url: "https://www.mercari.com/us/help_center/article/251/", publisher: "Mercari Help", checked: "2026-10-23" },
  { id: S.authenticate, title: "What are Authenticate fees and certificates?", url: "https://www.mercari.com/us/help_center/article/508/", publisher: "Mercari Help", checked: "2026-10-23" },
  { id: S.salesTax, title: "Sales Tax for Sellers", url: "https://www.mercari.com/us/help_center/article/467/", publisher: "Mercari Help", checked: "2026-10-23" },
  { id: S.grossSales, title: "How to access my Gross Sales Report", url: "https://www.mercari.com/us/help_center/article/541/", publisher: "Mercari Help", checked: "2026-10-23" },
  { id: S.listing, title: "Creating a Listing", url: "https://www.mercari.com/us/help_center/topics/listing/guides/creating-a-listing/", publisher: "Mercari Help", checked: "2026-10-23" },
  { id: S.promote, title: "How does the “Promote” button work?", url: "https://www.mercari.com/us/help_center/article/347/", publisher: "Mercari Help", checked: "2026-10-23" },
  { id: S.freeShipping, title: "Shop Free Shipping on orders $50+", url: "https://lp.us.mercari.com/free-shipping-50/", publisher: "Mercari", checked: "2026-10-23" },
  { id: S.envelopes, title: "Mercari Limited-time Shipping Deals", url: "https://lp.us.mercari.com/shippingpromotion", publisher: "Mercari", checked: "2026-10-23" },
  // Blocks plain HTTP (Cloudflare challenge); read in a browser. No machine-readable twin.
  { id: S.tiers, title: "Seller Tiers", url: "https://www.mercari.com/us/seller-tiers/", publisher: "Mercari", checked: "2026-10-23" },
];

const changes: FeeChange[] = [
  {
    date: "2027-01-04",
    text: "Free shipping for buyers on $50+ orders ends at 4:59 p.m. PT.",
    source: S.freeShipping,
    upcoming: true,
  },
  {
    date: "2027-01-04",
    text: "First-Class Envelope promotion for trading cards ends at 11:59 p.m. PT: $0 (1 oz) and $0.49 (2–3 oz) labels go back to the then-current rate (the fees page lists $0.74, $1.03 and $1.32).",
    source: S.envelopes,
    upcoming: true,
  },
  {
    date: "2026-10-22",
    text: "Holiday promotion: buyer-paid shipping is free for the buyer on $50+ single items with a Best-rate label of 5 lb or less (not USPS Priority Mail, UPS Ground or FedEx Home) and on $50+ bundles up to 5 lb.",
    source: S.freeShipping,
  },
  {
    date: "2026-10-19",
    text: "New prepaid label prices for all new and existing listings, buyer- and seller-paid. USPS Ground Advantage 1 lb: $7.48 → $7.99 (Best rate), $7.59 → $8.99 (Standard). Media Mail 1 lb: $4.99 → $4.47.",
    source: S.fees,
  },
  {
    date: "2026-09-17",
    text: "1 oz First-Class Envelope labels for trading cards and paper collectibles became free, and the 49¢ rate for 1–3 oz was extended to January 4, 2027.",
    source: S.shippingNews,
  },
  {
    date: "2026-09-01",
    text: "USPS charges $50 when a package still shows an old HAZMAT label. Mercari now deducts half of it, $25, from the seller’s earnings.",
    source: S.overweight,
  },
  {
    date: "2026-05-07",
    text: "USPS Ground Advantage and Priority Mail label prices went up to reflect USPS’s 8% fuel surcharge (Media Mail and First-Class Envelopes unchanged).",
    source: S.shippingNews,
  },
  {
    date: "2026-03-19",
    text: "Seller Tiers beta until May 14, 2026: some sellers paid a lower selling fee as their completed sales grew. Mercari showed the reduced rates only to participants; the standard fee stayed 10%.",
    source: S.tiers,
  },
  {
    date: "2026-01-20",
    text: "Standard-rate label prices went up (about 4.7% on average across all labels); Best-rate prices didn’t change. Existing listings updated from February 16.",
    source: S.shippingNews,
  },
  {
    date: "2025-07-28",
    text: "Best-rate labels introduced for packages up to 1 cubic foot with the longest side 22 inches or less, about 6% cheaper than Standard on average. USPS labels rose 2% on average.",
    source: S.shippingNews,
  },
  {
    date: "2025-03-10",
    text: "An 8% penalty on the adjusted shipping price was added for underpaid (overweight or oversized) labels. Mercari’s current fee and overweight-package pages no longer list it.",
    source: S.shippingNews,
  },
  {
    date: "2025-02-18",
    text: "Prepaid labels up 1% on average; USPS Ground Advantage extended to 20 lb.",
    source: S.shippingNews,
  },
  {
    date: "2025-01-06",
    text: "Selling fee reinstated: 10% of the item price and buyer-paid shipping (it had been 0% on new listings). Buyers now pay a flat 3.6% Buyer Protection fee instead of a service fee plus 2.9% + $0.50 processing. Direct deposit became free (was $2 per cash-out).",
    source: S.change2025,
  },
  {
    date: "2024-03-27",
    text: "Selling fee dropped to 0% on new listings, so sellers kept the whole item price; buyers paid a service fee plus a 2.9% + $0.50 payment processing fee instead (until January 5, 2025).",
    source: S.grossSales,
  },
];

type Payer = "buyer" | "seller" | "own";

function payerOf(inputs: Inputs): Payer {
  const p = str(inputs, "shippingPayer", "buyer");
  return p === "seller" || p === "own" ? p : "buyer";
}

function calculate(inputs: Inputs, market: Market) {
  const money = moneyFor(market);
  const price = toCents(num(inputs, "price"));
  const payer = payerOf(inputs);
  const label = payer === "own" ? 0 : toCents(num(inputs, "labelPrice"));
  const buyerShipping = payer === "buyer" ? label : 0;
  const base = price + buyerShipping; // selling fee and Buyer Protection base
  const instant = str(inputs, "cashOut", "deposit") === "instant";

  const fees: Line[] = [];
  fees.push({
    id: "selling",
    label: "Selling fee",
    amount: pct(base, SELLING_RATE),
    kind: "platform",
    detail: buyerShipping ? `10% × (${money(price)} item + ${money(buyerShipping)} shipping)` : `10% × ${money(price)}`,
    explain: buyerShipping
      ? "Mercari’s 10% is charged on the item price plus the shipping the buyer pays, when the order completes. That’s why it comes to more than 10% of your price. Sales tax and the buyer’s 3.6% fee aren’t included."
      : "10% of the item price, charged when the order completes. Shipping you pay for yourself isn’t included, and neither is sales tax.",
    source: S.fees,
  });

  if (payer === "seller" && label > 0) {
    fees.push({
      id: "label",
      label: "Shipping label (you pay)",
      amount: label,
      kind: "shipping",
      detail: "Mercari prepaid label, taken from your earnings",
      explain: "You offered free shipping, so Mercari deducts the prepaid label from what you earn. The 10% fee isn’t charged on it.",
      source: S.shipping,
    });
  }

  const adjustment = payer === "own" ? 0 : toCents(num(inputs, "shippingAdjustment"));
  if (adjustment > 0) {
    fees.push({
      id: "adjustment",
      label: "Shipping adjustment",
      amount: adjustment,
      kind: "shipping",
      detail: "Extra postage for the measured weight or size",
      explain:
        "When the carrier measures the package heavier or bigger than the label, Mercari deducts the label price for the real weight minus what was already paid, even if the buyer paid for shipping. Over 1 lb, weights round up to the next pound.",
      source: S.overweight,
    });
  }

  if (instant) {
    fees.push({
      id: "instantpay",
      label: "Instant Pay",
      amount: INSTANT_PAY,
      kind: "payout",
      detail: "$3.00 flat per cash-out",
      explain:
        "Instant Pay sends your balance to a Visa or Mastercard debit card in about 30 minutes for $3, whatever the amount (cash out several sales at once and they share it). Once a day, up to $600 a month. Direct deposit is free and takes about 5 business days.",
      source: S.fees,
    });
  }

  const buyerFees: Line[] = [];
  if (buyerShipping > 0) {
    buyerFees.push({
      id: "buyershipping",
      label: "Shipping (prepaid label)",
      amount: buyerShipping,
      kind: "shipping",
      detail: "Added at checkout",
      explain: "Mercari adds the label price to the buyer’s checkout and uses it to pay the carrier. It never reaches you, but the 10% selling fee is charged on it.",
      source: S.shipping,
    });
  }
  const protection = pct(base, BUYER_PROTECTION_RATE);
  buyerFees.push({
    id: "buyerprotection",
    label: "Buyer Protection fee",
    amount: protection,
    kind: "other",
    detail: `${formatRate(BUYER_PROTECTION_RATE)} × ${money(base)}`,
    explain: "Mercari adds 3.6% of the item price and buyer-paid shipping to the buyer’s checkout. It isn’t taken from you. Sales tax, where it applies, comes on top.",
    source: S.buyerProtection,
  });

  const costs = costLines({ ...inputs, ownPostage: payer === "own" ? inputs.ownPostage : 0 }, market, { label: "ownPostage" });
  const auth = str(inputs, "authenticate", "none");
  if (auth === "auth" || auth === "cert") {
    costs.push({
      id: "authenticate",
      label: auth === "cert" ? "Mercari Authenticate + certificate" : "Mercari Authenticate",
      amount: auth === "cert" ? AUTHENTICATE + CERTIFICATE : AUTHENTICATE,
      kind: "cost",
      detail: auth === "cert" ? "$5 authentication + $10 certificate" : "$5 per item",
      explain: "Charged to your card when you submit photos, not taken from the sale. Refunded the first time an item is found not authentic.",
      source: S.authenticate,
    });
  }

  const totalFees = fees.reduce((s, l) => s + l.amount, 0);
  const payout = price - totalFees;
  const notes: string[] = [];
  const promo = freeShipping50Active() && price >= FREE_SHIPPING_MIN;
  if (promo && payer === "buyer" && buyerShipping > 0) {
    notes.push(
      "Until January 4, 2027, the buyer gets this shipping free if the label is a Best rate of 5 lb or less (not USPS Priority, UPS Ground or FedEx Home). Mercari hasn’t said whether its 10% still counts the shipping; this assumes it does.",
    );
  } else if (promo && payer === "seller" && label > 0) {
    const asBuyerPaid = price - pct(price + label, SELLING_RATE) - adjustment - (instant ? INSTANT_PAY : 0);
    notes.push(
      `Until January 4, 2027, $50+ items ship free for the buyer when shipping is set to buyer-paid with a Best-rate label of 5 lb or less. Switching would leave you about ${money(asBuyerPaid)} instead of ${money(payout)}, if Mercari still takes 10% of the shipping.`,
    );
  }
  if (payer === "buyer" && buyerShipping > 0 && !promo) {
    notes.push(`Free shipping costs you the same: price it at ${money(price + buyerShipping)}, set shipping to “Me”, and you still keep ${money(payout)}. The buyer’s total doesn’t change either.`);
  } else if (payer === "seller" && label > 0 && price - label >= PRICE_MIN && !promo) {
    notes.push(`Buyer-paid shipping works out the same: list at ${money(price - label)} with the buyer paying the ${money(label)} label and you still keep ${money(payout)}.`);
  }
  if (payer === "own") {
    notes.push(
      `Mercari doesn’t deduct postage you buy yourself, and the package isn’t covered by Mercari’s Shipping Protection.${toCents(num(inputs, "ownPostage")) ? "" : " Enter your postage to see your profit."}`,
    );
  }
  if (instant && payout + INSTANT_PAY > INSTANT_PAY_MONTHLY) {
    notes.push(`Instant Pay is limited to ${money(INSTANT_PAY_MONTHLY)} a month; the rest of this balance would go by free direct deposit.`);
  }
  if (price > 0) {
    notes.push(`If you cancel orders often, Mercari can charge 5% of the item price, ${money(Math.min(pct(price, CANCEL_RATE), CANCEL_CAP))} on this one (never more than $25).`);
  }

  const warnings: string[] = [];
  if (price > 0 && price < PRICE_MIN) warnings.push("Mercari’s lowest listing price is $1.");
  else if (price > PRICE_MAX_AUTH) warnings.push("Mercari doesn’t allow listings over $5,000, even for authenticated items.");
  else if (price > PRICE_MAX && auth === "none") warnings.push("Mercari’s price limit is $2,000. Items verified with Mercari Authenticate can go up to $5,000 after an extra ID check.");

  return assemble({
    market,
    buyerPays: price + buyerShipping + protection,
    saleAmount: price,
    fees,
    buyerFees,
    costs,
    notes: notes.slice(0, 3),
    warnings,
  });
}

function schedule(market: Market): ScheduleRow[] {
  const money = moneyFor(market);
  const envelope = envelopePromoActive()
    ? { amount: "$0 (1 oz), $0.49 (2–3 oz)", when: "Trading cards and paper collectibles; promotion until Jan 4, 2027" }
    : { amount: "$0.74 / $1.03 / $1.32 (1 / 2 / 3 oz)", when: "Trading cards and paper collectibles" };
  return [
    { fee: "Selling fee", amount: "10%", appliesTo: "Item price + shipping the buyer pays (not sales tax)", when: "When the order completes", source: S.fees },
    { fee: "Buyer Protection fee", amount: "3.6%, paid by the buyer", appliesTo: "Item price + shipping the buyer pays", when: "Added at the buyer’s checkout", source: S.buyerProtection },
    { fee: "Payment processing", amount: "None", appliesTo: "—", when: "Listings created or updated since Jan 6, 2025", source: S.fees },
    {
      fee: "Prepaid shipping label",
      amount: `From ${money(LABEL_RATES.uspsGround["0.25"][0])} (USPS Ground Advantage, 4 oz, Best rate)`,
      appliesTo: "Paid by the buyer at checkout, or taken from your earnings if you offer free shipping",
      when: "Orders shipped with a Mercari label",
      source: S.fees,
    },
    { fee: "Media Mail label", amount: `${[MEDIA_MAIL["1"], MEDIA_MAIL["2"], MEDIA_MAIL["3"]].map(money).join(" / ")} (1 / 2 / 3 lb)`, appliesTo: "Each label, one price (no Best or Standard rate)", when: "Books, movies and music only", source: S.fees },
    { fee: "First-Class Envelope label", amount: envelope.amount, appliesTo: "Each envelope label", when: envelope.when, source: S.fees },
    { fee: "Shipping adjustment", amount: "Label for the real weight − label paid", appliesTo: "Overweight or oversized packages", when: "When the carrier measures more than the label", source: S.overweight },
    { fee: "Old HAZMAT label on the box", amount: "$25 (half of USPS’s $50)", appliesTo: "Taken from your earnings", when: "Packages postmarked from Sep 1, 2026", source: S.overweight },
    { fee: "Direct deposit", amount: "Free ($2 if it fails)", appliesTo: "Each cash-out to your checking account", when: "Once a day", source: S.fees },
    { fee: "Instant Pay", amount: "$3", appliesTo: "Each cash-out to a debit card", when: "Once a day, up to $600 a month", source: S.fees },
    { fee: "Cancelation fee", amount: "5%, max $25", appliesTo: "Item price", when: "Sellers who cancel often", source: S.fees },
    { fee: "Mercari Authenticate", amount: "$5 (+$10 certificate)", appliesTo: "Each designer item submitted", when: "Charged to your card at submission", source: S.authenticate },
  ];
}

const notOwn = (i: Inputs) => payerOf(i) !== "own";

export const mercari: CalculatorDef = {
  slug: "mercari",
  name: "Mercari",
  path: "/mercari-fee-calculator",
  category: "marketplaces",
  priceNoun: "item price",
  sellerNoun: "seller",
  blurb: "10% of item + buyer-paid shipping; buyer pays 3.6% (US)",
  markets: [M.us],
  defaultMarket: "us",
  priceField: "price",
  fields: [
    { id: "price", kind: "money", label: "Item price", section: "sale", help: "What it sells for, after any offer you accept. Mercari allows $1 to $2,000." },
    {
      id: "shippingPayer",
      kind: "segmented",
      label: "Who pays for shipping?",
      section: "shipping",
      options: [
        { value: "buyer", label: "Buyer" },
        { value: "seller", label: "Me" },
        { value: "own", label: "Own label" },
      ],
      help: (i) =>
        payerOf(i) === "seller"
          ? "Free shipping: the Mercari label comes out of your earnings, and the 10% isn’t charged on it."
          : payerOf(i) === "own"
            ? "You buy postage elsewhere and pay all of it; Mercari’s 10% is on the item price only."
            : "The buyer pays the Mercari label at checkout. It never reaches you, but Mercari takes 10% of it too.",
    },
    {
      id: "labelPrice",
      kind: "money",
      label: "Mercari label price",
      section: "shipping",
      help: "Mercari shows it when you pick the weight. USPS Ground Advantage at the Best rate: $5.99 up to 8 oz, $7.99 up to 1 lb.",
      showIf: notOwn,
    },
    {
      id: "ownPostage",
      kind: "money",
      label: "Postage you pay elsewhere",
      section: "shipping",
      help: "You ship outside Mercari and pay all postage; it counts as your cost.",
      showIf: (i) => payerOf(i) === "own",
    },
    {
      id: "shippingAdjustment",
      kind: "money",
      label: "Extra shipping charged after the sale",
      section: "shipping",
      advanced: true,
      help: "Package heavier or bigger than the label? Mercari deducts the difference from your earnings.",
      showIf: notOwn,
    },
    {
      id: "cashOut",
      kind: "segmented",
      label: "How will you cash out?",
      section: "options",
      options: [
        { value: "deposit", label: "Direct deposit · free" },
        { value: "instant", label: "Instant Pay · $3" },
      ],
      help: "Instant Pay reaches your debit card in about 30 minutes; direct deposit takes about 5 business days.",
    },
    {
      id: "authenticate",
      kind: "segmented",
      label: "Mercari Authenticate",
      section: "options",
      advanced: true,
      options: [
        { value: "none", label: "No" },
        { value: "auth", label: "Yes · $5" },
        { value: "cert", label: "+ certificate · $15" },
      ],
      help: "For designer bags, wallets, shoes, eyewear, jewelry and watches (no certificate for jewelry or watches). Charged to your card when you submit photos.",
    },
    { id: "itemCost", kind: "money", label: "What the item cost you", section: "costs", help: "What you paid for it." },
    { id: "otherCost", kind: "money", label: "Packaging & other", section: "costs" },
  ],
  defaults: () => ({
    price: 30,
    shippingPayer: "buyer",
    labelPrice: 7.99,
    ownPostage: 0,
    shippingAdjustment: 0,
    cashOut: "deposit",
    authenticate: "none",
    itemCost: 0,
    otherCost: 0,
  }),
  calculate,
  // Every fee is a straight percentage of the price or a flat amount: the payout never drops as the price rises.
  breakpoints: () => [],
  verifiedAt: "2026-10-23",
  sources,
  changes,
  schedule,
  compare: {
    group: "sell",
    map: (c) =>
      c.shipping > 0
        ? { price: c.price, shippingPayer: "buyer", labelPrice: c.shipping, itemCost: c.itemCost }
        : { price: c.price, shippingPayer: "seller", labelPrice: c.shippingCost, itemCost: c.itemCost },
    note: "The buyer’s shipping pays the Mercari label (you pay it when shipping is $0); direct deposit",
  },
};

export default mercari;
