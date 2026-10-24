/*
 * Whatnot seller fees. Every number is from Whatnot's own pages (see `sources`), verified 2026-10-23.
 * Research notes with verbatim quotes: research/fees/whatnot.md.
 *
 * How an order's earnings are computed (Seller Weekly Orders Report: "taking the sale price for a
 * completed order, and subtracting the commission fee, payment processing fee, and any seller-paid
 * shipping fees"):
 *  - Commission (since 2026-09-21): a rate card per market, by category group ("vertical") × tier.
 *    The tier comes from the seller's total sales in the previous 28-day period. Charged on the sale
 *    price only (after seller coupons), never on shipping or tax. Live sales use the show's category,
 *    marketplace sales the product's.
 *  - 0% commission on the part of a single sale above 1,500 (USD/AUD/EUR/GBP) in some categories.
 *  - Premier Shop: rate × 0.9 through October 31, 2026 (switched on the date below).
 *  - Payment processing: 2.9% + 0.30 (US, CA, AU) or 2.42% + 0.25 (UK, EU) of everything the buyer
 *    pays: sale price + buyer-paid shipping + buyer-paid tax. Not reduced by tiers or promotions.
 *  - VAT/GST on commission, processing and Promote/Boost for UK/EU/AU sellers without a VAT/GST number;
 *    US state sales tax on some fees for sellers in DC, CT, HI, NM, OH, SD, TX, WV.
 *  - Buyer-paid shipping buys Whatnot's prepaid label and never reaches the seller, so the payout is
 *    the sale price minus the lines here.
 * Each line is rounded to the cent separately (the order receipt lists them separately).
 */
import { M } from "../markets";
import { assemble, bool, costLines, formatMoney, formatRate, moneyFor, num, pct, str, toCents } from "../money";
import type { CalculatorDef, FeeChange, Inputs, Line, Market, ScheduleRow, SelectOption, Source } from "../types";

const MARKETS: Market[] = [M.us, M.ca, M.uk, M.au, M.de, M.fr, M.nl, M.be, M.at];

type Vertical = "sports" | "tcg" | "fashion" | "collectibles" | "coins" | "other";
/** Standard, Tier 1 … Tier 6. */
type Ladder = readonly [number, number, number, number, number, number, number];

interface RateCard {
  /** Start of each tier in whole units of the market currency (4-week total sales). */
  thresholds: Ladder;
  rates: Record<Vertical, Ladder>;
}

/*
 * Rate cards transcribed from "Whatnot seller fees" (help article 4847069165965, edited 2026-10-01).
 * US and Canada share the rates; Canada's thresholds are in C$. Australia differs only in Sports/TCG.
 * UK, Germany, Austria and the Netherlands share one card ("All rates in this table are subject to
 * VAT"); France and Belgium charge 4% on Sports and TCG at every tier.
 */
const COINS: Ladder = [4, 3.9, 3.8, 3.7, 3.6, 3.55, 3.5];
const NA_CARDS: Ladder = [8, 7.75, 7.5, 7.25, 7, 6.75, 6.5];
const NA_RATES: Record<Vertical, Ladder> = {
  sports: NA_CARDS,
  tcg: NA_CARDS,
  fashion: [8, 7, 6.5, 5.5, 5, 4.5, 4.5],
  collectibles: [8, 7.25, 6.5, 6, 5, 5, 5],
  coins: COINS,
  other: [8, 7, 6.5, 5.5, 4, 4, 4],
};
const AU_CARDS: Ladder = [8, 7.75, 7, 6.75, 6.5, 6.25, 6];
const EU_CARDS: Ladder = [6.67, 6.5, 6.25, 6, 5.75, 5.5, 5.25];
const EU_RATES: Record<Vertical, Ladder> = {
  sports: EU_CARDS,
  tcg: EU_CARDS,
  fashion: [6.67, 6.25, 5.75, 5.25, 4.75, 4.25, 4.25],
  collectibles: [6.67, 6.5, 6.25, 6, 5.25, 5.25, 5.25],
  coins: COINS,
  other: [6.67, 6.25, 5.5, 5, 4, 4, 4],
};
const FR_BE_CARDS: Ladder = [4, 4, 4, 4, 4, 4, 4];

const T_US: Ladder = [0, 15000, 35000, 50000, 100000, 250000, 500000];
const T_EU_CA: Ladder = [0, 10000, 20000, 35000, 50000, 65000, 85000];
const T_AU: Ladder = [0, 10000, 20000, 35000, 70000, 100000, 130000];

interface MarketCfg {
  card: RateCard;
  /** Processing: percent + fixed fee per transaction in the market's currency (cents). */
  proc: { rate: number; fixed: number };
  /** VAT/GST Whatnot adds to its fees for sellers without a VAT/GST number (country's standard rate). */
  vat?: { rate: number; name: "VAT" | "GST" };
  /** Tax added on top of the price at checkout (US sales tax; Canadian GST/HST/PST/QST). */
  salesTax?: "us" | "ca";
  /** Typical buyer-paid shipping for the defaults (not a fee). */
  ship: number;
  /** Promote Tools (Promote Full Show / Boost) are offered to sellers in this market. */
  promote: boolean;
}

