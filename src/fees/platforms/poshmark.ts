/*
 * Poshmark seller fees on poshmark.com (US) and poshmark.ca (Canada). Every number is from
 * Poshmark's own pages (see `sources`), re-read on 2026-10-23; the Canadian GST/HST rates by
 * province are from the Canada Revenue Agency. Research notes with verbatim quotes:
 * research/fees/poshmark.md.
 *
 * What this module reproduces:
 *  - Seller fee on the final order price (listing price, accepted offer or bundle total after the
 *    bundle discount; never shipping or sales tax): US $2.95 flat under $15, 20% at $15.00 and up
 *    (Fee Policy v1.7). Canada C$3.95 flat under C$20, 20% at C$20.00 and up (Canada Fee Policy
 *    v1.0). Because the flat fee turns into 20% at the threshold, the payout DROPS there:
 *    $14.99 keeps $12.04 but $15.00 keeps $12.00. `breakpoints()` returns the threshold so the
 *    reverse solver finds the true lowest price.
 *  - Canada: GST/HST on Poshmark's fee at the seller's province rate (CRA table), plus 7% B.C. PST
 *    on the fee when a B.C. seller sells to a B.C. buyer.
 *  - US Texas Seller Fee Tax: (6.25% state + local rate) × 80% of the seller fee.
 *  - Shipping: the buyer pays the flat label (US $6.49 up to 5 lb; Canada C$12.49 Canada Post or
 *    C$6.99 Purolator Pick Up, up to 2.5 kg) — shown on the buyer side, never deducted. A shipping
 *    discount the seller offers, and the heavier-label upgrade, come out of the seller's earnings.
 *  - Cash-out fees (Instant Transfer, PayPal, Venmo) are per transfer, optional.
 * Poshmark doesn't document its rounding (its Texas example shows "$1.320"); each line is rounded
 * to the cent separately, half away from zero, the way the sales report lists them.
 */
import { M } from "../markets";
import { assemble, bool, costLines, formatMoney, formatRate, moneyFor, num, pct, roundCents, str, toCents } from "../money";
import type { CalculatorDef, FeeChange, Inputs, Line, Market, ScheduleRow, SelectOption, Source } from "../types";

const MARKETS: Market[] = [M.us, M.ca];

interface MarketRules {
  /** Sales below this (cents) pay the flat fee; at or above it, the percentage. */
  threshold: number;
  flat: number;
  rate: number;
}

const RULES: Record<string, MarketRules> = {
  us: { threshold: 1500, flat: 295, rate: 20 },
  ca: { threshold: 2000, flat: 395, rate: 20 },
};

/** US prepaid label paid by the buyer (Ground Advantage, up to 5 lb incl. packaging) since 2025-09-12. */
const US_LABEL = 649;
/** Canadian buyer shipping options (plus tax, paid by the buyer). */
const CA_SHIPPING: Record<string, { label: string; amount: number }> = {
  canadapost: { label: "Canada Post Home Delivery", amount: 1249 },
  purolator: { label: "Purolator Pick Up", amount: 699 },
};

/** An array (not an object) so the bands keep their order: "3" would sort before "2.5" as an object key. */
interface WeightBand {
  value: string;
  label: string;
  fee: number;
  /** Deducted only from this date (the "over 15 lb on one label" charge). */
  fromDeductionDate?: boolean;
}

/** US heavier-label upgrade (help article 828450089; Shipping Policy v1.3, 2026-02-13). */
const US_WEIGHT: WeightBand[] = [
  { value: "5", label: "Up to 5 lb", fee: 0 },
  { value: "10", label: "5.01–10 lb", fee: 500 },
  { value: "15", label: "10.01–15 lb", fee: 1000 },
  { value: "25", label: "15.01–25 lb on one label", fee: 1500, fromDeductionDate: true },
];

/** Canadian heavier-label upgrade, plus GST/HST on it (help article How-do-I-get-a-label-for-an-overweight-package). */
const CA_WEIGHT: WeightBand[] = [
  { value: "2.5", label: "Up to 2.5 kg", fee: 0 },
  { value: "3", label: "Up to 3 kg", fee: 100 },
  { value: "3.5", label: "Up to 3.5 kg", fee: 200 },
  { value: "4", label: "Up to 4 kg", fee: 300 },
  { value: "4.5", label: "Up to 4.5 kg", fee: 400 },
  { value: "5", label: "Up to 5 kg", fee: 500 },
];

