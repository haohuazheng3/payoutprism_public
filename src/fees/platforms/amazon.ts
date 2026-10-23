/*
 * Amazon (amazon.com, US) seller fees for orders you ship yourself (fulfilled by merchant).
 * Every number is from Amazon's own pages (see `sources`), re-read on 2026-10-23 through the help
 * center's content API and sell.amazon.com/pricing. Research notes: research/fees/amazon-referral.md.
 *
 * How a statement line is computed (what this module reproduces):
 *  - Referral fee, per unit: the category's rule applied to the total sales price = item price +
 *    shipping charged + gift wrap, excluding sales tax; never less than the category's per-unit
 *    minimum ($0.30 in most categories, none in Media, Video Games, Consoles, Gift Cards, Grocery
 *    and Fine Art). Three kinds of rule:
 *      flat      one rate on the whole price;
 *      bracket   the price's bracket sets ONE rate for the whole price (Clothing 5/10/17%,
 *                Baby and Beauty 8/15%, Grocery 8/15%, Lawn Mowers 15/8%);
 *      marginal  each rate applies only to the portion of the price inside its band (Electronics
 *                Accessories, Compact Appliances, Furniture, Jewelry, Watches, Fine Art).
 *    Amazon does not publish a rounding rule; its examples are exact to the cent. We compute the
 *    exact fee and round once, half away from zero.
 *  - Closing fee $1.80 per unit in Media (books, DVD, music, software, video), Video Game Consoles
 *    and Video Games & Gaming Accessories.
 *  - Selling plan: Individual $0.99 per unit sold; Professional $39.99 a month, shown here as a share
 *    per sale (monthly fee ÷ units sold a month). Amazon Handmade waives the Professional fee.
 *  - Digital services fee for sellers established in the UK (2%), France (3%), Italy or Spain (3%),
 *    added to the referral, per-item and closing fees. Amazon's own example rounds each part UP to
 *    the cent (2% × £2.72 = £0.0544 → £0.06), so we do the same.
 *  - Refund administration fee (on a refund only): the lesser of $5.00 or 20% of the referral fee;
 *    $0 on a full refund of books, music, video and DVD. Shown as a note, not deducted.
 *
 * The FBA calculator (./amazon-fba) imports the referral, closing, plan and DSF helpers below.
 */
import { M } from "../markets";
import { assemble, costLines, formatRate, moneyFor, num, roundCents, str, toCents } from "../money";
import type { CalculatorDef, FeeChange, FieldDef, Inputs, Line, Market, ScheduleRow, SelectOption, Source } from "../types";

/* ------------------------------------------------------------------ sources */

const HELP = "https://sellercentral.amazon.com/help/hub/reference/external/";

export const AMZ = {
  referral: "amazon-referral",
  schedule: "amazon-fee-schedule",
  pricing: "amazon-pricing",
  perItem: "amazon-per-item",
  subscription: "amazon-subscription",
  closing: "amazon-closing",
  refund: "amazon-refund-admin",
  categories: "amazon-fee-categories",
  handmade: "amazon-handmade",
  dsf: "amazon-dsf",
  summary2026: "amazon-2026-summary",
  news2025: "amazon-2025-news",
  news2026: "amazon-2026-news",
  nsp: "amazon-nsp-2026",
  b2b: "amazon-b2b-bulk",
} as const;