const EU_CARD: RateCard = { thresholds: T_EU_CA, rates: EU_RATES };
const FR_CARD: RateCard = { thresholds: T_EU_CA, rates: { ...EU_RATES, sports: FR_BE_CARDS, tcg: FR_BE_CARDS } };
const EU_PROC = { rate: 2.42, fixed: 25 };

// The US/CA/AU fixed fee is written "$0.30"; Canadian sellers transact in CAD (since 2025-04-15) and
// Australian sellers in AUD, so it is applied as C$0.30 / A$0.30.
// Promote Tools: "available to all sellers based in Austria, Belgium, Canada, France, Germany, the
// United Kingdom, and the United States" (not Australia or the Netherlands).
// UK default shipping £3.27 = Royal Mail Small Parcel on "Shipping for buyers in the UK".
const CFG: Record<string, MarketCfg> = {
  us: { card: { thresholds: T_US, rates: NA_RATES }, proc: { rate: 2.9, fixed: 30 }, salesTax: "us", ship: 4.47, promote: true },
  ca: { card: { thresholds: T_EU_CA, rates: NA_RATES }, proc: { rate: 2.9, fixed: 30 }, salesTax: "ca", ship: 10, promote: true },
  au: { card: { thresholds: T_AU, rates: { ...NA_RATES, sports: AU_CARDS, tcg: AU_CARDS } }, proc: { rate: 2.9, fixed: 30 }, vat: { rate: 10, name: "GST" }, ship: 10, promote: false },
  uk: { card: EU_CARD, proc: EU_PROC, vat: { rate: 20, name: "VAT" }, ship: 3.27, promote: true },
  de: { card: EU_CARD, proc: EU_PROC, vat: { rate: 19, name: "VAT" }, ship: 5, promote: true },
  at: { card: EU_CARD, proc: EU_PROC, vat: { rate: 20, name: "VAT" }, ship: 5, promote: true },
  nl: { card: EU_CARD, proc: EU_PROC, vat: { rate: 21, name: "VAT" }, ship: 5, promote: false },
  fr: { card: FR_CARD, proc: EU_PROC, vat: { rate: 20, name: "VAT" }, ship: 5, promote: true },
  be: { card: FR_CARD, proc: EU_PROC, vat: { rate: 21, name: "VAT" }, ship: 5, promote: true },
};

const cfgFor = (m: Market) => CFG[m.id] ?? CFG.us;

/*
 * "6.67%" is Whatnot's display of 8% ÷ 1.2 (the old flat 8% with 20% VAT taken out). Whatnot's own
 * UK/EU worked example charges £3.33 on a £50 sale, which only 6.666…% rounded to the cent gives
 * (6.67% would round to £3.34), so the engine uses the exact fraction and shows "6.67%".
 */
const SIX_67 = 20 / 3;
const exactRate = (r: number) => (r === 6.67 ? SIX_67 : r);
const showRate = (r: number) => (Math.abs(r - SIX_67) < 1e-9 ? "6.67%" : formatRate(r));

/** Category → rate group, read from the category picker on whatnot.com/seller/fees on 2026-10-23. */
interface Category {
  value: string;
  label: string;
  v: Vertical;
  /** Qualifies for 0% commission above 1,500 (help article 27912945518733). */
  hv?: boolean;
}
const CATEGORIES: Category[] = [
  { value: "trading_card_games", label: "Trading Card Games", v: "tcg", hv: true },
  { value: "sports_singles", label: "Sports Cards: singles", v: "sports", hv: true },
  { value: "sports_cards", label: "Sports Cards: breaks, packs & other", v: "sports" },
  { value: "sports_memorabilia", label: "Sports Memorabilia", v: "sports" },
  // Same rate ladder as Sports and TCG (identical in every market).
  { value: "entertainment_cards", label: "Entertainment Cards", v: "tcg", hv: true },
  { value: "mens_fashion", label: "Men’s Fashion", v: "fashion" },
  { value: "womens_fashion", label: "Women’s Fashion", v: "fashion" },
  { value: "sneakers_streetwear", label: "Sneakers & Shoes", v: "fashion" },
  { value: "bags_jewelry_accessories", label: "Bags & Accessories", v: "fashion", hv: true },
  { value: "jewelry", label: "Jewelry", v: "fashion", hv: true },
  { value: "watches_category", label: "Watches", v: "fashion", hv: true },
  { value: "health_and_beauty", label: "Beauty", v: "fashion" },
  { value: "kids_clothing", label: "Baby & Kids", v: "fashion" },
  { value: "toys", label: "Toys & Hobbies", v: "collectibles", hv: true },
  { value: "comics", label: "Comics", v: "collectibles", hv: true },
  // The high-value list says "Comics & Anime"; Whatnot's picker lists Anime & Manga separately.
  { value: "manga", label: "Anime & Manga", v: "collectibles", hv: true },
  { value: "electronics", label: "Electronics", v: "collectibles" },
  { value: "video_games_and_movies", label: "Video Games", v: "collectibles" },
  { value: "antiques_vintage_ephemera", label: "Antiques & Vintage Decor", v: "collectibles" },
  { value: "estate_sales_and_antiques", label: "Estate Sales & Storage Units", v: "collectibles" },
  { value: "home_and_garden", label: "Home & Garden", v: "collectibles" },
  { value: "crystals_and_gems", label: "Rocks & Crystals", v: "collectibles" },
  { value: "knives_and_hunting", label: "Outdoors", v: "collectibles" },
  { value: "sports_and_outdoors", label: "Sporting Goods", v: "collectibles" },
  { value: "wholesale", label: "Wholesale & Deals", v: "collectibles" },
  { value: "coins_and_money", label: "Coins & Money", v: "coins", hv: true },
  { value: "arts_crafts", label: "Arts & Handmade", v: "other" },
  { value: "music", label: "Music", v: "other" },
  { value: "books_movies", label: "Books & Movies", v: "other" },
  { value: "pet_supplies", label: "Pets", v: "other" },
  { value: "food", label: "Food & Drink", v: "other" },
  { value: "and_whatnot", label: "and Whatnot", v: "other" },
];

