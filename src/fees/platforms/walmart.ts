/*
 * Walmart Marketplace (walmart.com, US) seller fees, for orders you ship yourself or that Walmart
 * Fulfillment Services (WFS) ships for you. Every number is from Walmart's own pages (see
 * `sources`), re-read on 2026-10-23. Research notes: research/fees/walmart.md.
 *
 * How a statement line is computed (what this module reproduces):
 *  - Referral fee (the Payments report calls it "Commission"): a percentage of the total sales
 *    price = item price + shipping and handling + gift wrap + other charges, excluding only taxes
 *    stated separately (Retailer Agreement §5(a)). No monthly, setup, per-order or minimum fee.
 *    Three kinds of rule, by contract category:
 *      flat      one rate on the whole amount;
 *      whole     the bracket the total sales price falls in sets ONE rate for the whole amount
 *                ("for items with a total sales price of $15 or less"): Apparel 5/10/15%,
 *                Baby and Beauty 8/15%, Grocery 8/15%, Outdoor Power Tools 15/8%;
 *      marginal  each rate applies only to the portion inside its band ("for the portion of the
 *                total sales price up to $100"): Compact Appliances, Electronics Accessories,
 *                Furniture, Jewelry, Watches, and the approved-collectibles card/coin/comic group.
 *    The Payments report lists "Commission on product" and "Commission on shipping" separately, so
 *    for one-rate categories we round each of those to the cent on its own. Walmart doesn't say
 *    how a banded (marginal) fee is split between product and shipping, so those categories get
 *    one line on the whole total sales price. Walmart publishes no rounding rule.
 *  - WFS fulfillment, per unit (standard items): shipping weight = the unit weight under 1 lb,
 *    otherwise the greater of unit weight and L × W × H ÷ 139; Oversize 2 items start at 90 lb;
 *    add 0.25 lb and round UP to the pound; then the base-fee table, plus add-ons for clothing,
 *    hazmat, a price under $10 and Oversize 1 / Oversize 2 (the higher one only). Big & bulky items
 *    pay $155 + $0.80 per lb over 90, on the unit weight rounded up, with no add-ons.
 *  - WFS storage: cubic feet (L × W × H ÷ 1,728) × the monthly rate, billed daily (rate ÷ 30).
 *  - Walmart promotions (New-Seller Savings 2026, Customer Favorites) as credits, until they end on
 *    January 31, 2027.
 */
import { M } from "../markets";
import { assemble, bool, formatRate, moneyFor, num, pct, roundCents, str, toCents } from "../money";
import type { CalculatorDef, FeeChange, FieldDef, Inputs, Line, Market, ScheduleRow, SelectOption, Source } from "../types";

/* ------------------------------------------------------------------ sources */

const LEARN = "https://marketplacelearn.walmart.com/guides";

const S = {
  referral: "walmart-referral-schedule",
  pricing: "walmart-pricing",
  agreement: "walmart-retailer-agreement",
  statements: "walmart-payment-statements",
  collectibles: "walmart-collectibles",
  wfsFees: "walmart-wfs-fees",
  wfsPricing: "walmart-wfs-pricing",
  estimator: "walmart-wfs-estimator",
  bulky: "walmart-wfs-big-bulky",
  prep: "walmart-wfs-prep",
  nss: "walmart-nss-2026",
  nssTerms: "walmart-nss-terms",
  newsSep26: "walmart-newsletter-2026-09",
  newsSep25: "walmart-newsletter-2025-09",
  payout: "walmart-payout",
  dispute: "walmart-referral-dispute",
} as const;

const sources: Source[] = [
  {
    id: S.referral,
    title: "Referral Fee Schedule for Contract Categories",
    url: `${LEARN}/Policies%20&%20standards/Product%20listings/Referral-fee-schedule-for-contract-categories`,
    publisher: "Walmart Marketplace Learn",
    checked: "2026-10-23",
  },
  { id: S.pricing, title: "Pricing", url: "https://marketplace.walmart.com/pricing/", publisher: "Walmart Marketplace", checked: "2026-10-23" },
  {
    id: S.agreement,
    title: "Comprehensive Walmart Marketplace Program Retailer Agreement",
    url: "https://azure-na-assets.contentstack.com/v3/assets/blta7903c6b840b702d/blte9f8c035c2517009/Comprehensive%20Walmart%20Marketplace%20Retailer%20Agreement%20-%207.20.2024.pdf?branch=us_mplearn",
    publisher: "Walmart",
    checked: "2026-10-23",
  },
  {
    id: S.statements,
    title: "Payment statements and transactions",
    url: `${LEARN}/Taxes%20&%20payments/Payments/Payment-statements-and-transactions`,
    publisher: "Walmart Marketplace Learn",
    checked: "2026-10-23",
  },
  { id: S.collectibles, title: "Collectibles at Walmart", url: "https://marketplace.walmart.com/collectibles/", publisher: "Walmart Marketplace", checked: "2026-10-23" },
  {
    id: S.wfsFees,
    title: "WFS fees",
    url: `${LEARN}/Walmart%20Fulfillment%20Services%20(WFS)/WFS%20basics/WFS-fees`,
    publisher: "Walmart Marketplace Learn",
    checked: "2026-10-23",
  },
  {
    id: S.wfsPricing,
    title: "Walmart Fulfillment Services pricing",
    url: "https://marketplace.walmart.com/walmart-fulfillment-services-pricing/",
    publisher: "Walmart Marketplace",
    checked: "2026-10-23",
  },
  {
    id: S.estimator,
    title: "WFS cost estimator",
    url: `${LEARN}/Walmart%20Fulfillment%20Services%20(WFS)/WFS%20basics/WFS-fees-calculator`,
    publisher: "Walmart Marketplace Learn",
    checked: "2026-10-23",
  },
  {
    id: S.bulky,
    title: "WFS big and bulky items",
    url: `${LEARN}/Walmart%20Fulfillment%20Services%20(WFS)/WFS%20programs%20&%20services/WFS-big-and-bulky-items`,
    publisher: "Walmart Marketplace Learn",
    checked: "2026-10-23",
  },
  {
    id: S.prep,
    title: "WFS Prep Services",
    url: `${LEARN}/Walmart%20Fulfillment%20Services%20(WFS)/WFS%20programs%20&%20services/WFS-prep-services`,
    publisher: "Walmart Marketplace Learn",
    checked: "2026-10-23",
  },
  { id: S.nss, title: "New-Seller Savings 2026", url: "https://marketplace.walmart.com/new-seller-savings-2026/", publisher: "Walmart Marketplace", checked: "2026-10-23" },
  { id: S.nssTerms, title: "New Seller Savings – General Offer Details", url: "https://marketplace.walmart.com/nss-offer-details/", publisher: "Walmart Marketplace", checked: "2026-10-23" },
  { id: S.newsSep26, title: "Marketplace Newsletter: September 2026", url: "https://marketplace.walmart.com/mp0926/", publisher: "Walmart Marketplace", checked: "2026-10-23" },
  { id: S.newsSep25, title: "Marketplace Newsletter: September 2025", url: "https://marketplace.walmart.com/mp0925/", publisher: "Walmart Marketplace", checked: "2026-10-23" },
  {
    id: S.dispute,
    title: "Dispute an incorrect Referral Fee",
    url: `${LEARN}/Taxes%20&%20payments/Troubleshooting/dispute-an-Incorrect-referral-fee`,
    publisher: "Walmart Marketplace Learn",
    checked: "2026-10-23",
  },
  { id: S.payout, title: "Payout processing", url: `${LEARN}/Taxes%20&%20payments/Payments/Payment-processing`, publisher: "Walmart Marketplace Learn", checked: "2026-10-23" },
];