/** Sources shared by both Amazon calculators. */
export const AMAZON_SOURCES: Source[] = [
  { id: AMZ.referral, title: "Referral fees", url: `${HELP}GTG4BAWSY39Z98Z3`, publisher: "Amazon Seller Central Help", checked: "2026-10-23" },
  { id: AMZ.schedule, title: "Selling on Amazon fee schedule", url: `${HELP}G200336920`, publisher: "Amazon Seller Central Help", checked: "2026-10-23" },
  { id: AMZ.pricing, title: "How much does it cost to sell on Amazon?", url: "https://sell.amazon.com/pricing", publisher: "Amazon", checked: "2026-10-23" },
  { id: AMZ.perItem, title: "Per-item selling fees", url: `${HELP}G8TPCFJRDFPKAZ6M`, publisher: "Amazon Seller Central Help", checked: "2026-10-23" },
  { id: AMZ.subscription, title: "Monthly subscription fee", url: `${HELP}G67WTAUHB9TQ9M6U`, publisher: "Amazon Seller Central Help", checked: "2026-10-23" },
  { id: AMZ.closing, title: "Closing fees", url: `${HELP}GKD9U5REK5DKB38Y`, publisher: "Amazon Seller Central Help", checked: "2026-10-23" },
  { id: AMZ.refund, title: "Refund administration fee", url: `${HELP}GDC3U6FWF4JJJJC7`, publisher: "Amazon Seller Central Help", checked: "2026-10-23" },
  { id: AMZ.categories, title: "Fee category guidelines for your products", url: `${HELP}GFD6HLGAEZC9VBGJ`, publisher: "Amazon Seller Central Help", checked: "2026-10-23" },
  { id: AMZ.handmade, title: "Amazon Handmade: Referral fees", url: `${HELP}G201814220`, publisher: "Amazon Seller Central Help", checked: "2026-10-23" },
  { id: AMZ.dsf, title: "Digital services fee", url: `${HELP}GMVQXVHHG8Q8KN7L`, publisher: "Amazon Seller Central Help", checked: "2026-10-23" },
  { id: AMZ.summary2026, title: "2026 US Referral and FBA fee changes summary", url: `${HELP}G201411300`, publisher: "Amazon Seller Central Help", checked: "2026-10-23" },
  {
    id: AMZ.news2026,
    title: "Update to U.S. Referral and Fulfillment by Amazon fees for 2026",
    url: "https://sellingpartners.aboutamazon.com/update-to-u-s-referral-and-fulfillment-by-amazon-fees-for-2026",
    publisher: "Amazon Selling Partners",
    checked: "2026-10-23",
  },
  {
    id: AMZ.news2025,
    title: "Update to US referral and Fulfillment by Amazon fees for 2025",
    url: "https://sellingpartners.aboutamazon.com/update-to-us-referral-and-fulfillment-by-amazon-fees-for-2025",
    publisher: "Amazon Selling Partners",
    checked: "2026-10-23",
  },
  { id: AMZ.nsp, title: "New Selection Program - 2026", url: `${HELP}GB36EVK8V94P8J5D`, publisher: "Amazon Seller Central Help", checked: "2026-10-23" },
  { id: AMZ.b2b, title: "Amazon Business bulk order fee discount", url: `${HELP}G2G7KPB963EMPEYD`, publisher: "Amazon Seller Central Help", checked: "2026-10-23" },
];

/* ------------------------------------------------------------- categories */

interface Tier {
  /** Upper edge in cents (inclusive), or null for "and above". */
  upTo: number | null;
  rate: number;
}

export interface RefCategory {
  id: string;
  label: string;
  kind: "flat" | "bracket" | "marginal";
  /** flat: the rate. */
  rate?: number;
  /** bracket / marginal: the bands, ascending. */
  tiers?: Tier[];
  /** Per-unit minimum referral fee in cents (0 = none). */
  min: number;
  /** $1.80 closing fee per unit (Media, Video Games, Video Game Consoles). */
  closing?: boolean;
  /** Not something FBA can fulfill (services). */
  noFba?: boolean;
  source?: string;
}

const flat = (id: string, label: string, rate: number, min = 30, extra: Partial<RefCategory> = {}): RefCategory => ({ id, label, kind: "flat", rate, min, ...extra });