/** GST/HST by province (Canada Revenue Agency, "GST/HST calculator (and rates)", read 2026-10-23). */
const PROVINCES: Record<string, { name: string; rate: number; tax: "GST" | "HST" }> = {
  ab: { name: "Alberta", rate: 5, tax: "GST" },
  bc: { name: "British Columbia", rate: 5, tax: "GST" },
  mb: { name: "Manitoba", rate: 5, tax: "GST" },
  nb: { name: "New Brunswick", rate: 15, tax: "HST" },
  nl: { name: "Newfoundland and Labrador", rate: 15, tax: "HST" },
  nt: { name: "Northwest Territories", rate: 5, tax: "GST" },
  ns: { name: "Nova Scotia", rate: 14, tax: "HST" },
  nu: { name: "Nunavut", rate: 5, tax: "GST" },
  on: { name: "Ontario", rate: 13, tax: "HST" },
  pe: { name: "Prince Edward Island", rate: 15, tax: "HST" },
  qc: { name: "Quebec", rate: 5, tax: "GST" },
  sk: { name: "Saskatchewan", rate: 5, tax: "GST" },
  yt: { name: "Yukon", rate: 5, tax: "GST" },
};
/** B.C. PST on Poshmark's fee for B.C.-to-B.C. sales (since 2022-08-01; 7% per the CRA table). */
const BC_PST = 7;

/** Cash-out fees per transfer (redemption options help articles). */
const CASH_OUT: Record<string, Record<string, { fee: number; line: string }>> = {
  us: {
    free: { fee: 0, line: "Direct deposit" },
    paypal: { fee: 35, line: "PayPal / Venmo transfer fee" },
    instant: { fee: 200, line: "Instant Transfer fee" },
  },
  ca: {
    free: { fee: 0, line: "Direct deposit" },
    paypal: { fee: 50, line: "PayPal transfer fee" },
    instant: { fee: 200, line: "Visa Instant Transfer fee" },
  },
};

/** Texas: 6.25% state sales tax plus local; Poshmark's own example uses 8.25% combined. */
const TEXAS_STATE_RATE = 6.25;
/** Texas caps combined state + local sales tax at 8.25%, the rate Poshmark's example uses. */
const TEXAS_MAX_RATE = 8.25;

/**
 * From October 26, 2026 Poshmark deducts heavier-label costs from earnings when a package ships
 * without the right label, including $15.00 for 15.01–25 lb on a single label. Poshmark is based
 * in California, so the switch is taken at midnight Pacific time (07:00 UTC).
 */
export const OVERWEIGHT_DEDUCTION_FROM = Date.UTC(2026, 9, 26, 7, 0);
export function overweightDeductionActive(at: number = Date.now()): boolean {
  return at >= OVERWEIGHT_DEDUCTION_FROM;
}

const S = {
  fee: "posh-fee-policy",
  ship: "posh-shipping-policy",
  helpFees: "posh-help-fees",
  helpShip: "posh-help-shipping",
  overweight: "posh-overweight",
  upgrades: "posh-blog-upgrades",
  heavier: "posh-blog-heavier",
  texas: "posh-texas",
  discount: "posh-shipping-discount",
  likers: "posh-offer-likers",
  redeem: "posh-redeem",
  boxes: "posh-boxes",
  hazmat: "posh-blog-hazmat",
  lowerShip: "posh-blog-lower-shipping",
  caFee: "poshca-fee-policy",
  caHelpFees: "poshca-help-fees",
  caTax: "poshca-tax",
  caShip: "poshca-shipping",
  caOverweight: "poshca-overweight",
  caRedeem: "poshca-redeem",
  purolator: "poshca-blog-purolator",
  cra: "cra-gst-hst",
} as const;