/* ------------------------------------------------------------- categories */

interface Tier {
  /** Upper edge of the band in cents (inclusive), or null for "and above". */
  upTo: number | null;
  rate: number;
}

export interface WalmartCategory {
  id: string;
  label: string;
  kind: "flat" | "whole" | "marginal";
  /** flat: the rate. */
  rate?: number;
  /** whole / marginal: the bands, ascending. */
  tiers?: Tier[];
  /** Needs Walmart's approval (Collectibles Program Survey). */
  approval?: boolean;
  source?: string;
}

const flat = (id: string, label: string, rate: number, extra: Partial<WalmartCategory> = {}): WalmartCategory => ({ id, label, kind: "flat", rate, ...extra });

/** Referral Fee Schedule for Contract Categories (Marketplace Learn, last updated Mar 9, 2026; re-read 2026-10-23). */
export const CATEGORIES: WalmartCategory[] = [
  { id: "apparel", label: "Apparel & Accessories", kind: "whole", tiers: [{ upTo: 1500, rate: 5 }, { upTo: 2000, rate: 10 }, { upTo: null, rate: 15 }] },
  { id: "appliances-compact", label: "Appliances – Compact", kind: "marginal", tiers: [{ upTo: 30000, rate: 12 }, { upTo: null, rate: 8 }] },
  flat("appliances-major", "Appliances – Major", 8),
  flat("automotive", "Automotive & Powersports", 12),
  { id: "baby", label: "Baby Products", kind: "whole", tiers: [{ upTo: 1000, rate: 8 }, { upTo: null, rate: 15 }] },
  flat("base-power-tools", "Base Power Tools", 12),
  { id: "beauty", label: "Beauty, Health & Personal Care", kind: "whole", tiers: [{ upTo: 1000, rate: 8 }, { upTo: null, rate: 15 }] },
  flat("books", "Books", 15),
  flat("camera", "Camera & Photo", 8),
  {
    id: "collectibles-cards",
    label: "Collectibles: trading cards, card games, comics, coins, autographs, ephemera",
    kind: "marginal",
    tiers: [{ upTo: 250000, rate: 8 }, { upTo: null, rate: 2.35 }],
    approval: true,
  },
  flat("collectibles-other", "Collectibles: all other collectible categories", 8, { approval: true }),
  flat("consumer-electronics", "Consumer Electronics", 8),
  { id: "electronics-accessories", label: "Electronics Accessories", kind: "marginal", tiers: [{ upTo: 10000, rate: 15 }, { upTo: null, rate: 8 }] },
  { id: "grocery", label: "Grocery", kind: "whole", tiers: [{ upTo: 1500, rate: 8 }, { upTo: null, rate: 15 }] },
  flat("home", "Home, Kitchen, Decor & Garden", 15),
  { id: "furniture", label: "Indoor & Outdoor Furniture", kind: "marginal", tiers: [{ upTo: 20000, rate: 15 }, { upTo: null, rate: 10 }] },
  flat("industrial", "Industrial & Scientific Supplies", 12),
  { id: "jewelry", label: "Jewelry & Precious Metals", kind: "marginal", tiers: [{ upTo: 25000, rate: 20 }, { upTo: null, rate: 5 }] },
  flat("luggage", "Luggage & Travel Accessories", 15),
  flat("music", "Music", 15),
  flat("musical-instruments", "Musical Instruments", 12),
  flat("office", "Office Products", 15),
  flat("printer-cartridges", "Office Products: printer cartridges", 12),
  { id: "outdoor-power-tools", label: "Outdoor Power Tools", kind: "whole", tiers: [{ upTo: 50000, rate: 15 }, { upTo: null, rate: 8 }] },
  flat("outdoors", "Outdoors Products & Sports", 15),
  flat("outdoors-optics", "Outdoors: trail monitors, binoculars, telescopes, spotting scopes, night vision", 8),
  flat("computers", "Personal Computers", 6),
  flat("pet", "Pet Supplies", 15),
  flat("plumbing", "Plumbing, Heating, Cooling & Ventilation", 10),
  flat("shoes-bags", "Shoes, Handbags, Backpacks & Sunglasses", 15),
  flat("software", "Software & Computer Video Games", 15),
  flat("tires", "Tires & Wheels", 10),
  flat("tools", "Tools & Home Improvement", 15),
  flat("toys", "Toys & Games", 15),
  flat("video", "Video & DVD", 15),
  flat("consoles", "Video Game Consoles", 8),
  { id: "watches", label: "Watches", kind: "marginal", tiers: [{ upTo: 150000, rate: 15 }, { upTo: null, rate: 3 }] },
  flat("everything-else", "Everything Else", 15),
];

export const DEFAULT_CATEGORY = "home";

export function getCategory(id: string): WalmartCategory {
  return CATEGORIES.find((c) => c.id === id) ?? CATEGORIES.find((c) => c.id === DEFAULT_CATEGORY)!;
}