/** Amazon's referral fee table (Seller Central "Referral fees", GTG4BAWSY39Z98Z3, 2026-10-23). */
export const CATEGORIES: RefCategory[] = [
  flat("amazon-device-accessories", "Amazon Device Accessories", 45),
  flat("automotive", "Automotive and Powersports", 12),
  { id: "baby", label: "Baby Products", kind: "bracket", tiers: [{ upTo: 1000, rate: 8 }, { upTo: null, rate: 15 }], min: 30 },
  flat("backpacks", "Backpacks, Handbags, and Luggage", 15),
  flat("power-tools", "Base Equipment Power Tools", 12),
  { id: "beauty", label: "Beauty, Health and Personal Care", kind: "bracket", tiers: [{ upTo: 1000, rate: 8 }, { upTo: null, rate: 15 }], min: 30 },
  flat("business-industrial", "Business, Industrial, and Scientific Supplies", 12),
  { id: "clothing", label: "Clothing and Accessories", kind: "bracket", tiers: [{ upTo: 1500, rate: 5 }, { upTo: 2000, rate: 10 }, { upTo: null, rate: 17 }], min: 30 },
  { id: "compact-appliances", label: "Compact Appliances", kind: "marginal", tiers: [{ upTo: 30000, rate: 15 }, { upTo: null, rate: 8 }], min: 30 },
  flat("computers", "Computers", 8),
  flat("consumer-electronics", "Consumer Electronics", 8),
  { id: "electronics-accessories", label: "Electronics Accessories", kind: "marginal", tiers: [{ upTo: 10000, rate: 15 }, { upTo: null, rate: 8 }], min: 30 },
  flat("everything-else", "Everything Else", 15),
  flat("eyewear", "Eyewear", 15),
  // Seller Central lists no minimum ("--"); sell.amazon.com/pricing mentions a $1.00 minimum on the first band. We follow Seller Central.
  {
    id: "fine-art",
    label: "Fine Art",
    kind: "marginal",
    tiers: [
      { upTo: 10000, rate: 20 },
      { upTo: 100000, rate: 15 },
      { upTo: 500000, rate: 10 },
      { upTo: null, rate: 5 },
    ],
    min: 0,
  },
  flat("footwear", "Footwear", 15),
  flat("full-size-appliances", "Full-Size Appliances", 8),
  { id: "furniture", label: "Furniture", kind: "marginal", tiers: [{ upTo: 20000, rate: 15 }, { upTo: null, rate: 10 }], min: 30 },
  flat("gift-cards", "Gift Cards", 20, 0),
  { id: "grocery", label: "Grocery and Gourmet", kind: "bracket", tiers: [{ upTo: 1500, rate: 8 }, { upTo: null, rate: 15 }], min: 0 },
  flat("home-kitchen", "Home and Kitchen", 15),
  { id: "jewelry", label: "Jewelry", kind: "marginal", tiers: [{ upTo: 25000, rate: 20 }, { upTo: null, rate: 5 }], min: 30 },
  flat("lawn-garden", "Lawn and Garden", 15),
  { id: "lawn-mowers", label: "Lawn Mowers and Snow Throwers", kind: "bracket", tiers: [{ upTo: 50000, rate: 15 }, { upTo: null, rate: 8 }], min: 30 },
  flat("mattresses", "Mattresses", 15),
  flat("media", "Media: Books, DVD, Music, Software, Video", 15, 0, { closing: true }),
  flat("services", "Merchant Fulfilled Services", 20, 30, { noFba: true }),
  flat("musical-instruments", "Musical Instruments and AV Production", 15),
  flat("office", "Office Products", 15),
  flat("pet", "Pet Products", 15),
  flat("pet-vet-diets", "Pet Products: veterinary diets", 22),
  flat("sports", "Sports and Outdoors", 15),
  flat("tires", "Tires", 10),
  flat("tools", "Tools and Home Improvement", 15),
  flat("toys", "Toys and Games", 15),
  flat("video-game-consoles", "Video Game Consoles", 8, 0, { closing: true }),
  flat("video-games", "Video Games and Gaming Accessories", 15, 0, { closing: true }),
  { id: "watches", label: "Watches", kind: "marginal", tiers: [{ upTo: 150000, rate: 16 }, { upTo: null, rate: 3 }], min: 30 },
  flat("handmade", "Amazon Handmade (any Handmade category)", 15, 30, { source: AMZ.handmade }),
];

export const DEFAULT_CATEGORY = "home-kitchen";

export function getCategory(id: string): RefCategory {
  return CATEGORIES.find((c) => c.id === id) ?? CATEGORIES.find((c) => c.id === DEFAULT_CATEGORY)!;
}

const usd = (cents: number) => moneyFor(M.us)(cents);
const usdShort = (cents: number) => (cents % 100 === 0 ? `$${(cents / 100).toLocaleString("en-US")}` : usd(cents));