const sources: Source[] = [
  { id: S.fee, title: "Fee Policy (Poshmark Legal Center, version 1.7)", url: "https://poshmark.com/terms#fee-policy", publisher: "Poshmark", checked: "2026-10-23", watch: "https://poshmark.com/terms" },
  { id: S.ship, title: "Shipping Policy (Poshmark Legal Center, version 1.3)", url: "https://poshmark.com/terms#shipping-policy", publisher: "Poshmark", checked: "2026-10-23", watch: "https://poshmark.com/terms" },
  { id: S.helpFees, title: "What are the fees for selling on Poshmark?", url: "https://support.poshmark.com/s/article/297755057?language=en_US", publisher: "Poshmark Support", checked: "2026-10-23" },
  { id: S.helpShip, title: "What are the shipping rates on Poshmark?", url: "https://support.poshmark.com/s/article/975218789?language=en_US", publisher: "Poshmark Support", checked: "2026-10-23" },
  { id: S.overweight, title: "How to get an overweight or additional shipping label", url: "https://support.poshmark.com/s/article/828450089?language=en_US", publisher: "Poshmark Support", checked: "2026-10-23" },
  {
    id: S.upgrades,
    title: "Shipping Heavier Items: How Label Upgrades Work",
    url: "https://blog.poshmark.com/2026/10/08/shipping-heavier-items-how-label-upgrades-work/",
    publisher: "Poshmark Blog (official)",
    checked: "2026-10-23",
  },
  {
    id: S.heavier,
    title: "Shipping Heavier Items on Poshmark is Now Simpler and Cheaper",
    url: "https://blog.poshmark.com/2026/02/13/shipping-heavier-items-on-poshmark-is-now-simpler-and-cheaper/",
    publisher: "Poshmark Blog (official)",
    checked: "2026-10-23",
  },
  { id: S.texas, title: "What is Texas Seller Fee Tax?", url: "https://support.poshmark.com/s/article/Texas-Seller-Fee-Tax?language=en_US", publisher: "Poshmark Support", checked: "2026-10-23" },
  { id: S.discount, title: "What is a listing shipping discount?", url: "https://support.poshmark.com/s/article/listing-shipping-discount?language=en_US", publisher: "Poshmark Support", checked: "2026-10-23" },
  { id: S.likers, title: "How to send an offer to likers", url: "https://support.poshmark.com/s/article/759242802?language=en_US", publisher: "Poshmark Support", checked: "2026-10-23" },
  { id: S.redeem, title: "What are Poshmark’s redemption options?", url: "https://support.poshmark.com/s/article/redemption-options?language=en_US", publisher: "Poshmark Support", checked: "2026-10-23" },
  { id: S.boxes, title: "What kind of box can I use to ship out my order?", url: "https://support.poshmark.com/s/article/160939138?language=en_US", publisher: "Poshmark Support", checked: "2026-10-23" },
  {
    id: S.hazmat,
    title: "USPS HAZMAT Fee Update: How to Avoid the $50 Fee",
    url: "https://blog.poshmark.com/2026/10/05/usps-hazmat-fee-update-how-to-avoid-the-50-fee/",
    publisher: "Poshmark Blog (official)",
    checked: "2026-10-23",
  },
  {
    id: S.lowerShip,
    title: "Lower shipping starting September 12th",
    url: "https://blog.poshmark.com/2025/09/08/lower-shipping-starting-september-12th/",
    publisher: "Poshmark Blog (official)",
    checked: "2026-10-23",
  },
  { id: S.caFee, title: "Canada Fee Policy (Poshmark Legal Center, version 1.0)", url: "https://poshmark.ca/terms#fee-policy-ca", publisher: "Poshmark Canada", checked: "2026-10-23", watch: "https://poshmark.ca/terms" },
  {
    id: S.caHelpFees,
    title: "What are the fees for selling on Poshmark? (Canada)",
    url: "https://support.poshmark.ca/s/article/What-are-the-fees-for-selling-on-Poshmark-CA?language=en_US",
    publisher: "Poshmark Canada Support",
    checked: "2026-10-23",
  },
  { id: S.caTax, title: "How is tax calculated on Poshmark?", url: "https://support.poshmark.ca/s/article/How-is-tax-calculated?language=en_US", publisher: "Poshmark Canada Support", checked: "2026-10-23" },
  {
    id: S.caShip,
    title: "What are the shipping rates on Poshmark? (Canada)",
    url: "https://support.poshmark.ca/s/article/What-are-the-shipping-rates-on-Poshmark-CA?language=en_US",
    publisher: "Poshmark Canada Support",
    checked: "2026-10-23",
  },
  {
    id: S.caOverweight,
    title: "How to get an overweight shipping label (Canada)",
    url: "https://support.poshmark.ca/s/article/How-do-I-get-a-label-for-an-overweight-package?language=en_US",
    publisher: "Poshmark Canada Support",
    checked: "2026-10-23",
  },
  { id: S.caRedeem, title: "What are Poshmark’s redemption options? (Canada)", url: "https://support.poshmark.ca/s/article/redemption-options-CA?language=en_US", publisher: "Poshmark Canada Support", checked: "2026-10-23" },
  {
    id: S.purolator,
    title: "Canada, C$6.99 Shipping is Here: Purolator Pick Up",
    url: "https://blog.poshmark.com/2026/05/26/canada-c6-99-shipping-is-here-purolator-pick-up/",
    publisher: "Poshmark Blog (official)",
    checked: "2026-10-23",
  },
  {
    id: S.cra,
    title: "GST/HST calculator (and rates)",
    url: "https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-which-rate/calculator.html",
    publisher: "Canada Revenue Agency",
    checked: "2026-10-23",
  },
];