const GROUP: Record<Vertical, string> = {
  sports: "Cards & sports",
  tcg: "Cards & sports",
  fashion: "Fashion",
  collectibles: "Other collectibles",
  coins: "Coins & money",
  other: "Everything else",
};

const TIER_NAMES = ["Standard", "Tier 1", "Tier 2", "Tier 3", "Tier 4", "Tier 5", "Tier 6"] as const;

/** 0% commission on the part of one sale above 1,500 in the market's currency. */
const HIGH_VALUE_LIMIT = 150000;
/** US signature confirmation, charged to the seller per shipment. */
const SIGNATURE = 436;
const SIGNATURE_FROM = 50000;

/** Premier Shop's 10% commission discount runs "through October 31, 2026"; we switch at midnight US Eastern. */
export function premierDiscountActive(at: number = Date.now()): boolean {
  return at < Date.UTC(2026, 10, 1, 4, 0); // 2026-11-01 00:00 EDT
}

/** Australia's Fashion 0% week: 12:00 AM October 18 – 11:59 PM October 24, 2026, local time (AEDT used). */
export function auFashionZeroActive(at: number = Date.now()): boolean {
  return at >= Date.UTC(2026, 9, 17, 13, 0) && at < Date.UTC(2026, 9, 24, 13, 0);
}

/** US states where Whatnot charges sales tax on its fees ("Taxes on Whatnot commissions and fees"). */
interface StateTax {
  label: string;
  commission?: boolean;
  /** "local" = seller's local rate, "tx" = local rate reduced by 20%, "ct" = special 1% rate. */
  processing?: "local" | "tx" | "ct";
  promote?: boolean;
}
const US_FEE_TAX: Record<string, StateTax> = {
  none: { label: "None (any other state)" },
  ct: { label: "Connecticut", processing: "ct" },
  dc: { label: "District of Columbia", commission: true },
  hi: { label: "Hawaii", commission: true, processing: "local", promote: true },
  nm: { label: "New Mexico", commission: true, processing: "local", promote: true },
  oh: { label: "Ohio", processing: "local" },
  sd: { label: "South Dakota", processing: "local", promote: true },
  tx: { label: "Texas", processing: "tx" },
  wv: { label: "West Virginia", commission: true, processing: "local" },
};

const S = {
  fees: "whatnot-fees",
  page: "whatnot-fees-page",
  highValue: "whatnot-high-value",
  coins: "whatnot-coins",
  premier: "whatnot-premier",
  tax: "whatnot-tax-fees",
  buyerTax: "whatnot-buyer-tax",
  cancel: "whatnot-cancel",
  shipping: "whatnot-us-shipping",
  ukShipping: "whatnot-uk-shipping",
  freeShipping: "whatnot-free-shipping",
  adjustments: "whatnot-adjustments",
  promote: "whatnot-promote",
  tips: "whatnot-tips",
  report: "whatnot-weekly-report",
  auFashion: "whatnot-au-fashion",
} as const;

const help = (id: string, title: string): Source => ({
  id: "",
  title,
  url: `https://help.whatnot.com/hc/en-us/articles/${id}`,
  publisher: "Whatnot Help Center",
  checked: "2026-10-23",
  watch: `https://help.whatnot.com/api/v2/help_center/en-us/articles/${id.split("-")[0]}.json`,
});