const usd = moneyFor(M.us);
const usdShort = (cents: number) => (cents % 100 === 0 ? `$${(cents / 100).toLocaleString("en-US")}` : usd(cents));

/** "15%", "5% up to $15, 10% up to $20, 15% above $20", "15% of the first $100, 8% above $100". */
export function ruleText(c: WalmartCategory): string {
  if (c.kind === "flat") return formatRate(c.rate!);
  const t = c.tiers!;
  if (c.kind === "whole") {
    return t
      .map((x, i) => (x.upTo === null ? `${formatRate(x.rate)} above ${usdShort(t[i - 1].upTo!)}` : `${formatRate(x.rate)} up to ${usdShort(x.upTo)}`))
      .join(", ");
  }
  return t
    .map((x, i) => {
      if (i === 0) return `${formatRate(x.rate)} of the first ${usdShort(x.upTo!)}`;
      if (x.upTo === null) return `${formatRate(x.rate)} above ${usdShort(t[i - 1].upTo!)}`;
      return `${formatRate(x.rate)} from ${usdShort(t[i - 1].upTo!)} to ${usdShort(x.upTo)}`;
    })
    .join(", ");
}

function categoryOptions(): SelectOption[] {
  return CATEGORIES.map((c) => ({
    value: c.id,
    label: c.label,
    hint: `${ruleText(c)}${c.kind === "whole" ? " (whole price)" : ""}${c.approval ? ", approved sellers" : ""}`,
  }));
}

/** The rate of the band a total sales price falls in (whole-price categories). */
function wholeRate(c: WalmartCategory, base: number): number {
  return c.tiers!.find((t) => t.upTo === null || base <= t.upTo)!.rate;
}

export interface Commission {
  /** Commission lines, rounded separately. */
  lines: Line[];
  total: number;
}

/**
 * Referral fee for one item. `item` = item price + gift wrap / other charges, `shipping` = shipping
 * and handling the buyer pays (cents). The total sales price sets the band.
 */
export function commission(c: WalmartCategory, item: number, shipping: number): Commission {
  const base = item + shipping;
  const src = c.source ?? S.referral;
  const what = "Charged on the total sales price: the item price plus the shipping you charge (and any gift wrap), never on sales tax.";
  if (c.kind === "marginal") {
    let exact = 0;
    let lower = 0;
    const parts: string[] = [];
    for (const t of c.tiers!) {
      const upper = t.upTo ?? Infinity;
      const portion = Math.max(0, Math.min(base, upper) - lower);
      if (portion > 0 || lower === 0) {
        exact += (portion * t.rate) / 100;
        parts.push(`${formatRate(t.rate)} × ${usd(portion)}`);
      }
      if (base <= upper) break;
      lower = upper;
    }
    const amount = roundCents(exact);
    return {
      total: amount,
      lines: [
        {
          id: "referral",
          label: shipping ? "Referral fee (item + shipping)" : "Referral fee",
          amount,
          kind: "platform",
          detail: parts.join(" + "),
          explain: `${c.label}: ${ruleText(c)}, each rate only on the part of the total sales price inside its band. ${what}${shipping ? " Your Payments report splits it into commission on product and on shipping." : ""}`,
          source: src,
        },
      ],
    };
  }
  const rate = c.kind === "flat" ? c.rate! : wholeRate(c, base);
  const rule =
    c.kind === "flat"
      ? `${c.label}: ${formatRate(rate)}.`
      : `${c.label}: ${ruleText(c)}, and the band sets the rate for the whole amount, so a total of ${usd(base)} pays ${formatRate(rate)} on all of it.`;
  const lines: Line[] = [
    {
      id: "referral",
      label: "Referral fee",
      amount: pct(item, rate),
      kind: "platform",
      detail: `${formatRate(rate)} × ${usd(item)}`,
      explain: `${rule} ${what} Your Payments report shows this line as “Commission on product”.`,
      source: src,
    },
  ];
  if (shipping > 0) {
    lines.push({
      id: "referral-shipping",
      label: "Referral fee: shipping",
      amount: pct(shipping, rate),
      kind: "platform",
      detail: `${formatRate(rate)} × ${usd(shipping)}`,
      explain: `Walmart takes the same ${formatRate(rate)} on the shipping the buyer pays. It appears on your Payments report as “Commission on shipping”.`,
      source: src,
    });
  }
  return { lines, total: lines.reduce((s, l) => s + l.amount, 0) };
}

/** Prices (total sales price, cents) where a whole-price category's rate changes for the whole amount. */
export function wholeEdges(c: WalmartCategory): number[] {
  if (c.kind !== "whole") return [];
  return c.tiers!.filter((t) => t.upTo !== null).map((t) => t.upTo! + 1);
}

/** A note when a whole-price category's total sits within $3 of a band edge. */
function bandNote(c: WalmartCategory, base: number, shift: number): string | null {
  if (c.kind !== "whole") return null;
  const tiers = c.tiers!;
  const idx = tiers.findIndex((t) => t.upTo === null || base <= t.upTo);
  const cur = tiers[idx];
  const next = tiers[idx + 1];
  const prev = tiers[idx - 1];
  const fee = (b: number) => pct(b, wholeRate(c, b));
  const incl = shift ? " (item + shipping)" : "";
  // Just below an edge.
  if (next && cur.upTo !== null && cur.upTo - base <= 300) {
    if (next.rate > cur.rate) {
      return `${c.label}: your total of ${usd(base)}${incl} is in the ${formatRate(cur.rate)} band. Go one cent over ${usd(cur.upTo)} and the whole amount pays ${formatRate(next.rate)}: about ${usd(fee(cur.upTo + 1))} instead of ${usd(fee(base))}.`;
    }
    return `${c.label}: above ${usd(cur.upTo)}${incl} the whole amount pays ${formatRate(next.rate)} instead of ${formatRate(cur.rate)}, so a total of ${usd(cur.upTo + 1)} pays about ${usd(fee(cur.upTo + 1))} against ${usd(fee(base))} now.`;
  }
  // Just above an edge.
  if (prev && prev.upTo !== null && base - prev.upTo <= 300) {
    if (cur.rate > prev.rate) {
      const target = prev.upTo - shift;
      if (target <= 0) return null;
      return `${c.label}: a total of ${usd(prev.upTo)} or less${incl} pays ${formatRate(prev.rate)} on the whole amount. Pricing at ${usd(target)} would cut the referral fee from about ${usd(fee(base))} to ${usd(fee(prev.upTo))}.`;
    }
    return `${c.label}: above ${usd(prev.upTo)}${incl} the whole amount pays ${formatRate(cur.rate)} instead of ${formatRate(prev.rate)}, which is why this fee is lower than at ${usd(prev.upTo)} (${usd(fee(prev.upTo))}).`;
  }
  return null;
}