const changes: FeeChange[] = [
  {
    date: "2026-10-26",
    text: "US packages over 5 lb shipped without an upgraded label: the upgrade ($5.00 for 5.01–10 lb, $10.00 for 10.01–15 lb) is deducted from earnings instead of being covered by Poshmark. Packages over 15 lb on one label: $15.00 for 15.01–25 lb, the full USPS cost above 25 lb.",
    source: S.upgrades,
    upcoming: true,
  },
  {
    date: "2026-10-19",
    text: "USPS hazmat non-compliance fee: sellers now pay the full $50 when USPS flags a package (Poshmark had covered $45 of it since August 1, 2026, and all of it through July 31).",
    source: S.boxes,
  },
  { date: "2026-05-26", text: "Canada: Purolator Pick Up shipping at CA$6.99 added alongside Canada Post Home Delivery at CA$12.49 (both paid by the buyer, plus tax).", source: S.purolator },
  {
    date: "2026-02-13",
    text: "US heavier labels simplified: 5.01–10 lb now $5.00 (was five tiers up to $22.50) and a new 10.01–15 lb tier at $10.00; the maximum per order rose from 10 lb to 15 lb.",
    source: S.heavier,
  },
  { date: "2025-10-12", text: "USPS charges $5, deducted from the seller’s balance, for shipping a Poshmark order in Priority Mail packaging.", source: S.lowerShip },
  { date: "2025-10-01", text: "Texas Seller Fee Tax: sellers with a Texas return address pay Texas sales tax (6.25% plus local) on 80% of Poshmark’s fee.", source: S.texas },
  { date: "2025-09-12", text: "US shipping paid by the buyer cut from $8.27 to $6.49, now via USPS Ground Advantage (up to 5 lb).", source: S.lowerShip },
  { date: "2024-10-24", text: "Poshmark reverted to $2.95 under $15 and 20% at $15 and up, and removed the Buyer Protection Fee.", source: S.fee },
  {
    date: "2024-10-03",
    text: "Seller fee briefly changed from 20% / $2.95 to $1–$3 plus 5.99% of the order total (shipping and tax included), and buyers were charged a Buyer Protection Fee. Reversed three weeks later.",
    source: S.fee,
  },
];

function weightBands(market: Market): WeightBand[] {
  return market.id === "ca" ? CA_WEIGHT : US_WEIGHT;
}

function weightOptions(market: Market, now: number = Date.now()): SelectOption[] {
  const money = moneyFor(market);
  return weightBands(market).map((w) => ({
    value: w.value,
    label: w.label,
    hint: !w.fee
      ? "Standard label"
      : w.fromDeductionDate
        ? `${money(w.fee)} deducted${overweightDeductionActive(now) ? "" : " from Oct 26, 2026"}`
        : `${money(w.fee)} upgrade${market.id === "ca" ? " + GST/HST" : ""}`,
  }));
}

function province(inputs: Inputs) {
  return PROVINCES[str(inputs, "province", "on")] ?? PROVINCES.on;
}

/** Poshmark's seller fee (commission) on a final order price, in cents. */
export function sellerFee(priceCents: number, market: Market): number {
  const r = RULES[market.id] ?? RULES.us;
  return priceCents < r.threshold ? r.flat : pct(priceCents, r.rate);
}

interface Core {
  fees: Line[];
  buyerFees: Line[];
  payout: number;
  buyerPays: number;
}