/** Short description of a category's rule: "15%", "5% / 10% / 17% (whole price)", "15% to $100, 8% above". */
export function ruleText(c: RefCategory): string {
  if (c.kind === "flat") return formatRate(c.rate!);
  const t = c.tiers!;
  if (c.kind === "bracket") {
    const parts = t.map((x, i) => {
      if (x.upTo === null) return `${formatRate(x.rate)} above ${usdShort(t[i - 1].upTo!)}`;
      return `${formatRate(x.rate)} up to ${usdShort(x.upTo)}`;
    });
    return `${parts.join(", ")} (rate applies to the whole price)`;
  }
  const parts = t.map((x, i) => {
    if (i === 0) return `${formatRate(x.rate)} of the first ${usdShort(x.upTo!)}`;
    if (x.upTo === null) return `${formatRate(x.rate)} above ${usdShort(t[i - 1].upTo!)}`;
    return `${formatRate(x.rate)} from ${usdShort(t[i - 1].upTo!)} to ${usdShort(x.upTo)}`;
  });
  return parts.join(", ");
}

export function minText(c: RefCategory): string {
  return c.min ? `min ${usd(c.min)}` : "no minimum";
}

export function categoryOptions(forFba = false): SelectOption[] {
  return CATEGORIES.filter((c) => !(forFba && c.noFba)).map((c) => ({
    value: c.id,
    label: c.label,
    hint: `${ruleText(c).replace(" (rate applies to the whole price)", "")}${c.min ? "" : ", no minimum"}${c.closing ? " + $1.80" : ""}`,
  }));
}

export interface ReferralResult {
  amount: number;
  /** The arithmetic: "15% × $30.00". */
  detail: string;
  /** The rate of the bracket that applied (bracket categories) or the flat rate. */
  rate?: number;
  minApplied: boolean;
}

/** Referral fee for one unit, `base` = total sales price in cents (item + shipping charged + gift wrap, no tax). */
export function referralFee(c: RefCategory, base: number): ReferralResult {
  let exact = 0;
  let detail = "";
  let rate: number | undefined;
  if (c.kind === "flat") {
    rate = c.rate!;
    exact = (base * rate) / 100;
    detail = `${formatRate(rate)} × ${usd(base)}`;
  } else if (c.kind === "bracket") {
    const tier = c.tiers!.find((t) => t.upTo === null || base <= t.upTo)!;
    rate = tier.rate;
    exact = (base * rate) / 100;
    detail = `${formatRate(rate)} × ${usd(base)}`;
  } else {
    const parts: string[] = [];
    let lower = 0;
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
    detail = parts.join(" + ");
  }
  const rounded = roundCents(exact);
  const minApplied = c.min > 0 && rounded < c.min;
  if (minApplied) detail = `${detail} = ${usd(rounded)}, so the ${usd(c.min)} minimum applies`;
  return { amount: minApplied ? c.min : rounded, detail, rate, minApplied };
}

/** Plain-language explanation of how the category's rule applied to this price. */
export function referralExplain(c: RefCategory, base: number, fba: boolean): string {
  const what = fba
    ? "Charged on the item price plus any gift wrap the buyer pays, never on sales tax. Amazon counts shipping charges in this base only on orders you ship yourself."
    : "Charged on the total the buyer pays for the item, shipping and gift wrap, but never on sales tax.";
  let rule: string;
  if (c.kind === "flat") rule = `${c.label}: ${formatRate(c.rate!)}`;
  else if (c.kind === "bracket") {
    const tier = c.tiers!.find((t) => t.upTo === null || base <= t.upTo)!;
    rule = `${c.label}: ${ruleText(c)}, so ${formatRate(tier.rate)} of the whole ${usd(base)}`;
  } else rule = `${c.label}: ${ruleText(c)}, each rate only on the part of the price in its band`;
  const min = c.min ? ` Never less than ${usd(c.min)} per unit.` : " No minimum fee in this category.";
  return `${rule}. ${what}${min}`;
}

/** Edges (total sales price in cents) where a bracket category's rate jumps for the whole price. */
export function bracketEdges(c: RefCategory): number[] {
  if (c.kind !== "bracket") return [];
  return c.tiers!.filter((t) => t.upTo !== null).map((t) => t.upTo! + 1);
}