/* ------------------------------------------------------------- WFS */

export interface WfsSize {
  /** Sides sorted longest → shortest, inches. */
  sides: [number, number, number];
  girthPlusLength: number;
  tier: "standard" | "bulky";
  oversize: 0 | 1 | 2;
  /** Fits within WFS limits (500 lb, 120" longest side, median < 105", shortest < 93"). */
  eligible: boolean;
}

export function wfsSize(length: number, width: number, height: number, weight: number): WfsSize {
  const [a, b, c] = [length, width, height].map((x) => Math.max(0, x)).sort((x, y) => y - x) as [number, number, number];
  const lg = a + 2 * (b + c);
  const eps = 1e-9;
  const bulky = weight > 150 + eps || a > 108 + eps || lg > 165 + eps;
  let oversize: 0 | 1 | 2 = 0;
  if (!bulky) {
    if ((a > 96 + eps && a <= 108 + eps) || (lg > 130 + eps && lg <= 165 + eps)) oversize = 2;
    else if ((a > 48 + eps && a <= 96 + eps) || b > 30 + eps || (lg > 105 + eps && lg <= 130 + eps)) oversize = 1;
  }
  const eligible = weight <= 500 + eps && a <= 120 + eps && b < 105 && c < 93;
  return { sides: [a, b, c], girthPlusLength: lg, tier: bulky ? "bulky" : "standard", oversize, eligible };
}

/** Weight rounded up to the whole pound, ignoring binary noise (30.0000000001 stays 30). */
function ceilLb(x: number): number {
  return Math.ceil(Math.round(x * 1e6) / 1e6);
}

/** Standard-item shipping weight (lb). `minUnit` is the Oversize 2 starting weight (90 lb). */
export function shippingWeight(length: number, width: number, height: number, weight: number, minUnit = 0): { lb: number; dim: number; used: number } {
  const dim = (length * width * height) / 139;
  const unit = Math.max(weight, minUnit);
  const used = unit < 1 ? unit : Math.max(unit, dim);
  return { lb: Math.max(1, ceilLb(used + 0.25)), dim, used };
}

/** WFS standard base fee per unit (cents) for a shipping weight in whole pounds. */
export function standardBaseFee(lb: number): number {
  if (lb <= 1) return 345;
  if (lb === 2) return 495;
  if (lb === 3) return 545;
  if (lb <= 20) return 575 + 40 * (lb - 4);
  if (lb <= 30) return 1555 + 40 * (lb - 21);
  if (lb <= 50) return 1455 + 40 * (lb - 31);
  return 1755 + 40 * (lb - 51);
}

/** WFS return processing fee per unit (cents), standard items. */
export function standardReturnFee(lb: number): number {
  if (lb <= 1) return 470;
  if (lb === 2) return 620;
  if (lb === 3) return 670;
  if (lb <= 20) return 700 + 40 * (lb - 4);
  if (lb <= 30) return 1555 + 40 * (lb - 21);
  if (lb <= 50) return 1455 + 40 * (lb - 31);
  return 1755 + 40 * (lb - 51);
}

/** Big & bulky fulfillment (and return) fee per unit (cents): $155 + $0.80 per lb over 90. */
export function bulkyFee(lb: number): number {
  return 15500 + 80 * Math.max(0, lb - 90);
}

/** Monthly storage rate per cubic foot (cents) on a given day of storage (1-based). */
export function storageRateOnDay(day: number, peak: boolean): number {
  if (day > 450) return 750;
  if (day > 365) return 225;
  if (peak && day > 30) return 225;
  return 75;
}

/** Storage cost (cents, unrounded) for `days` days: cubic feet × Σ (monthly rate ÷ 30). */
export function storageExact(cuft: number, days: number, peak: boolean): number {
  let rateDays = 0;
  const n = Math.max(0, Math.floor(days));
  for (let d = 1; d <= n; d++) rateDays += storageRateOnDay(d, peak);
  return (cuft * rateDays) / 30;
}

/** Peak storage season (October–December) in US Eastern time, roughly. */
export function storageSeason(at: number = Date.now()): "offpeak" | "peak" {
  const month = new Date(at - 5 * 3600 * 1000).getUTCMonth();
  return month >= 9 ? "peak" : "offpeak";
}

const PREP: Record<string, { cents: number; label: string }> = {
  none: { cents: 0, label: "None" },
  label: { cents: 45, label: "Item labeling" },
  bag: { cents: 60, label: "Poly bagging" },
  both: { cents: 105, label: "Labeling + poly bagging" },
};

/* ------------------------------------------------------------- promotions */

/** New-Seller Savings 2026 and Customer Favorites discounts end January 31, 2027 (end of day, Pacific). */
export const PROMO_END = Date.UTC(2027, 1, 1, 8);

export function promosActive(at: number = Date.now()): boolean {
  return at < PROMO_END;
}

interface Promo {
  label: string;
  /** % off the referral fee. */
  referral: number;
  /** % off WFS fulfillment fees (standard items only). */
  wfs: number;
  /** % off WFS storage (standard items only). */
  storage: number;
  source: string;
}

const PROMOS: Record<string, Promo> = {
  "nss-20": { label: "New-Seller Savings", referral: 20, wfs: 10, storage: 0, source: S.nssTerms },
  "nss-30": { label: "New-Seller Savings", referral: 30, wfs: 10, storage: 0, source: S.nssTerms },
  "nss-40": { label: "New-Seller Savings", referral: 40, wfs: 10, storage: 0, source: S.nssTerms },
  "cf-25": { label: "Customer Favorites", referral: 25, wfs: 15, storage: 100, source: S.newsSep26 },
  "cf-100": { label: "Customer Favorites", referral: 100, wfs: 15, storage: 100, source: S.newsSep26 },
};