/** Every line for one price. Pure, no notes, so the threshold note can probe other prices. */
function core(inputs: Inputs, market: Market, price: number, now: number): Core {
  const money = moneyFor(market);
  const ca = market.id === "ca";
  const rules = RULES[market.id] ?? RULES.us;
  const flat = price < rules.threshold;
  const fee = sellerFee(price, market);
  // Same currency symbol as every other amount on the result card ("$15" / "CA$20").
  const thresholdText = formatMoney(rules.threshold, market.currency, market.locale, { whole: true });
  const flatText = money(rules.flat);

  const fees: Line[] = [];
  fees.push({
    id: "seller-fee",
    label: "Poshmark fee",
    amount: fee,
    kind: "platform",
    detail: flat ? `Flat ${flatText} (sale under ${thresholdText})` : `${formatRate(rules.rate)} × ${money(price)}`,
    explain: flat
      ? `Sales under ${thresholdText} pay a flat ${flatText}. From ${thresholdText} up the fee is 20% of the sale price. Shipping and sales tax are never part of it.`
      : `20% of the final sale price (the listing price, the offer you accepted, or the bundle total after the bundle discount). Shipping and sales tax are not included. Under ${thresholdText} it would be a flat ${flatText}.`,
    source: ca ? S.caFee : S.fee,
  });

  if (ca) {
    const p = province(inputs);
    fees.push({
      id: "fee-tax",
      label: `${p.tax} on Poshmark fee (${formatRate(p.rate)})`,
      amount: pct(fee, p.rate),
      kind: "tax",
      detail: `${formatRate(p.rate)} × ${money(fee)}`,
      explain: `Every Canadian sale adds GST/HST on Poshmark’s fee, at your province’s rate (${p.name}: ${formatRate(p.rate)} ${p.tax}, from the Canada Revenue Agency’s table). It comes out of your earnings.`,
      source: S.caFee,
    });
    if (str(inputs, "province", "on") === "bc" && bool(inputs, "bcBuyer")) {
      fees.push({
        id: "bc-pst",
        label: `B.C. PST on Poshmark fee (${formatRate(BC_PST)})`,
        amount: pct(fee, BC_PST),
        kind: "tax",
        detail: `${formatRate(BC_PST)} × ${money(fee)}`,
        explain: "Since August 1, 2022 Poshmark also charges B.C. Provincial Sales Tax on its fee when a seller in B.C. sells to a buyer in B.C.",
        source: S.caTax,
      });
    }
  }

  if (!ca && bool(inputs, "texas")) {
    const rate = Math.min(TEXAS_MAX_RATE, Math.max(TEXAS_STATE_RATE, num(inputs, "texasRate", TEXAS_MAX_RATE)));
    fees.push({
      id: "texas",
      label: "Texas Seller Fee Tax",
      amount: roundCents((fee * 0.8 * rate) / 100),
      kind: "tax",
      detail: `${formatRate(rate)} × 80% × ${money(fee)}`,
      explain: "Since October 1, 2025, sellers with a Texas return address pay Texas sales tax (6.25% state plus your local rate) on 80% of Poshmark’s fee. It’s separate from the sales tax buyers pay.",
      source: S.texas,
    });
  }

  // Shipping: the buyer pays the label; a discount you offer comes out of your earnings.
  const carrier = CA_SHIPPING[str(inputs, "caShipping", "canadapost")] ?? CA_SHIPPING.canadapost;
  const label = ca ? carrier.amount : US_LABEL;
  const discount = Math.min(label, toCents(num(inputs, "shippingDiscount")));
  if (discount > 0) {
    fees.push({
      id: "shipping-discount",
      label: discount >= label ? "Free shipping you offered" : "Shipping discount you offered",
      amount: discount,
      kind: "shipping",
      detail: discount >= label ? `Whole ${money(label)} label` : `${money(discount)} off the ${money(label)} label`,
      explain:
        "Shipping discounts you set on a listing or include in an Offer to Likers (where one is required) are deducted from your earnings. They don’t change Poshmark’s fee, which is charged on the sale price only.",
      source: ca ? S.caFee : S.discount,
    });
  }

  const weight = str(inputs, "weight", ca ? "2.5" : "5");
  const band = weightBands(market).find((w) => w.value === weight);
  if (band && band.fee > 0) {
    if (ca) {
      const p = province(inputs);
      const tax = pct(band.fee, p.rate);
      fees.push({
        id: "label-upgrade",
        label: `Heavier label (${band.label.replace("Up to ", "")})`,
        amount: band.fee + tax,
        kind: "shipping",
        detail: `${money(band.fee)} + ${formatRate(p.rate)} ${p.tax} ${money(tax)}`,
        explain:
          "The standard label covers 2.5 kg including the box. Heavier packages (up to 5 kg) need an upgraded label: CA$1 per extra half-kilo, plus GST/HST on it at the buyer’s province rate (we use yours). It’s deducted from your earnings.",
        source: S.caOverweight,
      });
    } else if (band.fromDeductionDate) {
      const live = overweightDeductionActive(now);
      fees.push({
        id: "label-upgrade",
        label: "Over 15 lb on one label",
        amount: live ? band.fee : 0,
        kind: "shipping",
        detail: live ? `${money(band.fee)} (15.01–25 lb)` : "Deducted from October 26, 2026",
        explain:
          "Labels support 15 lb at most. Split heavier bundles into boxes with an additional label each (Poshmark charges a separate, unpublished fee for those). From October 26, 2026, a 15.01–25 lb package on one label costs you $15.00, and over 25 lb the full USPS postage.",
        source: S.upgrades,
      });
    } else {
      fees.push({
        id: "label-upgrade",
        label: `Heavier label (${band.label})`,
        amount: band.fee,
        kind: "shipping",
        detail: `${band.label} upgrade`,
        explain: `The $6.49 label covers 5 lb including the box and padding. Over that you pay the upgrade: $5.00 for 5.01–10 lb, $10.00 for 10.01–15 lb, deducted from your earnings. ${
          overweightDeductionActive(now) ? "Ship without upgrading and Poshmark deducts it anyway." : "From October 26, 2026 it’s deducted even if you ship without upgrading."
        }`,
        source: S.overweight,
      });
    }
  }

  const cashOut = (CASH_OUT[market.id] ?? CASH_OUT.us)[str(inputs, "cashOut", "free")];
  if (cashOut && cashOut.fee > 0) {
    fees.push({
      id: "cash-out",
      label: cashOut.line,
      amount: cashOut.fee,
      kind: "payment",
      detail: `${money(cashOut.fee)} per transfer`,
      explain: `Charged each time you move your balance out, not per sale: cash out several sales at once and you pay it once. Direct deposit is free (${ca ? "1–3" : "2–3"} business days).`,
      source: ca ? S.caRedeem : S.redeem,
    });
  }

  const buyerShipping = label - discount;
  const buyerFees: Line[] = [
    {
      id: "buyer-shipping",
      label: ca ? `Shipping: ${carrier.label}` : "Shipping (prepaid label)",
      amount: buyerShipping,
      kind: "shipping",
      detail: discount ? `${money(label)} − ${money(discount)} your discount` : ca ? `${money(label)} + tax` : `Flat ${money(label)}`,
      explain: ca
        ? "Canadian buyers pay CA$12.49 for Canada Post Home Delivery, or CA$6.99 for Purolator Pick Up if you’ve turned it on, plus GST/HST. Up to 2.5 kg per order."
        : "US buyers pay a flat $6.49 per order (USPS Ground Advantage, up to 5 lb), one fee for a whole bundle. It doesn’t reach you and Poshmark takes no fee on it. Sales tax is added on top.",
      source: ca ? S.caShip : S.helpShip,
    },
  ];

  const totalFees = fees.reduce((s, l) => s + l.amount, 0);
  return { fees, buyerFees, payout: price - totalFees, buyerPays: price + buyerShipping };
}