/**
 * A note when a bracket category's price sits near an edge: how much the fee jumps one cent above
 * it, or how much dropping to the edge would save. `base` and `priceShift` are in cents; the
 * price shown is the item price (base − shipping − gift wrap).
 */
export function bracketNote(c: RefCategory, base: number, priceShift: number): string | null {
  if (c.kind !== "bracket") return null;
  const tiers = c.tiers!;
  const idx = tiers.findIndex((t) => t.upTo === null || base <= t.upTo);
  const cur = tiers[idx];
  const next = tiers[idx + 1];
  const prev = tiers[idx - 1];
  const fee = referralFee(c, base).amount;
  // Just below an edge where the rate goes up.
  if (next && next.rate > cur.rate && cur.upTo !== null && cur.upTo - base <= 300) {
    const above = referralFee(c, cur.upTo + 1).amount;
    const extra = priceShift ? " including shipping and gift wrap" : "";
    return `${c.label}: your total of ${usd(base)}${extra} is in the ${formatRate(cur.rate)} band (${usd(cur.upTo)} or less). At ${usd(cur.upTo + 1)} the whole amount pays ${formatRate(next.rate)}: ${usd(above)} instead of ${usd(fee)}.`;
  }
  // Just above an edge where the rate went up: dropping to the edge saves money.
  if (prev && prev.upTo !== null && cur.rate > prev.rate && base - prev.upTo <= 300) {
    const at = referralFee(c, prev.upTo).amount;
    const target = prev.upTo - priceShift;
    if (target <= 0) return null;
    return `${c.label}: a total of ${usd(prev.upTo)} or less pays ${formatRate(prev.rate)} on the whole amount. Pricing at ${usd(target)} would cut the referral fee from ${usd(fee)} to ${usd(at)}.`;
  }
  return null;
}

/* ------------------------------------------------------------ plan, closing, DSF */

export const PROFESSIONAL_MONTHLY = 3999;
export const INDIVIDUAL_PER_ITEM = 99;
export const CLOSING_FEE = 180;

export function planLine(plan: string, unitsPerMonth: number, handmade: boolean): Line {
  if (plan === "individual") {
    return {
      id: "per-item",
      label: "Per-item fee (Individual plan)",
      amount: INDIVIDUAL_PER_ITEM,
      kind: "platform",
      detail: "$0.99 × 1 unit",
      explain: "Individual sellers pay $0.99 for every unit sold instead of a monthly fee. It isn’t refunded if you refund the order. Above 40 sales a month the Professional plan costs less.",
      source: AMZ.perItem,
    };
  }
  if (handmade) {
    return {
      id: "subscription",
      label: "Professional plan (waived for Handmade)",
      amount: 0,
      kind: "subscription",
      detail: "$0.00",
      explain: "Approved Amazon Handmade sellers on the Professional plan don’t pay the $39.99 monthly fee while they have eligible Handmade products for sale.",
      source: AMZ.handmade,
    };
  }
  const units = Math.max(1, Math.round(unitsPerMonth));
  return {
    id: "subscription",
    label: "Professional plan (share of $39.99/month)",
    amount: roundCents(PROFESSIONAL_MONTHLY / units),
    kind: "subscription",
    detail: `$39.99 ÷ ${units.toLocaleString("en-US")} sale${units === 1 ? "" : "s"} a month`,
    explain:
      "The Professional plan is $39.99 a month (not charged in months with no active listings) and has no per-item fee. We spread it over the sales you expect each month so you can see its real cost per order.",
    source: AMZ.subscription,
  };
}

export function closingLine(c: RefCategory): Line | null {
  if (!c.closing) return null;
  return {
    id: "closing",
    label: "Closing fee",
    amount: CLOSING_FEE,
    kind: "platform",
    detail: "$1.80 × 1 unit",
    explain: "A fixed $1.80 per unit on books, DVDs, music, software, video games, game consoles and gaming accessories, on top of the referral fee, on either selling plan.",
    source: AMZ.closing,
  };
}