/* ------------------------------------------------------------- calculate */

function lbText(x: number): string {
  return `${Number(x.toFixed(2))} lb`;
}

function calculate(inputs: Inputs, market: Market) {
  const cat = getCategory(str(inputs, "category", DEFAULT_CATEGORY));
  const wfs = str(inputs, "fulfillment", "seller") === "wfs";
  const price = toCents(num(inputs, "price"));
  const giftWrap = toCents(num(inputs, "giftWrap"));
  const shipping = wfs ? 0 : toCents(num(inputs, "shippingCharged"));
  const item = price + giftWrap;
  const base = item + shipping;

  const fees: Line[] = [];
  const notes: string[] = [];
  const warnings: string[] = [];

  const com = commission(cat, item, shipping);
  fees.push(...com.lines);

  const promoId = str(inputs, "promo", "none");
  const promo = PROMOS[promoId];
  const promoOn = Boolean(promo) && promosActive();

  if (wfs) {
    const L = Math.max(0, num(inputs, "length"));
    const W = Math.max(0, num(inputs, "width"));
    const H = Math.max(0, num(inputs, "height"));
    const weight = Math.max(0, num(inputs, "weight"));
    const size = wfsSize(L, W, H, weight);
    const cuft = (L * W * H) / 1728;
    let fulfillment = 0;
    let returnFee = 0;
    if (!size.eligible) warnings.push("These measurements are over WFS limits (500 lb, 120 in. longest side, median side under 105 in., shortest under 93 in.), so Walmart can’t fulfill this item. The WFS fees shown are only indicative.");
    if (size.tier === "bulky") {
      const lb = ceilLb(weight);
      fulfillment = bulkyFee(lb);
      returnFee = fulfillment;
      fees.push({
        id: "fulfillment",
        label: "WFS fulfillment fee (big & bulky)",
        amount: fulfillment,
        kind: "shipping",
        detail: lb > 90 ? `$155 + $0.80 × ${lb - 90} lb` : `$155 (${lb} lb, up to 90 lb)`,
        explain: `Big & bulky: over 150 lb, longest side over 108 in., or longest side + girth over 165 in. (yours: ${Number(size.girthPlusLength.toFixed(2))} in.). Charged on the unit weight rounded up to ${lb} lb: $155 plus $0.80 for each pound over 90. No add-on fees and no promotional discounts.`,
        source: S.wfsFees,
      });
    } else {
      const sw = shippingWeight(L, W, H, weight, size.oversize === 2 ? 90 : 0);
      const baseFee = standardBaseFee(sw.lb);
      const how =
        weight < 1 && size.oversize !== 2
          ? `Under 1 lb, Walmart uses the unit weight (${lbText(weight)}) + 0.25 lb packaging, rounded up: ${sw.lb} lb.`
          : `The greater of the ${size.oversize === 2 ? "unit weight (Oversize 2 items start at 90 lb)" : `unit weight (${lbText(weight)})`} and the dimensional weight (L × W × H ÷ 139 = ${lbText(sw.dim)}), + 0.25 lb packaging, rounded up: ${sw.lb} lb.`;
      const tierText =
        sw.lb <= 3 ? usd(baseFee) : sw.lb <= 20 ? `$5.75 + $0.40 × ${sw.lb - 4} lb` : sw.lb <= 30 ? `$15.55 + $0.40 × ${sw.lb - 21} lb` : sw.lb <= 50 ? `$14.55 + $0.40 × ${sw.lb - 31} lb` : `$17.55 + $0.40 × ${sw.lb - 51} lb`;
      fees.push({
        id: "fulfillment",
        label: "WFS fulfillment fee",
        amount: baseFee,
        kind: "shipping",
        detail: `${sw.lb} lb shipping weight: ${tierText}`,
        explain: `Covers packing, handling and delivery to the customer; charged per unit. ${how}`,
        source: S.wfsFees,
      });
      const addOns: { label: string; cents: number }[] = [];
      if (bool(inputs, "apparel")) addOns.push({ label: "clothing", cents: 50 });
      if (bool(inputs, "hazmat")) addOns.push({ label: "hazmat", cents: 50 });
      if (price < 1000) addOns.push({ label: "price under $10", cents: 100 });
      if (size.oversize === 1) addOns.push({ label: "Oversize 1", cents: 300 });
      if (size.oversize === 2) addOns.push({ label: "Oversize 2", cents: 2000 });
      const addTotal = addOns.reduce((s, a) => s + a.cents, 0);
      if (addTotal) {
        fees.push({
          id: "wfs-addons",
          label: "WFS add-on fees",
          amount: addTotal,
          kind: "shipping",
          detail: addOns.map((a) => `${usd(a.cents)} ${a.label}`).join(" + "),
          explain:
            "Standard items pay extra per unit: $0.50 for clothing, $0.50 for hazmat (chemicals, aerosols, pesticides, batteries), $1 when priced under $10, $3 for Oversize 1 (longest side over 48 in., median side over 30 in., or longest side + girth over 105 in.) and $20 for Oversize 2 (longest side over 96 in. or longest side + girth over 130 in.).",
          source: S.wfsFees,
        });
      }
      fulfillment = baseFee + addTotal;
      returnFee = standardReturnFee(shippingWeight(L, W, H, weight).lb);
      if (cat.id === "apparel" && !bool(inputs, "apparel")) notes.push("If this item is clothing (not an accessory), WFS adds $0.50 per unit. Turn on “It’s clothing” under More options.");
    }

    const days = Math.max(0, Math.round(num(inputs, "storageDays", 30)));
    const peak = str(inputs, "storageSeason", storageSeason()) === "peak";
    let storage = 0;
    if (days > 0 && cuft > 0) {
      storage = roundCents(storageExact(cuft, days, peak));
      const rates = new Set<number>();
      for (let d = 1; d <= days; d++) rates.add(storageRateOnDay(d, peak));
      fees.push({
        id: "storage",
        label: `WFS storage (${days} day${days === 1 ? "" : "s"})`,
        amount: storage,
        kind: "shipping",
        detail:
          rates.size === 1
            ? `${Number(cuft.toFixed(3))} cu ft × ${usd([...rates][0])}/month × ${days}/30`
            : `${Number(cuft.toFixed(3))} cu ft × ${[...rates].map((r) => usd(r)).join(" / ")} a month, by day`,
        explain: `Cubic feet (L × W × H ÷ 1,728) × the monthly rate, billed daily. $0.75 per cubic foot a month; in October–December, $2.25 for units stored more than 30 days; from day 366, $2.25, and $7.50 after 450 days. Assumes the whole stay is in the season you picked.`,
        source: S.wfsFees,
      });
    }

    const prep = PREP[str(inputs, "prep", "none")] ?? PREP.none;
    if (prep.cents) {
      fees.push({
        id: "prep",
        label: `WFS Prep Services: ${prep.label.toLowerCase()}`,
        amount: prep.cents,
        kind: "shipping",
        detail: `${usd(prep.cents)} per unit`,
        explain: "Planned prep you choose in your shipping plan: $0.45 per unit for labeling, $0.60 for poly bagging. If items arrive unlabeled or unbagged without it, Walmart fixes them for $0.65 and $0.80 per unit.",
        source: S.prep,
      });
    }

    if (promoOn && promo && size.tier === "standard") {
      if (promo.wfs && fulfillment) {
        fees.push({
          id: "wfs-discount",
          label: `${promo.label}: ${promo.wfs}% off WFS fulfillment`,
          amount: -pct(fulfillment, promo.wfs),
          kind: "shipping",
          detail: `−${promo.wfs}% × ${usd(fulfillment)}`,
          explain:
            promo.label === "New-Seller Savings"
              ? "New sellers get 10% of eligible WFS fulfillment fees back per item, until the savings reach $2,000 (credited after the sale, by the end of the following month). Prep fees aren’t discounted."
              : "Customer Favorite items shipped with WFS get 15% off fulfillment fees for 90 days, while the offer runs.",
          source: promo.source,
        });
      }
      if (promo.storage && storage) {
        fees.push({
          id: "storage-discount",
          label: `${promo.label}: storage free`,
          amount: -storage,
          kind: "shipping",
          detail: `−100% × ${usd(storage)}`,
          explain: "Customer Favorite items shipped with WFS get 100% off storage fees for 90 days, while the offer runs.",
          source: promo.source,
        });
      }
    }
    if (promoOn && promo && size.tier === "bulky" && promo.wfs) notes.push("Walmart’s promotional discounts don’t apply to big & bulky fulfillment fees.");

    notes.push(
      `If a buyer returns this for a reason that isn’t Walmart’s fault (wrong size, no longer wanted…), Walmart refunds the referral fee but keeps the ${usd(fulfillment)} fulfillment fee and charges a ${usd(returnFee)} return processing fee${size.tier === "standard" && (size.oversize || bool(inputs, "apparel") || bool(inputs, "hazmat")) ? ", plus an add-on for clothing, hazmat or oversize items that Walmart doesn’t publish" : ""}.`,
    );
  }

  if (promo && !promosActive()) notes.push(`${promo.label} ended on January 31, 2027, so no discount is applied.`);
  if (promoOn && promo) {
    fees.push({
      id: "referral-discount",
      label: `${promo.label}: ${promo.referral}% off referral fee`,
      amount: -pct(com.total, promo.referral),
      kind: "platform",
      detail: `−${promo.referral}% × ${usd(com.total)}`,
      explain:
        promo.label === "New-Seller Savings"
          ? "Sellers who started after February 1, 2026 get 20% off referral fees on their first $50,000 of sales, 30% up to $500,000 and 40% above, up to $72,000 in savings, until January 31, 2027. Shown as Walmart Funded Savings on your report."
          : `Eligible Customer Favorite items get ${promo.referral === 100 ? "100% off referral fees for 90 days with qualifying fast, free shipping" : "25% off referral fees for 90 days when you meet or beat competitor pricing"}, until January 31, 2027. Shown as Walmart Funded Savings on your report.`,
      source: promo.source,
    });
  }

  const ads = toCents(num(inputs, "adCost"));
  if (ads) {
    fees.push({
      id: "ads",
      label: "Sponsored Search ads",
      amount: ads,
      kind: "ads",
      detail: "Your average ad cost per sale",
      explain: "Walmart Connect ads are paid per click, separately from selling fees. Enter your ad spend divided by units sold.",
    });
  }

  const bn = bandNote(cat, base, shipping);
  if (bn) notes.push(bn);
  if (cat.approval) notes.push("Collectibles rates are for sellers Walmart has approved through its Collectibles Program Survey.");

  const costs: Line[] = [];
  const itemCost = toCents(num(inputs, "itemCost"));
  const label = wfs ? 0 : toCents(num(inputs, "shippingCost"));
  const inbound = wfs ? toCents(num(inputs, "inboundCost")) : 0;
  const other = toCents(num(inputs, "otherCost"));
  if (itemCost) costs.push({ id: "itemCost", label: "What you paid for the item", amount: itemCost, kind: "cost" });
  if (label) costs.push({ id: "shippingCost", label: "Shipping label / postage", amount: label, kind: "cost" });
  if (inbound) costs.push({ id: "inboundCost", label: "Shipping it to Walmart’s warehouse", amount: inbound, kind: "cost" });
  if (other) costs.push({ id: "otherCost", label: "Packaging & other costs", amount: other, kind: "cost" });

  return assemble({
    market,
    buyerPays: base,
    saleAmount: base,
    fees,
    costs,
    notes,
    warnings,
  });
}