function calculate(inputs: Inputs, market: Market) {
  const now = Date.now();
  const money = moneyFor(market);
  const ca = market.id === "ca";
  const price = toCents(num(inputs, "price"));
  const c = core(inputs, market, price, now);
  const rules = RULES[market.id] ?? RULES.us;

  const notes: string[] = [];
  // The payout drop just above the threshold: point to the price that beats the one just below.
  if (price >= rules.threshold) {
    const below = core(inputs, market, rules.threshold - 1, now).payout;
    if (c.payout < below) {
      let above = price + 1;
      while (core(inputs, market, above, now).payout < below && above < rules.threshold + 1000) above++;
      notes.push(
        `At ${money(price)} you keep less than at ${money(rules.threshold - 1)} (${money(below)}), because the flat fee turns into 20% at ${money(rules.threshold)}. List at ${money(rules.threshold - 1)}, or at ${money(above)} or more.`,
      );
    }
  }
  const weight = str(inputs, "weight", ca ? "2.5" : "5");
  if (!ca && weight === "5") notes.push("The $6.49 label covers 5 lb, box and padding included. Coats, boots and bundles often weigh more: set the weight under “More options”; the upgrade comes out of your earnings.");
  if (ca && weight === "2.5") notes.push("The standard label covers 2.5 kg, box included. Heavier? Set the weight under “More options”: the upgrade plus GST/HST comes out of your earnings.");
  if (!ca && toCents(num(inputs, "shippingDiscount")) === 0) notes.push("Sending an Offer to Likers? It must include a shipping discount, and that discount is deducted from your earnings. Enter it under “More options”.");

  return assemble({
    market,
    buyerPays: c.buyerPays,
    saleAmount: price,
    fees: c.fees,
    buyerFees: c.buyerFees,
    costs: costLines(inputs, market),
    notes,
  });
}