/** Digital services fee by where the seller's business is established (US store). */
export const DSF: Record<string, { rate: number; label: string; onFba: boolean }> = {
  other: { rate: 0, label: "United States or anywhere else", onFba: false },
  uk: { rate: 2, label: "United Kingdom", onFba: true },
  fr: { rate: 3, label: "France", onFba: true },
  "it-es": { rate: 3, label: "Italy or Spain", onFba: false },
};

export const dsfField: FieldDef = {
  id: "establishment",
  kind: "select",
  label: "Where is your business established?",
  section: "options",
  advanced: true,
  options: [
    { value: "other", label: "United States or anywhere else", hint: "no extra fee" },
    { value: "uk", label: "United Kingdom", hint: "+2% on Amazon’s fees" },
    { value: "fr", label: "France", hint: "+3% on Amazon’s fees" },
    { value: "it-es", label: "Italy or Spain", hint: "+3% on selling fees" },
  ],
  help: "Sellers established in the UK, France, Italy or Spain pay a digital services fee on top of Amazon’s fees, even on US sales.",
};

/**
 * Digital services fee line: rate × each eligible fee, each part rounded up to the cent (as in
 * Amazon's own example). `selling` = referral / per-item / closing fees; `fba` = FBA fulfillment fees.
 */
export function dsfLine(establishment: string, selling: number[], fba: number[]): Line | null {
  const d = DSF[establishment];
  if (!d || !d.rate) return null;
  const parts = [...selling, ...(d.onFba ? fba : [])].filter((x) => x > 0);
  const base = parts.reduce((s, x) => s + x, 0);
  const amount = parts.reduce((s, x) => s + Math.ceil((x * d.rate) / 100 - 1e-9), 0);
  return {
    id: "dsf",
    label: `Digital services fee (${formatRate(d.rate)})`,
    amount,
    kind: "tax",
    detail: `${formatRate(d.rate)} × ${usd(base)} of fees`,
    explain: `Amazon passes on digital services taxes to sellers established in ${d.label}: ${formatRate(d.rate)} of the referral, per-item and closing fees${d.onFba ? " and of FBA fulfillment fees" : " (not FBA fees)"}, each part rounded up to the cent.`,
    source: AMZ.dsf,
  };
}

/**
 * Refund administration fee on a full refund of one line item: the lesser of $5.00 or 20% of its
 * referral fee; $0 for books, music, video and DVD (the Media fee category).
 */
export function refundAdminFee(c: RefCategory, referral: number): number {
  if (c.id === "media") return 0;
  return Math.min(500, roundCents((referral * 20) / 100));
}

/** The refund administration fee Amazon would keep if this order were fully refunded. */
export function refundNote(c: RefCategory, referral: number): string {
  if (c.id === "media") {
    return "If you fully refund this order, Amazon gives back the whole referral fee for books, music, video and DVDs (it keeps the closing fee on a partial refund).";
  }
  const admin = refundAdminFee(c, referral);
  return `If you refund this order, Amazon returns the referral fee minus a refund administration fee of ${usd(admin)} (20% of it, never more than $5.00 per item).`;
}

/* ------------------------------------------------------------------ module */

const changes: FeeChange[] = [
  {
    date: "2026-10-31",
    text: "3D printers and 3D printing pens move from Business, Industrial & Scientific Supplies (12%) to a new “3D Printers” fee category. Amazon hasn’t published the new category’s rate yet; accessories such as nozzles and filament stay at 12%.",
    source: AMZ.categories,
    upcoming: true,
  },
  {
    date: "2026-07-30",
    text: "New Selection Program (2026): for new branded FBA products, the first 100 units sold within 120 days of the first FBA delivery pay 10% (or less), the next 100 pay 5% (or less).",
    source: AMZ.nsp,
  },
  {
    date: "2026-01-15",
    text: "2026 fee update (announced October 15, 2025): no change to US referral fee rates or the $39.99 / $0.99 selling plans. FBA fees rose by $0.08 per unit on average.",
    source: AMZ.news2026,
  },
  {
    date: "2025-10-01",
    text: "Amazon Business bulk order discount: lower referral rates on the part of a business order above $1,000 for one product, when you offer at least 3% off through business or quantity pricing.",
    source: AMZ.b2b,
  },
  { date: "2024-11-19", text: "Amazon announced no increase to US referral fees or FBA fees for 2025, after lowering referral fees on low-priced clothing in 2024 (5% up to $15, 10% from $15 to $20).", source: AMZ.news2025 },
];