/* ------------------------------------------------------------- schedule */

function schedule(): ScheduleRow[] {
  const rows: ScheduleRow[] = [
    { fee: "Setup or monthly fee", amount: "$0", appliesTo: "Your account", when: "Never", source: S.pricing },
    {
      fee: "Referral fee (commission)",
      amount: "15% in most categories; 2.35%–20% by category and price band",
      appliesTo: "Item price + shipping + gift wrap (not sales tax), per item",
      when: "Every sale; no minimum or per-order fee",
      source: S.referral,
    },
  ];
  for (const c of CATEGORIES) {
    rows.push({
      fee: `Referral: ${c.label}`,
      amount: ruleText(c),
      appliesTo: c.kind === "whole" ? "Whole total sales price, at the rate of its band" : c.kind === "marginal" ? "Each part of the total sales price at its band’s rate" : "Total sales price",
      when: c.approval ? "Approved collectibles sellers" : undefined,
      source: c.approval ? S.collectibles : S.referral,
    });
  }
  rows.push(
    {
      fee: "WFS fulfillment (standard)",
      amount: "$3.45 (1 lb), $4.95 (2 lb), $5.45 (3 lb), $5.75 + $0.40/lb over 4 lb (4–20 lb), $15.55 + $0.40/lb over 21 (21–30 lb), $14.55 + $0.40/lb over 31 (31–50 lb), $17.55 + $0.40/lb over 51",
      appliesTo: "Per unit, by shipping weight (greater of unit or L×W×H ÷ 139, + 0.25 lb, rounded up)",
      when: "Items Walmart ships (WFS)",
      source: S.wfsFees,
    },
    { fee: "WFS add-ons", amount: "+$0.50 clothing, +$0.50 hazmat, +$1 under $10, +$3 Oversize 1, +$20 Oversize 2 (priced from 90 lb)", appliesTo: "Per unit, standard items", when: "When the item qualifies", source: S.wfsFees },
    { fee: "WFS fulfillment (big & bulky)", amount: "$155 + $0.80/lb over 90 lb", appliesTo: "Per unit, unit weight rounded up", when: "Over 150 lb, 108 in. long or 165 in. length + girth", source: S.wfsFees },
    { fee: "WFS storage", amount: "$0.75 / cu ft / month", appliesTo: "Cubic feet stored, billed daily", when: "January–September, and the first 30 days in October–December", source: S.wfsFees },
    { fee: "WFS peak storage", amount: "$2.25 / cu ft / month ($0.75 + $1.50)", appliesTo: "Units stored more than 30 days", when: "October–December", source: S.wfsFees },
    { fee: "WFS long-term storage", amount: "$2.25 (days 366–450), $7.50 (over 450 days) / cu ft / month", appliesTo: "Units by age since received", when: "Since June 30, 2026", source: S.wfsFees },
    { fee: "WFS return processing", amount: "$4.70 (1 lb) to $17.55 + $0.40/lb over 51; big & bulky $155 + $0.80/lb over 90", appliesTo: "Per returned unit, by shipping weight", when: "Returns that aren’t Walmart’s fault", source: S.wfsFees },
    { fee: "WFS Prep Services", amount: "$0.45 labeling, $0.60 poly bag ($0.65 / $0.80 unplanned)", appliesTo: "Per unit", when: "Chosen in your shipping plan, or items arrive non-compliant", source: S.prep },
    { fee: "WFS disposal / removal", amount: "$0.35 (to 2 lb) + $0.20/lb over 2; removal adds $0.40/lb", appliesTo: "Per unit, by unit weight", when: "When you dispose of or remove inventory", source: S.wfsFees },
    { fee: "New-Seller Savings", amount: "20% / 30% / 40% off referral fees, 10% off WFS fulfillment", appliesTo: "First $50K / $50K–$500K / over $500K in sales; up to $72,000 and $2,000", when: "Sellers who started after Feb 1, 2026, until Jan 31, 2027", source: S.nssTerms },
    { fee: "Customer Favorites", amount: "25% or 100% off referral fees for 90 days", appliesTo: "Eligible Customer Favorite items", when: "Meet or beat competitor price (25%), plus fast free shipping (100%), until Jan 31, 2027", source: S.newsSep26 },
  );
  return rows;
}