const sources: Source[] = [
  { ...help("4847069165965-Whatnot-seller-fees", "Whatnot seller fees"), id: S.fees },
  { id: S.page, title: "How Fees Work", url: "https://www.whatnot.com/seller/fees", publisher: "Whatnot", checked: "2026-10-23" },
  { ...help("27912945518733-Reduced-Commission-on-High-Value-Orders", "Reduced Commission on High-Value Orders"), id: S.highValue },
  { ...help("14477076380941-Reduced-commission-on-Coins-Money", "Reduced commission on Coins & Money"), id: S.coins },
  { ...help("31084236928909-Premier-Shop-Program", "Premier Shop Program"), id: S.premier },
  { ...help("32083195713421-Taxes-on-Whatnot-commissions-and-fees", "Taxes on Whatnot commissions and fees"), id: S.tax },
  { ...help("27262271523597-How-tax-is-collected-from-purchases-on-Whatnot", "How tax is collected from purchases on Whatnot"), id: S.buyerTax },
  { ...help("360061603971-Cancel-an-order-before-you-ship", "Cancel an order before you ship"), id: S.cancel },
  { ...help("46768886074765-Shipping-for-sellers-in-the-US", "Shipping for sellers in the US"), id: S.shipping },
  { ...help("21559276628621-Shipping-for-buyers-in-the-UK", "Shipping for buyers in the UK"), id: S.ukShipping },
  { ...help("15788140338957-Offer-free-or-discounted-shipping", "Offer free or discounted shipping"), id: S.freeShipping },
  { ...help("45116465852557-Review-and-appeal-carrier-adjustments", "Review and appeal carrier adjustments"), id: S.adjustments },
  { ...help("34443991672589-Promote-Tools", "Promote Tools"), id: S.promote },
  { ...help("15503013555085-Tips-Terms-and-Conditions", "Tips Terms and Conditions"), id: S.tips },
  { ...help("36772664621837-Seller-Weekly-Orders-Report", "Seller Weekly Orders Report"), id: S.report },
  { ...help("49455970803085-0-Week-for-AU-Fashion-Sellers-Live-18-24-October-2026-FAQs", "0% Week for AU Fashion Sellers | Live 18-24 October 2026 | FAQs"), id: S.auFashion },
];

const changes: FeeChange[] = [
  {
    date: "2026-11-04",
    text: "US: weight-based USPS carrier adjustments on Whatnot labels are charged to the seller’s ledger for shipments sent from this date (Whatnot covered them before). Dimension and hazmat adjustments stay covered for now, and sellers whose first sale was on or after September 5, 2026 aren’t included yet.",
    source: S.adjustments,
    upcoming: true,
  },
  {
    date: "2026-11-01",
    text: "Premier Shop no longer includes a commission discount. Through October 31 it takes 10% off your rate (8% → 7.2%, 5% → 4.5%); from November 1 your rate is set by your sales tier alone.",
    source: S.premier,
    upcoming: true,
  },
  { date: "2026-10-18", text: "Australia: 0% commission on Fashion sales from October 18 to October 24, 2026 (local time). Payment processing still applies.", source: S.auFashion },
  {
    date: "2026-09-21",
    text: "Tiered commission replaces the flat 8% (6.67% + VAT in the UK and EU). 8% is now the Standard tier (Coins & Money 4%), and higher sales in a 4-week period unlock lower rates by category: in the US from $15,000, down to 6.5% for sports and TCG, 5% for other collectibles, 4.5% for fashion, 4% for everything else and 3.5% for coins. France and Belgium: sports and TCG 4% + VAT at every tier.",
    source: S.fees,
  },
  { date: "2026-07-31", text: "New US shipping rates for buyers, including Whatnot’s handling fee: USPS Ground Advantage $4.47 under 4 oz and a flat $7.75 for 1–5 lb.", source: S.shipping },
  { date: "2026-06-04", text: "0% commission above 1,500 extended to Bags & Accessories and Jewelry & Watches.", source: S.highValue },
  {
    date: "2026-01-14",
    text: "0% commission on the part of a single sale above 1,500 (USD, AUD, EUR or GBP) in Trading Card Games, sports singles, Comics & Anime, Toys & Hobbies, Coins & Money and Entertainment Cards. A limited-time promotion that Whatnot can end at any time.",
    source: S.highValue,
  },
];

function category(inputs: Inputs): Category {
  const v = str(inputs, "category", "trading_card_games");
  return CATEGORIES.find((c) => c.value === v) ?? CATEGORIES[0];
}

function tierIndex(inputs: Inputs): number {
  const t = Math.round(num(inputs, "tier", 0));
  return Math.min(6, Math.max(0, t));
}