function calculate(inputs: Inputs, market: Market) {
  const cat = getCategory(str(inputs, "category", DEFAULT_CATEGORY));
  const price = toCents(num(inputs, "price"));
  const shipping = toCents(num(inputs, "shippingCharged"));
  const giftWrap = toCents(num(inputs, "giftWrap"));
  const base = price + shipping + giftWrap;
  const plan = str(inputs, "plan", "professional");
  const handmade = cat.id === "handmade";

  const fees: Line[] = [];
  const ref = referralFee(cat, base);
  fees.push({
    id: "referral",
    label: "Referral fee",
    amount: ref.amount,
    kind: "platform",
    detail: ref.detail,
    explain: referralExplain(cat, base, false),
    source: cat.source ?? AMZ.referral,
  });
  const closing = closingLine(cat);
  if (closing) fees.push(closing);
  const planFee = planLine(plan, num(inputs, "unitsPerMonth", 100), handmade);
  fees.push(planFee);

  const dsf = dsfLine(str(inputs, "establishment", "other"), [ref.amount, closing?.amount ?? 0, plan === "individual" ? planFee.amount : 0], []);
  if (dsf) fees.push(dsf);

  const ads = toCents(num(inputs, "adCost"));
  if (ads) {
    fees.push({
      id: "ads",
      label: "Sponsored Products ads",
      amount: ads,
      kind: "ads",
      detail: "Your average ad cost per sale",
      explain: "Amazon ads are paid per click, separately from selling fees. Enter your ad spend divided by all units sold to see the cost per order.",
    });
  }

  const notes: string[] = [];
  const bn = bracketNote(cat, base, shipping + giftWrap);
  if (bn) notes.push(bn);
  if (cat.id === "business-industrial") notes.push("3D printers and 3D printing pens get their own fee category on October 31, 2026. Amazon hasn’t published its rate yet, so this uses today’s 12%.");
  notes.push(refundNote(cat, ref.amount));

  const warnings: string[] = [];
  if (handmade && plan === "individual") warnings.push("Handmade referral rates need a Professional plan. On the Individual plan Amazon charges the standard rate for the product’s category.");

  return assemble({
    market,
    buyerPays: base,
    saleAmount: base,
    fees,
    costs: costLines(inputs, market),
    notes,
    warnings,
  });
}

function schedule(): ScheduleRow[] {
  const rows: ScheduleRow[] = [
    { fee: "Professional plan", amount: "$39.99 / month", appliesTo: "Your account", when: "Months with active listings", source: AMZ.subscription },
    { fee: "Individual plan", amount: "$0.99 per unit", appliesTo: "Each unit sold (no monthly fee)", when: "Individual plan only", source: AMZ.perItem },
    {
      fee: "Referral fee",
      amount: "8%–45% by category, most 15%",
      appliesTo: "Item price + shipping + gift wrap (not sales tax), per unit",
      when: "Every sale; the greater of the rate or the category minimum (usually $0.30)",
      source: AMZ.referral,
    },
  ];
  for (const c of CATEGORIES) {
    rows.push({
      fee: `Referral: ${c.label}`,
      amount: `${ruleText(c).replace(" (rate applies to the whole price)", " (whole price)")}; ${minText(c)}`,
      appliesTo: c.kind === "bracket" ? "Whole total sales price, rate set by its bracket" : c.kind === "marginal" ? "Each part of the total sales price at its band’s rate" : "Total sales price",
      when: c.id === "handmade" ? "Approved Handmade sellers on the Professional plan" : c.closing ? "Plus the $1.80 closing fee" : undefined,
      source: c.source ?? AMZ.referral,
    });
  }
  rows.push(
    { fee: "Closing fee", amount: "$1.80 per unit", appliesTo: "Books, DVD, music, software, video games, consoles, gaming accessories", source: AMZ.closing },
    { fee: "Refund administration fee", amount: "20% of the referral fee, max $5.00", appliesTo: "Per refunded item (not books, music, video or DVD on a full refund)", when: "When you refund an order", source: AMZ.refund },
    { fee: "Digital services fee", amount: "2% (UK) or 3% (France, Italy, Spain)", appliesTo: "Amazon’s selling fees (UK/France: FBA fees too)", when: "Sellers established in those countries", source: AMZ.dsf },
    { fee: "High-volume listing fee", amount: "$0.001 per SKU / month", appliesTo: "Active SKUs above 1.5 million", source: AMZ.schedule },
    { fee: "Rental book service fee", amount: "$5.00 per book", appliesTo: "Each textbook rented", source: AMZ.schedule },
  );
  return rows;
}