function schedule(market: Market): ScheduleRow[] {
  if (market.id === "ca") {
    return [
      { fee: "Listing", amount: "Free", appliesTo: "Every listing", when: "Always", source: S.caFee },
      { fee: "Poshmark fee (under CA$20)", amount: "CA$3.95 flat", appliesTo: "Each sale", when: "Sale price under CA$20", source: S.caFee },
      { fee: "Poshmark fee (CA$20 and up)", amount: "20%", appliesTo: "Sale price (not shipping or tax)", when: "Sale price CA$20 or more", source: S.caFee },
      { fee: "GST/HST on the fee", amount: "5%–15% by province", appliesTo: "Poshmark’s fee", when: "Every sale, at your province’s rate", source: S.caFee },
      { fee: "B.C. PST on the fee", amount: "7%", appliesTo: "Poshmark’s fee", when: "B.C. seller selling to a B.C. buyer", source: S.caTax },
      { fee: "Shipping (buyer pays)", amount: "CA$12.49 Canada Post / CA$6.99 Purolator, + tax", appliesTo: "Each order, up to 2.5 kg", when: "Paid by the buyer", source: S.caShip },
      { fee: "Heavier label", amount: "CA$1–CA$5 + GST/HST", appliesTo: "Each label, 3 kg to 5 kg", when: "Package over 2.5 kg", source: S.caOverweight },
      { fee: "Shipping discount you offer", amount: "Your choice", appliesTo: "Deducted from your earnings", when: "Discounted or free shipping", source: S.caFee },
      { fee: "Cash out", amount: "Free / CA$0.50 / CA$2.00", appliesTo: "Each transfer", when: "Direct deposit / PayPal / Visa Instant", source: S.caRedeem },
    ];
  }
  return [
    { fee: "Listing", amount: "Free", appliesTo: "Every listing", when: "Always", source: S.fee },
    { fee: "Poshmark fee (under $15)", amount: "$2.95 flat", appliesTo: "Each sale", when: "Sale price under $15", source: S.fee },
    { fee: "Poshmark fee ($15 and up)", amount: "20%", appliesTo: "Sale price (not shipping or tax)", when: "Sale price $15 or more", source: S.fee },
    { fee: "Shipping (buyer pays)", amount: "$6.49", appliesTo: "Each order or bundle, up to 5 lb", when: "Paid by the buyer", source: S.helpShip },
    { fee: "Heavier label", amount: "$5.00 / $10.00", appliesTo: "Each label", when: "5.01–10 lb / 10.01–15 lb", source: S.overweight },
    { fee: "Over 15 lb on one label", amount: "$15.00, or full USPS cost over 25 lb", appliesTo: "Each package", when: "From October 26, 2026", source: S.upgrades },
    { fee: "Shipping discount you offer", amount: "Your choice", appliesTo: "Deducted from your earnings", when: "Discounted or free shipping, Offer to Likers", source: S.discount },
    { fee: "Texas Seller Fee Tax", amount: "6.25% + local × 80%", appliesTo: "Poshmark’s fee", when: "Return address in Texas", source: S.texas },
    { fee: "Priority Mail packaging", amount: "$5", appliesTo: "Each package", when: "Shipped in USPS Priority Mail packaging", source: S.boxes },
    { fee: "USPS hazmat non-compliance", amount: "$50", appliesTo: "Each flagged package", when: "USPS flags hazmat markings", source: S.boxes },
    { fee: "Cash out", amount: "Free / $0.35 / $2", appliesTo: "Each transfer", when: "Direct deposit or check / PayPal or Venmo / Instant", source: S.redeem },
  ];
}