function calculate(inputs: Inputs, market: Market) {
  const money = moneyFor(market);
  const cfg = cfgFor(market);
  const cat = category(inputs);
  const tier = tierIndex(inputs);
  const tierRate = cfg.card.rates[cat.v][tier];

  const price = toCents(num(inputs, "price"));
  const shipping = toCents(num(inputs, "shippingCharged"));
  const taxRate = cfg.salesTax ? Math.max(0, num(inputs, "salesTax")) : 0;
  const tax = pct(price, taxRate);
  const buyerPays = price + shipping + tax;

  // Commission rate for this order: tier rate, Premier Shop discount, then any lower promotional rate.
  let rate = exactRate(tierRate);
  const premier = bool(inputs, "premier") && premierDiscountActive();
  if (premier) rate *= 0.9;
  const auPromo = market.id === "au" && cat.v === "fashion" && auFashionZeroActive();
  if (auPromo) rate = 0;

  const highValue = cat.hv === true && price > HIGH_VALUE_LIMIT;
  const commissionBase = highValue ? HIGH_VALUE_LIMIT : price;
  const commission = pct(commissionBase, rate);
  const where = `${cat.label}, ${TIER_NAMES[tier]}`;

  const fees: Line[] = [];
  fees.push({
    id: "commission",
    label: "Commission fee",
    amount: commission,
    kind: "platform",
    detail: highValue ? `${showRate(rate)} × ${money(HIGH_VALUE_LIMIT)} (0% on the ${money(price - HIGH_VALUE_LIMIT)} above)` : `${showRate(rate)} × ${money(price)}`,
    explain: auPromo
      ? "0% during Australia’s Fashion 0% week (October 18–24, 2026, local time). Payment processing still applies."
      : `${showRate(rate)} of the sale price (${where}${premier ? `, ${showRate(tierRate)} less the 10% Premier Shop discount` : ""}). Shipping and tax the buyer pays aren’t included. Live sales use the show’s category; marketplace sales the item’s.${
          highValue ? ` This category pays 0% on the part of one sale above ${money(HIGH_VALUE_LIMIT)} (a limited-time promotion).` : ""
        }`,
    source: auPromo ? S.auFashion : highValue ? S.highValue : premier ? S.premier : S.fees,
  });

  const processing = pct(buyerPays, cfg.proc.rate) + cfg.proc.fixed;
  fees.push({
    id: "processing",
    label: "Payment processing fee",
    amount: processing,
    kind: "payment",
    detail: `${formatRate(cfg.proc.rate)} × ${money(buyerPays)} + ${money(cfg.proc.fixed)}`,
    explain: `${formatRate(cfg.proc.rate)} of everything the buyer pays (sale price, shipping${cfg.salesTax ? " and tax" : ""}) plus ${money(cfg.proc.fixed)} per transaction. Each win in a show is its own transaction. Tiers, promotions and Premier Shop don’t lower it.`,
    source: S.fees,
  });

  const promote = cfg.promote ? toCents(num(inputs, "promote")) : 0;
  if (promote) {
    fees.push({ id: "promote", label: "Promote / Boost", amount: promote, kind: "ads", detail: "Your promotion spend per sale", explain: "What Promote Full Show or Boost cost you, spread over the items the show sold. Charged after the show ends.", source: S.promote });
  }

  const sellerShipping = toCents(num(inputs, "sellerShipping"));
  if (sellerShipping) {
    fees.push({
      id: "sellerShipping",
      label: "Seller-paid shipping",
      amount: sellerShipping,
      kind: "shipping",
      detail: "The part of the label you cover",
      explain: "With free or capped shipping you pay the rest of the label, and Whatnot deducts it from your earnings. It isn’t part of what the buyer pays, so no processing fee is charged on it.",
      source: S.freeShipping,
    });
  }

  if (market.id === "us") {
    const mode = str(inputs, "signature", "auto");
    if (mode === "yes" || (mode === "auto" && price >= SIGNATURE_FROM)) {
      fees.push({
        id: "signature",
        label: "Signature confirmation",
        amount: SIGNATURE,
        kind: "shipping",
        detail: "$4.36 per shipment",
        explain: "Added automatically to US shipments with an order subtotal of $500 or more in eligible categories (unless the buyer turned it off), and to any shipment where you add it. You pay it, plus any tax.",
        source: S.shipping,
      });
    }
  }

  const vat = cfg.vat;
  if (vat && bool(inputs, "vatOnFees")) {
    const vatLine = (id: string, what: string, base: number): Line => ({
      id,
      label: `${vat.name} on ${what}`,
      amount: pct(base, vat.rate),
      kind: "tax",
      detail: `${formatRate(vat.rate)} × ${money(base)}`,
      explain: `Whatnot adds ${vat.name} at ${market.label}’s standard rate (${formatRate(vat.rate)}) to its commission, processing${cfg.promote ? " and Promote/Boost" : ""} fees unless you’ve given it a ${vat.name} number. Registered sellers handle ${vat.name} themselves.`,
      source: S.tax,
    });
    if (commission) fees.push(vatLine("vatCommission", "commission", commission));
    fees.push(vatLine("vatProcessing", "payment processing", processing));
    if (promote) fees.push(vatLine("vatPromote", "Promote/Boost", promote));
  }

  const notes: string[] = [];
  if (market.id === "us") {
    const st = US_FEE_TAX[str(inputs, "feeTaxState", "none")] ?? US_FEE_TAX.none;
    const local = Math.max(0, num(inputs, "feeTaxRate"));
    const explain = `Sellers located in ${st.label} pay sales tax on some Whatnot fees, taken from the order’s earnings. Resale certificates don’t exempt it.`;
    if (st.commission && local) {
      fees.push({ id: "taxCommission", label: "Sales tax on commission", amount: pct(commission, local), kind: "tax", detail: `${formatRate(local)} × ${money(commission)}`, explain, source: S.tax });
    }
    if (st.processing === "ct" || (st.processing && local)) {
      const r = st.processing === "ct" ? 1 : st.processing === "tx" ? local * 0.8 : local;
      fees.push({
        id: "taxProcessing",
        label: "Tax on payment processing fee",
        amount: pct(processing, r),
        kind: "tax",
        detail: st.processing === "tx" ? `${formatRate(local)} × 80% × ${money(processing)}` : `${formatRate(r)} × ${money(processing)}`,
        explain: st.processing === "ct" ? "Connecticut sellers pay a special 1% sales tax on the payment processing fee." : st.processing === "tx" ? "Texas sellers pay their local sales tax rate reduced by 20% on the payment processing fee." : explain,
        source: S.tax,
      });
    }
    if (st.promote && local && promote) {
      fees.push({ id: "taxPromote", label: "Sales tax on Promote/Boost", amount: pct(promote, local), kind: "tax", detail: `${formatRate(local)} × ${money(promote)}`, explain, source: S.tax });
    }
    if (st !== US_FEE_TAX.none && st.processing !== "ct" && !local) notes.push(`Enter your local sales tax rate under “More options” to include the tax ${st.label} charges on Whatnot fees.`);
  }

  if (cfg.salesTax && !taxRate) {
    notes.push(
      cfg.salesTax === "us"
        ? "Processing is also charged on the sales tax the buyer pays. Add their tax rate under “More options” for the exact figure."
        : "Processing is also charged on the GST/HST (and PST/QST) a Canadian buyer pays. Add their rate under “More options” for the exact figure.",
    );
  }

  const nextRate = tier < 6 ? cfg.card.rates[cat.v][tier + 1] : undefined;
  if (nextRate !== undefined && nextRate < tierRate && !auPromo) {
    const next = formatMoney(cfg.card.thresholds[tier + 1] * 100, market.currency, market.locale, { whole: true });
    notes.push(`Sell ${next} across all categories in one 4-week period and this category drops to ${showRate(exactRate(nextRate))} for the following period.`);
  }

  if (!cat.hv && price > HIGH_VALUE_LIMIT) {
    notes.push(`0% commission above ${money(HIGH_VALUE_LIMIT)} covers only some categories (cards, comics, anime, toys, coins, bags, jewelry and watches); ${cat.label} pays its rate on the whole price.`);
  }

  return assemble({
    market,
    buyerPays,
    saleAmount: price,
    fees,
    costs: costLines(inputs, market),
    notes: notes.slice(0, 3),
  });
}