const fields: FieldDef[] = [
  { id: "price", kind: "money", label: "Item price", section: "sale", help: "Your selling price per unit, before sales tax." },
  {
    id: "category",
    kind: "select",
    label: "Amazon fee category",
    section: "sale",
    searchable: true,
    options: categoryOptions(false),
    help: "Use the fee category Amazon shows in Manage Inventory or the Fee Preview report; it can differ from where the product appears in the store.",
  },
  {
    id: "plan",
    kind: "segmented",
    label: "Selling plan",
    section: "sale",
    options: [
      { value: "professional", label: "Professional · $39.99/mo" },
      { value: "individual", label: "Individual · $0.99/item" },
    ],
    help: "Professional pays off above 40 sales a month.",
  },
  {
    id: "unitsPerMonth",
    kind: "number",
    label: "Units you sell per month",
    section: "sale",
    integer: true,
    min: 1,
    max: 1000000,
    unit: "units",
    help: "We spread the $39.99 monthly fee over these sales.",
    showIf: (i) => str(i, "plan", "professional") === "professional" && str(i, "category", DEFAULT_CATEGORY) !== "handmade",
  },
  { id: "giftWrap", kind: "money", label: "Gift wrap charged", section: "sale", advanced: true, help: "Amazon takes the referral fee on gift wrap too." },
  { id: "shippingCharged", kind: "money", label: "Shipping you charge the buyer", section: "shipping", help: "Amazon takes the same referral fee on this, so free shipping built into the price costs the same." },
  { id: "adCost", kind: "money", label: "Ad cost per sale", section: "options", advanced: true, help: "Optional: your Sponsored Products spend divided by units sold." },
  dsfField,
  { id: "itemCost", kind: "money", label: "What the item cost you", section: "costs", help: "Product cost per unit." },
  { id: "shippingCost", kind: "money", label: "Postage / label you pay", section: "costs" },
  { id: "otherCost", kind: "money", label: "Packaging & other", section: "costs" },
];

export const amazon: CalculatorDef = {
  slug: "amazon",
  name: "Amazon",
  path: "/amazon-fee-calculator",
  category: "marketplaces",
  priceNoun: "item price",
  sellerNoun: "seller",
  blurb: "8–45% referral fee by category (most 15%, min $0.30) + $39.99/month or $0.99/item",
  markets: [M.us],
  defaultMarket: "us",
  priceField: "price",
  fields,
  defaults: () => ({
    price: 25,
    category: DEFAULT_CATEGORY,
    plan: "professional",
    unitsPerMonth: 100,
    giftWrap: 0,
    shippingCharged: 5,
    adCost: 0,
    establishment: "other",
    itemCost: 0,
    shippingCost: 0,
    otherCost: 0,
  }),
  calculate,
  breakpoints: (inputs) => {
    // Bracket categories charge one rate on the whole price, so the payout drops one cent past each edge.
    const cat = getCategory(str(inputs, "category", DEFAULT_CATEGORY));
    const shift = toCents(num(inputs, "shippingCharged")) + toCents(num(inputs, "giftWrap"));
    return bracketEdges(cat).map((e) => e - shift).filter((p) => p > 0);
  },
  verifiedAt: "2026-10-23",
  sources: AMAZON_SOURCES,
  changes,
  schedule,
  compare: {
    group: "sell",
    map: (c) => ({ price: c.price, shippingCharged: c.shipping, itemCost: c.itemCost, shippingCost: c.shippingCost }),
    note: "You ship it; Home & Kitchen (15%); Professional plan spread over 100 sales a month",
  },
};

export default amazon;