export const poshmark: CalculatorDef = {
  slug: "poshmark",
  name: "Poshmark",
  path: "/poshmark-fee-calculator",
  category: "marketplaces",
  priceNoun: "sale price",
  sellerNoun: "seller",
  blurb: "20% of the sale ($2.95 flat under $15); buyer pays $6.49 shipping (US)",
  markets: MARKETS,
  defaultMarket: "us",
  priceField: "price",
  fields: [
    {
      id: "price",
      kind: "money",
      label: "Sale price",
      section: "sale",
      help: "Your listing price, the offer you accepted, or the bundle total after the bundle discount.",
    },
    {
      id: "province",
      kind: "select",
      label: "Your province",
      section: "sale",
      options: Object.entries(PROVINCES).map(([value, p]) => ({ value, label: p.name, hint: `${formatRate(p.rate)} ${p.tax}` })),
      help: "Poshmark adds GST/HST on its fee at your province’s rate and takes it from your earnings.",
      showIf: (_i, m) => m.id === "ca",
    },
    {
      id: "bcBuyer",
      kind: "toggle",
      label: "The buyer is in B.C. too",
      section: "sale",
      advanced: true,
      help: "B.C.-to-B.C. sales also pay 7% PST on Poshmark’s fee.",
      showIf: (i, m) => m.id === "ca" && str(i, "province", "on") === "bc",
    },
    {
      id: "caShipping",
      kind: "segmented",
      label: "Shipping your buyer picked",
      section: "shipping",
      advanced: true,
      options: [
        { value: "canadapost", label: "Canada Post · CA$12.49" },
        { value: "purolator", label: "Purolator · CA$6.99" },
      ],
      help: "The buyer pays it (plus tax). Purolator Pick Up only shows if you turned it on.",
      showIf: (_i, m) => m.id === "ca",
    },
    {
      id: "weight",
      kind: "select",
      label: "Package weight, box included",
      section: "shipping",
      advanced: true,
      options: (_i, m) => weightOptions(m),
      help: (_i, m) =>
        m.id === "ca"
          ? "Over 2.5 kg you pay for a heavier label (CA$1 per extra half-kilo, plus GST/HST) out of your earnings."
          : "Over 5 lb you pay for a heavier label ($5.00 up to 10 lb, $10.00 up to 15 lb) out of your earnings.",
    },
    {
      id: "shippingDiscount",
      kind: "money",
      label: "Shipping discount you offer",
      section: "shipping",
      advanced: true,
      help: (_i, m) =>
        m.id === "ca"
          ? "Deducted from your earnings; Poshmark’s fee doesn’t change. Free shipping = the whole label (CA$12.49 Canada Post, CA$6.99 Purolator)."
          : "Deducted from your earnings; Poshmark’s fee doesn’t change. Free shipping = the whole $6.49 label. Every Offer to Likers includes one.",
    },
    {
      id: "texas",
      kind: "toggle",
      label: "My return address is in Texas",
      section: "options",
      advanced: true,
      help: "Texas sellers pay sales tax on 80% of Poshmark’s fee.",
      showIf: (_i, m) => m.id === "us",
    },
    {
      id: "texasRate",
      kind: "percent",
      label: "Your sales tax rate (state + local)",
      section: "options",
      advanced: true,
      min: 6.25,
      max: 8.25,
      step: 0.25,
      help: "6.25% Texas rate plus your city and county rate. Poshmark’s example uses 8.25%.",
      showIf: (i, m) => m.id === "us" && bool(i, "texas"),
    },
    {
      id: "cashOut",
      kind: "segmented",
      label: "How you cash out",
      section: "options",
      advanced: true,
      options: (_i, m) => [
        { value: "free", label: "Direct deposit" },
        { value: "paypal", label: m.id === "ca" ? "PayPal" : "PayPal / Venmo" },
        { value: "instant", label: m.id === "ca" ? "Visa Instant" : "Instant" },
      ],
      help: (_i, m) =>
        m.id === "ca"
          ? "Per transfer, not per sale: direct deposit is free, PayPal CA$0.50, Visa Instant Transfer CA$2.00."
          : "Per transfer, not per sale: direct deposit and checks are free, PayPal or Venmo $0.35, Instant Transfer $2.",
    },
    { id: "itemCost", kind: "money", label: "What you paid for it", section: "costs", help: "What the item cost you, to see your profit." },
    { id: "otherCost", kind: "money", label: "Packaging & other", section: "costs" },
  ],
  defaults: (market) => ({
    price: 30,
    province: "on",
    bcBuyer: false,
    caShipping: "canadapost",
    weight: market.id === "ca" ? "2.5" : "5",
    shippingDiscount: 0,
    texas: false,
    texasRate: 8.25,
    cashOut: "free",
    itemCost: 0,
    otherCost: 0,
  }),
  calculate,
  // The flat fee becomes 20% at the threshold, so the payout drops there ($14.99 keeps $12.04, $15.00 keeps $12.00).
  breakpoints: (_inputs, market) => [(RULES[market.id] ?? RULES.us).threshold],
  verifiedAt: "2026-10-23",
  sources,
  changes,
  schedule,
  compare: {
    group: "sell",
    // Poshmark sets the buyer's shipping itself ($6.49 label). A $0 shipping charge on the compare page means free
    // shipping, which on Poshmark is a shipping discount covering the whole label, deducted from the seller.
    map: (c) => (c.shipping > 0 ? { price: c.price, itemCost: c.itemCost } : { price: c.price, itemCost: c.itemCost, shippingDiscount: US_LABEL / 100 }),
    note: "US; the buyer pays the $6.49 label (up to 5 lb); at $0 shipping you cover it as free shipping",
  },
};

export default poshmark;