function tierOptions(inputs: Inputs, market: Market): SelectOption[] {
  const cfg = cfgFor(market);
  const t = cfg.card.thresholds;
  const whole = (n: number) => formatMoney(n * 100, market.currency, market.locale, { whole: true });
  const cat = category(inputs);
  return TIER_NAMES.map((name, i) => ({
    value: String(i),
    label: i === 0 ? `Under ${whole(t[1])} · ${name}` : i === 6 ? `${whole(t[6])} or more · ${name}` : `${whole(t[i])}–${whole(t[i + 1] - 1)} · ${name}`,
    hint: showRate(exactRate(cfg.card.rates[cat.v][i])),
  }));
}

function categoryOptions(inputs: Inputs, market: Market): SelectOption[] {
  const cfg = cfgFor(market);
  const tier = tierIndex(inputs);
  return CATEGORIES.map((c) => ({ value: c.value, label: c.label, group: GROUP[c.v], hint: showRate(exactRate(cfg.card.rates[c.v][tier])) }));
}

function schedule(market: Market): ScheduleRow[] {
  const money = moneyFor(market);
  const cfg = cfgFor(market);
  const whole = (n: number) => formatMoney(n * 100, market.currency, market.locale, { whole: true });
  const plusVat = cfg.vat?.name === "VAT" ? " + VAT" : "";
  const t = cfg.card.thresholds;
  const groups: { v: Vertical; name: string }[] = [
    { v: "sports", name: "Sports & TCG" },
    { v: "fashion", name: "Fashion" },
    { v: "collectibles", name: "Other Collectibles" },
    { v: "coins", name: "Coins & Money" },
    { v: "other", name: "Other categories" },
  ];
  const rows: ScheduleRow[] = groups.map(({ v, name }) => {
    const l = cfg.card.rates[v];
    const flat = l.every((r) => r === l[0]);
    return {
      fee: `Commission: ${name}`,
      amount: flat ? `${showRate(exactRate(l[0]))}${plusVat}, every tier` : `${showRate(exactRate(l[0]))} → ${showRate(l[6])}${plusVat}`,
      appliesTo: "Sale price only (not shipping or tax)",
      when: flat ? "Every sale" : `Standard → Tier 6 (${whole(t[6])}+ in 4-week sales; Tier 1 from ${whole(t[1])})`,
      source: S.fees,
    };
  });
  rows.push({
    fee: "High-value sales",
    amount: "0% commission",
    appliesTo: `The part of one sale above ${money(HIGH_VALUE_LIMIT)}`,
    when: "TCG, sports singles, comics & anime, toys, coins, bags, jewelry & watches (limited time)",
    source: S.highValue,
  });
  if (premierDiscountActive()) rows.push({ fee: "Premier Shop discount", amount: "−10% of your rate", appliesTo: "Commission", when: "Premier Shops, through October 31, 2026", source: S.premier });
  if (market.id === "au" && auFashionZeroActive()) rows.push({ fee: "Fashion 0% week", amount: "0% commission", appliesTo: "Fashion sales", when: "October 18–24, 2026 (local time)", source: S.auFashion });
  rows.push({
    fee: "Payment processing",
    amount: `${formatRate(cfg.proc.rate)} + ${money(cfg.proc.fixed)}${plusVat}`,
    appliesTo: `Everything the buyer pays: price + shipping${cfg.salesTax ? " + tax" : ""}`,
    when: "Every transaction",
    source: S.fees,
  });
  if (cfg.vat) rows.push({ fee: `${cfg.vat.name} on fees`, amount: `${formatRate(cfg.vat.rate)} (standard rate)`, appliesTo: cfg.promote ? "Commission, processing, Promote/Boost" : "Commission and processing", when: `No ${cfg.vat.name} number on your account`, source: S.tax });
  if (market.id === "us") {
    rows.push({ fee: "Sales tax on fees", amount: "Your local rate", appliesTo: "Commission (DC, HI, NM, WV); processing (CT 1%, HI, NM, OH, SD, TX at 80%, WV); Promote/Boost (HI, NM, SD)", when: "Sellers located in those states", source: S.tax });
    rows.push({ fee: "Signature confirmation", amount: "$4.36 + tax", appliesTo: "Each shipment", when: "Automatic at a $500+ order subtotal in eligible categories", source: S.shipping });
    rows.push({ fee: "Carrier adjustments", amount: "The carrier’s difference (about $20 for a wrong box)", appliesTo: "Each shipment", when: "Wrong packaging: now. Weight-based (USPS): shipments sent from November 4, 2026", source: S.adjustments });
  }
  if (market.id === "ca") rows.push({ fee: "Tax on fees", amount: "GST/HST (+ PST/QST)", appliesTo: "Commission and processing", when: "Sales to buyers outside Canada", source: S.tax });
  rows.push(
    { fee: "Seller cancellation", amount: `${money(300)} or 3% of the order, whichever is higher`, appliesTo: "Order total", when: "You cancel for a reason in your control (first one waived)", source: S.cancel },
    { fee: "Tips", amount: "No commission", appliesTo: "Tips from buyers", when: "The tipper pays the processing fee", source: S.tips },
  );
  return rows;
}