/* ------------------------------------------------------------- module */

const changes: FeeChange[] = [
  {
    date: "2027-01-31",
    text: "New-Seller Savings 2026 (20–40% off referral fees, 10% off WFS fulfillment) and the Customer Favorites discounts (25% or 100% off referral fees) are scheduled to end. Standard rates apply after.",
    source: S.nssTerms,
    upcoming: true,
  },
  {
    date: "2026-06-30",
    text: "WFS long-term storage split in two: $2.25 per cubic foot a month for days 366–450 and $7.50 after 450 days (before, $2.25 for anything stored over 12 months).",
    source: S.wfsFees,
  },
  {
    date: "2026-03-09",
    text: "Approved collectibles sellers: trading cards, card games, comics, coins, autographs and ephemera now pay 8% on the first $2,500 and 2.35% above (was 8% on the whole price). Walmart didn’t publish the exact start date; the schedule was updated by March 9, 2026.",
    source: S.referral,
  },
  {
    date: "2026-02-01",
    text: "New-Seller Savings 2026 starts for sellers who begin selling after February 1, 2026: 20% off referral fees on the first $50,000 of sales, 30% up to $500,000, 40% above (up to $72,000), and 10% off WFS fulfillment (up to $2,000).",
    source: S.nssTerms,
  },
  {
    date: "2025-10-01",
    text: "WFS waived the $1.50 peak-season storage surcharge for October 1–December 31, 2025; the standard $0.75 per cubic foot still applied.",
    source: S.newsSep25,
  },
];

const fields: FieldDef[] = [
  { id: "price", kind: "money", label: "Item price", section: "sale", help: "Your Walmart.com price per item, before sales tax." },
  {
    id: "category",
    kind: "select",
    label: "Walmart category",
    section: "sale",
    searchable: true,
    options: categoryOptions(),
    help: "Walmart sets it from the product type. Your Statements page shows each item’s contract category and rate; a wrong one can be disputed within 90 days.",
  },
  { id: "giftWrap", kind: "money", label: "Gift wrap or other charges", section: "sale", advanced: true, help: "Walmart takes its referral fee on these too." },
  {
    id: "fulfillment",
    kind: "segmented",
    label: "Who ships the order?",
    section: "shipping",
    options: [
      { value: "seller", label: "I ship it" },
      { value: "wfs", label: "Walmart ships it (WFS)" },
    ],
    help: "With Walmart Fulfillment Services you pay a per-unit fulfillment fee and storage instead of postage.",
  },
  {
    id: "shippingCharged",
    kind: "money",
    label: "Shipping you charge the buyer",
    section: "shipping",
    help: "Walmart takes the same referral fee on this, and it counts toward the price bands.",
    showIf: (i) => str(i, "fulfillment", "seller") !== "wfs",
  },
  { id: "length", kind: "number", label: "Longest side", section: "shipping", unit: "in", min: 0, max: 200, step: 0.1, help: "Measured with the item’s packaging.", showIf: (i) => str(i, "fulfillment", "seller") === "wfs" },
  { id: "width", kind: "number", label: "Middle side", section: "shipping", unit: "in", min: 0, max: 200, step: 0.1, showIf: (i) => str(i, "fulfillment", "seller") === "wfs" },
  { id: "height", kind: "number", label: "Shortest side", section: "shipping", unit: "in", min: 0, max: 200, step: 0.1, showIf: (i) => str(i, "fulfillment", "seller") === "wfs" },
  {
    id: "weight",
    kind: "number",
    label: "Weight with packaging",
    section: "shipping",
    unit: "lb",
    min: 0,
    max: 1000,
    step: 0.01,
    help: "In pounds (1 kg = 2.2 lb). Light, bulky items are charged by L × W × H ÷ 139 instead.",
    showIf: (i) => str(i, "fulfillment", "seller") === "wfs",
  },
  {
    id: "storageDays",
    kind: "number",
    label: "Days in Walmart’s warehouse before it sells",
    section: "shipping",
    unit: "days",
    integer: true,
    min: 0,
    max: 730,
    advanced: true,
    help: "Storage is billed daily. Over 365 days it costs $2.25, and over 450 days $7.50, per cubic foot a month.",
    showIf: (i) => str(i, "fulfillment", "seller") === "wfs",
  },
  {
    id: "storageSeason",
    kind: "segmented",
    label: "When is it stored?",
    section: "shipping",
    advanced: true,
    options: [
      { value: "offpeak", label: "Jan–Sep" },
      { value: "peak", label: "Oct–Dec" },
    ],
    help: "October–December, units stored more than 30 days pay $2.25 instead of $0.75 per cubic foot a month.",
    showIf: (i) => str(i, "fulfillment", "seller") === "wfs",
  },
  { id: "apparel", kind: "toggle", label: "It’s clothing", section: "shipping", advanced: true, help: "WFS adds $0.50 per unit for clothing.", showIf: (i) => str(i, "fulfillment", "seller") === "wfs" },
  { id: "hazmat", kind: "toggle", label: "Contains a battery, chemical, aerosol or pesticide", section: "shipping", advanced: true, help: "WFS adds $0.50 per unit for hazmat items.", showIf: (i) => str(i, "fulfillment", "seller") === "wfs" },
  {
    id: "prep",
    kind: "select",
    label: "Walmart prepares the units",
    section: "shipping",
    advanced: true,
    options: [
      { value: "none", label: "No, I label and bag them" },
      { value: "label", label: "Labeling", hint: "$0.45 per unit" },
      { value: "bag", label: "Poly bagging", hint: "$0.60 per unit" },
      { value: "both", label: "Labeling + poly bagging", hint: "$1.05 per unit" },
    ],
    showIf: (i) => str(i, "fulfillment", "seller") === "wfs",
  },
  {
    id: "promo",
    kind: "select",
    label: "Walmart discount on this item",
    section: "options",
    advanced: true,
    options: [
      { value: "none", label: "None" },
      { value: "nss-20", label: "New-Seller Savings: first $50K in sales", hint: "20% off referral fees" },
      { value: "nss-30", label: "New-Seller Savings: $50K–$500K", hint: "30% off referral fees" },
      { value: "nss-40", label: "New-Seller Savings: over $500K", hint: "40% off referral fees" },
      { value: "cf-25", label: "Customer Favorite at or below competitor price", hint: "25% off referral fees" },
      { value: "cf-100", label: "Customer Favorite with fast, free shipping", hint: "100% off referral fees" },
    ],
    help: "Walmart applies only the highest offer an item qualifies for. These offers end January 31, 2027.",
  },
  { id: "adCost", kind: "money", label: "Ad cost per sale", section: "options", advanced: true, help: "Optional: your Sponsored Search spend divided by units sold." },
  { id: "itemCost", kind: "money", label: "What the item cost you", section: "costs", help: "Product cost per unit." },
  { id: "shippingCost", kind: "money", label: "Postage / label you pay", section: "costs", showIf: (i) => str(i, "fulfillment", "seller") !== "wfs" },
  { id: "inboundCost", kind: "money", label: "Shipping it to Walmart, per unit", section: "costs", help: "Your freight into the fulfillment center, divided by units.", showIf: (i) => str(i, "fulfillment", "seller") === "wfs" },
  { id: "otherCost", kind: "money", label: "Packaging & other", section: "costs" },
];

export const walmart: CalculatorDef = {
  slug: "walmart",
  name: "Walmart",
  path: "/walmart-fee-calculator",
  category: "marketplaces",
  priceNoun: "item price",
  sellerNoun: "seller",
  blurb: "15% referral fee in most categories, on item + shipping; no monthly fee; WFS from $3.45/unit",
  markets: [M.us],
  defaultMarket: "us",
  priceField: "price",
  fields,
  defaults: () => ({
    price: 25,
    category: DEFAULT_CATEGORY,
    giftWrap: 0,
    fulfillment: "seller",
    shippingCharged: 5,
    length: 10,
    width: 8,
    height: 4,
    weight: 2,
    storageDays: 30,
    storageSeason: storageSeason(),
    apparel: false,
    hazmat: false,
    prep: "none",
    promo: "none",
    adCost: 0,
    itemCost: 0,
    shippingCost: 0,
    inboundCost: 0,
    otherCost: 0,
  }),
  calculate,
  breakpoints: (inputs) => {
    // Whole-price categories charge one rate on the whole total, so the payout can drop one cent past an edge.
    const cat = getCategory(str(inputs, "category", DEFAULT_CATEGORY));
    const wfs = str(inputs, "fulfillment", "seller") === "wfs";
    const shift = (wfs ? 0 : toCents(num(inputs, "shippingCharged"))) + toCents(num(inputs, "giftWrap"));
    const out = wholeEdges(cat).map((e) => e - shift);
    if (wfs) out.push(1000); // the $1 WFS add-on stops at a $10.00 price
    return out.filter((p) => p > 0);
  },
  verifiedAt: "2026-10-23",
  sources,
  changes,
  schedule,
  compare: {
    group: "sell",
    map: (c) => ({ price: c.price, shippingCharged: c.shipping, itemCost: c.itemCost, shippingCost: c.shippingCost }),
    note: "You ship it; Home, Kitchen, Decor & Garden (15%); no promotions",
  },
};

export default walmart;