const vatShown = (_i: Inputs, m: Market) => Boolean(cfgFor(m).vat);

export const whatnot: CalculatorDef = {
  slug: "whatnot",
  name: "Whatnot",
  path: "/whatnot-fee-calculator",
  category: "marketplaces",
  priceNoun: "sale price",
  sellerNoun: "seller",
  blurb: "8% commission (lower tiers from $15K in 4 weeks) + 2.9% + $0.30 processing (US)",
  markets: MARKETS,
  defaultMarket: "us",
  priceField: "price",
  fields: [
    { id: "price", kind: "money", label: "Sale price", section: "sale", help: "The winning bid, Buy It Now price or accepted offer, after any coupon you gave. Commission is charged on this alone." },
    {
      id: "category",
      kind: "select",
      label: "Category",
      section: "sale",
      searchable: true,
      options: categoryOptions,
      help: "In a live show Whatnot uses the show’s category; for a marketplace listing, the item’s. The hint shows your rate.",
    },
    {
      id: "tier",
      kind: "select",
      label: "Your sales in the last 4-week period",
      section: "sale",
      options: tierOptions,
      help: "Total sales in all categories last period set this period’s rate. Crossing a threshold lowers it next period, not right away.",
    },
    {
      id: "salesTax",
      kind: "percent",
      label: "Buyer’s sales tax rate",
      section: "sale",
      advanced: true,
      max: 20,
      help: (_i, m) =>
        cfgFor(m).salesTax === "ca"
          ? "The GST/HST (and PST/QST) Whatnot adds at checkout for a Canadian buyer. The 2.9% processing fee is charged on it too."
          : "Whatnot adds it at checkout on top of the price, and the 2.9% processing fee is charged on it too.",
      showIf: (_i, m) => Boolean(cfgFor(m).salesTax),
    },
    {
      id: "shippingCharged",
      kind: "money",
      label: "Shipping the buyer pays",
      section: "shipping",
      help: "It pays for Whatnot’s label and never reaches you, but processing is charged on it. Enter 0 if this win was bundled into an earlier one.",
    },
    {
      id: "sellerShipping",
      kind: "money",
      label: "Shipping you cover (free or capped shipping)",
      section: "shipping",
      advanced: true,
      help: "The part of the label you pay; Whatnot deducts it from your earnings.",
    },
    {
      id: "signature",
      kind: "segmented",
      label: "Signature confirmation ($4.36)",
      section: "shipping",
      advanced: true,
      options: [
        { value: "auto", label: "Auto at $500+" },
        { value: "yes", label: "Added" },
        { value: "no", label: "None" },
      ],
      help: "Whatnot adds it to orders of $500 or more in eligible categories unless the buyer turned it off. The seller pays.",
      showIf: (_i, m) => m.id === "us",
    },
    {
      id: "vatOnFees",
      kind: "toggle",
      label: "Whatnot adds VAT/GST to my fees",
      section: "options",
      help: "Yes unless you’ve added a VAT or GST number to your Whatnot account.",
      showIf: vatShown,
    },
    {
      id: "premier",
      kind: "toggle",
      label: "I’m a Premier Shop this month",
      section: "options",
      advanced: true,
      help: "Through October 31, 2026, Premier Shops pay 10% less commission (8% becomes 7.2%). The discount ends November 1.",
      showIf: () => premierDiscountActive(),
    },
    {
      id: "promote",
      kind: "money",
      label: "Promote / Boost spend per sale",
      section: "options",
      advanced: true,
      help: "Optional: what you spent promoting the show, divided by the items it sold.",
      showIf: (_i, m) => cfgFor(m).promote,
    },
    {
      id: "feeTaxState",
      kind: "select",
      label: "State tax on Whatnot fees",
      section: "options",
      advanced: true,
      options: Object.entries(US_FEE_TAX).map(([value, s]) => ({ value, label: s.label })),
      help: "Sellers in these states pay sales tax on some Whatnot fees.",
      showIf: (_i, m) => m.id === "us",
    },
    {
      id: "feeTaxRate",
      kind: "percent",
      label: "Your local sales tax rate",
      section: "options",
      advanced: true,
      max: 15,
      help: "City + state rate where your business is located. Texas applies it at 80% to processing.",
      showIf: (i, m) => m.id === "us" && !["none", "ct"].includes(str(i, "feeTaxState", "none")),
    },
    { id: "itemCost", kind: "money", label: "What the item cost you", section: "costs", help: "What you paid for it (your cost of goods)." },
    { id: "otherCost", kind: "money", label: "Packaging & supplies", section: "costs" },
  ],
  defaults: (market) => ({
    price: 25,
    category: "trading_card_games",
    tier: "0",
    salesTax: 0,
    shippingCharged: cfgFor(market).ship,
    sellerShipping: 0,
    signature: "auto",
    vatOnFees: Boolean(cfgFor(market).vat),
    premier: false,
    promote: 0,
    feeTaxState: "none",
    feeTaxRate: 0,
    itemCost: 0,
    otherCost: 0,
  }),
  calculate,
  breakpoints: (inputs, market) => {
    const out: number[] = [];
    // 0% above 1,500: the commission stops growing there (slope change only).
    if (category(inputs).hv) out.push(HIGH_VALUE_LIMIT);
    // US signature confirmation: the payout drops by $4.36 at a $500 subtotal.
    if (market.id === "us" && str(inputs, "signature", "auto") === "auto") out.push(SIGNATURE_FROM);
    return out;
  },
  verifiedAt: "2026-10-23",
  sources,
  changes,
  schedule,
  compare: {
    group: "sell",
    // Whatnot buys the label with the buyer's shipping; any postage above that is seller-paid shipping.
    map: (c) => ({ price: c.price, shippingCharged: c.shipping, sellerShipping: Math.max(0, Math.round((c.shippingCost - c.shipping) * 100) / 100), itemCost: c.itemCost, category: "toys", tier: "0" }),
    note: "US, Standard tier, Toys & Hobbies; the buyer’s shipping pays the label",
  },
};

export default whatnot;

/** Exposed for tests: the rate card cell for a market, category group and tier. */
export function rateFor(marketId: string, v: Vertical, tier: number): number {
  return (CFG[marketId] ?? CFG.us).card.rates[v][tier];
}
