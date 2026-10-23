/*
 * Amazon FBA (Fulfillment by Amazon, amazon.com US) fees for one unit sold. Every number is from
 * Amazon's own help pages (see `sources`), re-read on 2026-10-23 through the help center's content
 * API; the rate cards below were parsed straight from "2026 US FBA fulfillment fee changes"
 * (GABBX6GZPA8MSZGW, version 58) and cross-checked against the Low-Price FBA page (GMUTB89XM7AATPR3).
 * Research notes: research/fees/amazon-fba.md (and amazon-referral.md for the referral fee).
 *
 * How a unit's fees are computed (what this module reproduces):
 *  - Referral fee and closing fee: same rules as the merchant-fulfilled calculator (./amazon), on
 *    the item price + gift wrap. Amazon counts shipping in that base only when you ship yourself.
 *  - Size tier from the packaged dimensions and unit weight (2026 tiers): Small standard (≤16 oz,
 *    ≤15×12×0.75 in), Large standard (≤20 lb, ≤18×14×8 in), Small Bulky (≤50 lb, ≤37×28×20 in,
 *    length + girth ≤130 in), Large Bulky (≤50 lb, ≤59×33×33 in, ≤130 in), else Extra-Large in four
 *    weight bands. Dimensional weight = L × W × H ÷ 139; for Bulky and Extra-Large the width and
 *    height count as at least 2 in. Shipping weight = unit weight for Small standard and
 *    Extra-Large 150+ lb, otherwise the greater of unit and dimensional weight. Amazon adds no
 *    separate packaging weight: "unit weight" is the weight of the packaged item.
 *  - Fulfillment fee from the rate card for the fee type (apparel = the Clothing and Accessories
 *    category, dangerous goods, everything else), the season (holiday peak Oct 15, 2026 – Jan 14,
 *    2027, or non-peak) and the price band (<$10, $10–$50 inclusive, >$50). Above a table row the
 *    fee adds a step per started interval (4 oz, half-lb for apparel, or 1 lb), as in every one of
 *    Amazon's worked examples on the fee page.
 *  - 3.5% fuel and logistics surcharge on the fulfillment fee (from April 17, 2026, no end date).
 *    Amazon doesn't say how it rounds it or whether it applies to add-on fees; we round per unit
 *    and apply it to the fulfillment fee only (after any SIPP discount, which lowers that fee).
 *  - Add-ons: SIPP discount (standard size), Bulky packaging fee (Bulky items not in SIPP, by
 *    dimensional weight), Overmax handling fee, $0.11 lithium battery fee.
 *  - Monthly storage: cubic feet (L × W × H ÷ 1,728) × the month's rate × months stored, plus the
 *    storage utilization surcharge on inventory older than 30 days when chosen.
 *  - Inbound placement fee: Amazon publishes ranges that vary by region; we use the top of the range.
 */
import { M } from "../markets";
import { assemble, bool, moneyFor, num, pct, roundCents, str, toCents } from "../money";
import type { CalculatorDef, FeeChange, FieldDef, Inputs, Line, Market, ScheduleRow, Source } from "../types";
import {
  AMAZON_SOURCES,
  AMZ,
  DEFAULT_CATEGORY,
  bracketEdges,
  bracketNote,
  categoryOptions,
  closingLine,
  dsfField,
  dsfLine,
  getCategory,
  planLine,
  referralExplain,
  referralFee,
  refundNote,
} from "./amazon";

/* ------------------------------------------------------------------ sources */

const HELP = "https://sellercentral.amazon.com/help/hub/reference/external/";

const S = {
  fba: "fba-fulfillment-2026",
  fbaFee: "fba-fulfillment-fee",
  lowPrice: "fba-low-price",
  sizeTiers: "fba-size-tiers",
  dimWeight: "fba-dim-weight",
  shipWeight: "fba-shipping-weight",
  fuel: "fba-fuel-surcharge",
  storage: "fba-storage",
  aged: "fba-aged",
  lowInventory: "fba-low-inventory",
  placement: "fba-placement",
  sipp: "fba-sipp",
  overmax: "fba-overmax",
  lithium: "fba-lithium",
  returns: "fba-returns",
  prep: "fba-prep",
} as const;

const help = (id: string, title: string, guid: string): Source => ({ id, title, url: `${HELP}${guid}`, publisher: "Amazon Seller Central Help", checked: "2026-10-23" });

const sources: Source[] = [
  help(S.fba, "2026 US FBA fulfillment fee changes", "GABBX6GZPA8MSZGW"),
  help(S.fbaFee, "FBA fulfillment fee", "GPDC3KPYAGDTVDJP"),
  help(S.lowPrice, "2026 US Low Price FBA fulfillment fee", "GMUTB89XM7AATPR3"),
  help(S.sizeTiers, "Product size tiers", "GG5KW835AHDJCH8W"),
  help(S.dimWeight, "Dimensional weight", "G53Z9EKF8VVZVH29"),
  help(S.shipWeight, "Shipping weight", "GEVWP48HPBLEFJEY"),
  {
    id: S.fuel,
    title: "Fuel and logistics-related surcharge: FBA, MCF, and BWP in US and CA",
    url: "https://sellercentral.amazon.com/seller-forums/discussions/t/7cbc0233-ee5b-4359-978a-dee7cad5c6f4",
    publisher: "Amazon Seller Forums (News_Amazon announcement)",
    checked: "2026-10-23",
  },
  help(S.storage, "Monthly inventory storage fees", "G3EDYEF6KUCFQTNM"),
  help(S.aged, "Aged inventory surcharge", "GJQNPA23YWVA4SBD"),
  help(S.lowInventory, "Low-inventory-level fee", "GV43F6S76Y9DHYRH"),
  help(S.placement, "FBA inbound placement service fee", "GC3Q44PBK8BXQW3Z"),
  help(S.sipp, "Ships in Product Packaging (SIPP) FBA fulfillment fee", "GFGVB6C7ZF38285W"),
  help(S.overmax, "Overmax Handling Fee", "GGCGMQHGX95C5CB8"),
  help(S.lithium, "Lithium batteries fee", "G9RJJ3KFHSF6YRAG"),
  help(S.returns, "2026 returns processing fee changes", "GZGEQLTM3RZXUV6T"),
  help(S.prep, "FBA Prep Service", "G201023020"),
  ...AMAZON_SOURCES,
];

/* --------------------------------------------------------------- rate cards */

/** Cents for the three price bands: [under $10, $10–$50, over $50]. */
type Band = [number, number, number];

interface RateCard {
  /** Small standard: 2, 4, 6, 8, 10, 12, 14, 16 oz. */
  small: Band[];
  /** Large standard: 4, 8, 12, 16 oz, then 1.25 … 3 lb in quarter-pound rows. */
  large: Band[];
  /** Large standard 3+ to 20 lb: base for the first 3 lb (+ step per started interval). */
  large3: Band;
  smallBulky: Band;
  largeBulky: Band;
  xl50: Band;
  xl70: Band;
  xl150: Band;
  xl150plus: Band;
}

export type FeeType = "nonApparel" | "apparel" | "dangerous";
export type Season = "peak" | "nonpeak";

/** 2026 rate cards (fuel surcharge not included), straight from GABBX6GZPA8MSZGW. */
export const RATES: Record<FeeType, Record<Season, RateCard>> = {
  nonApparel: {
    nonpeak: {
      small: [[243, 332, 358], [249, 342, 368], [256, 345, 371], [266, 354, 380], [277, 368, 394], [282, 378, 404], [292, 391, 417], [295, 396, 422]],
      large: [[291, 373, 399], [313, 395, 421], [338, 420, 446], [378, 460, 486], [422, 504, 530], [460, 542, 568], [475, 557, 583], [500, 582, 608], [510, 592, 618], [528, 610, 636], [544, 626, 652], [585, 667, 693]],
      large3: [615, 697, 723],
      smallBulky: [678, 755, 755],
      largeBulky: [858, 935, 935],
      xl50: [2556, 2633, 2633],
      xl70: [3655, 3732, 3732],
      xl150: [5055, 5132, 5132],
      xl150plus: [19418, 19495, 19495],
    },
    peak: {
      small: [[262, 351, 377], [268, 361, 387], [276, 365, 391], [286, 374, 400], [298, 389, 415], [303, 399, 425], [314, 413, 439], [317, 418, 444]],
      large: [[315, 397, 423], [339, 421, 447], [366, 448, 474], [407, 489, 515], [452, 534, 560], [491, 573, 599], [507, 589, 615], [533, 615, 641], [547, 629, 655], [567, 649, 675], [584, 666, 692], [626, 708, 734]],
      large3: [669, 751, 777],
      smallBulky: [782, 859, 859],
      largeBulky: [962, 1039, 1039],
      xl50: [2829, 2906, 2906],
      xl70: [3936, 4013, 4013],
      xl150: [5497, 5574, 5574],
      xl150plus: [20269, 20346, 20346],
    },
  },
  apparel: {
    nonpeak: {
      small: [[262, 351, 377], [264, 354, 380], [268, 359, 385], [281, 369, 395], [300, 391, 417], [310, 409, 435], [320, 420, 446], [330, 425, 451]],
      large: [[348, 430, 456], [368, 450, 476], [390, 472, 498], [435, 517, 543], [505, 587, 613], [522, 604, 630], [532, 614, 640], [543, 625, 651], [578, 660, 686], [590, 672, 698], [595, 677, 703], [608, 690, 716]],
      large3: [615, 697, 723],
      smallBulky: [678, 755, 755],
      largeBulky: [858, 935, 935],
      xl50: [2556, 2633, 2633],
      xl70: [3655, 3732, 3732],
      xl150: [5055, 5132, 5132],
      xl150plus: [19418, 19495, 19495],
    },
    peak: {
      small: [[285, 374, 400], [287, 377, 403], [293, 384, 410], [306, 394, 420], [327, 418, 444], [337, 436, 462], [349, 449, 475], [359, 454, 480]],
      large: [[379, 461, 487], [400, 482, 508], [423, 505, 531], [469, 551, 577], [542, 624, 650], [559, 641, 667], [571, 653, 679], [582, 664, 690], [622, 704, 730], [634, 716, 742], [641, 723, 749], [654, 736, 762]],
      large3: [682, 764, 790],
      smallBulky: [782, 859, 859],
      largeBulky: [962, 1039, 1039],
      xl50: [2829, 2906, 2906],
      xl70: [3936, 4013, 4013],
      xl150: [5497, 5574, 5574],
      xl150plus: [20269, 20346, 20346],
    },
  },
  dangerous: {
    nonpeak: {
      small: [[340, 429, 455], [343, 436, 462], [348, 437, 463], [355, 443, 469], [364, 455, 481], [365, 461, 487], [373, 472, 498], [377, 478, 504]],
      large: [[373, 455, 481], [394, 476, 502], [417, 499, 525], [437, 519, 545], [482, 564, 590], [520, 602, 628], [535, 617, 643], [549, 631, 657], [556, 638, 664], [574, 656, 682], [590, 672, 698], [631, 713, 739]],
      large3: [661, 743, 769],
      smallBulky: [750, 827, 827],
      largeBulky: [930, 1007, 1007],
      xl50: [2767, 2844, 2844],
      xl70: [3976, 4053, 4053],
      xl150: [5768, 5845, 5845],
      xl150plus: [21876, 21953, 21953],
    },
    peak: {
      small: [[374, 463, 489], [380, 473, 499], [388, 477, 503], [398, 486, 512], [410, 501, 527], [414, 510, 536], [425, 524, 550], [432, 533, 559]],
      large: [[432, 514, 540], [456, 538, 564], [482, 564, 590], [504, 586, 612], [551, 633, 659], [591, 673, 699], [608, 690, 716], [624, 706, 732], [633, 715, 741], [653, 735, 761], [670, 752, 778], [712, 794, 820]],
      large3: [751, 833, 859],
      smallBulky: [906, 983, 983],
      largeBulky: [1086, 1163, 1163],
      xl50: [3171, 3248, 3248],
      xl70: [4386, 4463, 4463],
      xl150: [6404, 6481, 6481],
      xl150plus: [23084, 23161, 23161],
    },
  },
};

const SMALL_MAX_OZ = [2, 4, 6, 8, 10, 12, 14, 16];
const LARGE_MAX_LB = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3];

/** Holiday peak fulfillment fees apply to units that leave the fulfillment center from Oct 15, 2026 to Jan 14, 2027. */
export const PEAK_START = Date.UTC(2026, 9, 15);
export const PEAK_END = Date.UTC(2027, 0, 15);

export function fbaSeason(at: number = Date.now()): Season {
  return at >= PEAK_START && at < PEAK_END ? "peak" : "nonpeak";
}

/** Storage: October–December is the peak period. */
export function storageSeason(at: number = Date.now()): "offpeak" | "peak" {
  return new Date(at).getUTCMonth() >= 9 ? "peak" : "offpeak";
}

/* ---------------------------------------------------------------- size tier */

export type SizeTier = "small-standard" | "large-standard" | "small-bulky" | "large-bulky" | "xl-0-50" | "xl-50-70" | "xl-70-150" | "xl-150-plus";

export const TIER_LABEL: Record<SizeTier, string> = {
  "small-standard": "Small standard",
  "large-standard": "Large standard",
  "small-bulky": "Small Bulky",
  "large-bulky": "Large Bulky",
  "xl-0-50": "Extra-Large 0 to 50 lb",
  "xl-50-70": "Extra-Large 50+ to 70 lb",
  "xl-70-150": "Extra-Large 70+ to 150 lb",
  "xl-150-plus": "Extra-Large 150+ lb",
};

export interface SizeInfo {
  tier: SizeTier;
  longest: number;
  median: number;
  shortest: number;
  /** Packaged unit weight, lb. */
  unitWeight: number;
  /** Dimensional weight as Amazon uses it for this tier (2-inch minimum for Bulky / Extra-Large), lb. */
  dimWeight: number;
  /** The weight the fee is looked up with, lb. */
  shippingWeight: number;
  /** True when the dimensional weight is the one used. */
  usesDim: boolean;
  lengthPlusGirth: number;
  overmax: boolean;
  cubicFeet: number;
}

const EPS = 1e-9;
const le = (a: number, b: number) => a <= b + EPS;
const ceilE = (x: number) => Math.ceil(x - EPS);

/** Classify a packaged item (inches, pounds) into Amazon's 2026 size tiers. */
export function sizeTier(dims: number[], unitWeight: number): SizeInfo {
  const [L, Mi, S] = dims.map((d) => Math.max(0, d)).sort((a, b) => b - a);
  const W = Math.max(0, unitWeight);
  const lg = L + 2 * (Mi + S);
  const cubicFeet = (L * Mi * S) / 1728;
  const dimStd = (L * Mi * S) / 139;
  const base = { longest: L, median: Mi, shortest: S, unitWeight: W, lengthPlusGirth: lg, cubicFeet };
  if (le(W, 1) && le(L, 15) && le(Mi, 12) && le(S, 0.75)) {
    return { ...base, tier: "small-standard", dimWeight: dimStd, shippingWeight: W, usesDim: false, overmax: false };
  }
  if (le(Math.max(W, dimStd), 20) && le(L, 18) && le(Mi, 14) && le(S, 8)) {
    return { ...base, tier: "large-standard", dimWeight: dimStd, shippingWeight: Math.max(W, dimStd), usesDim: dimStd > W, overmax: false };
  }
  const dimB = (L * Math.max(Mi, 2) * Math.max(S, 2)) / 139;
  const sw = Math.max(W, dimB);
  const usesDim = dimB > W;
  if (le(sw, 50) && le(L, 37) && le(Mi, 28) && le(S, 20) && le(lg, 130)) return { ...base, tier: "small-bulky", dimWeight: dimB, shippingWeight: sw, usesDim, overmax: false };
  if (le(sw, 50) && le(L, 59) && le(Mi, 33) && le(S, 33) && le(lg, 130)) return { ...base, tier: "large-bulky", dimWeight: dimB, shippingWeight: sw, usesDim, overmax: false };
  if (W > 150 + EPS) return { ...base, tier: "xl-150-plus", dimWeight: dimB, shippingWeight: W, usesDim: false, overmax: false };
  // Overmax as Amazon words it: Extra-Large up to 150 lb that is over 96 in long or over 130 in length + girth.
  const overmax = L > 96 + EPS || lg > 130 + EPS;
  const tier: SizeTier = le(sw, 50) ? "xl-0-50" : le(sw, 70) ? "xl-50-70" : "xl-70-150";
  return { ...base, tier, dimWeight: dimB, shippingWeight: sw, usesDim, overmax };
}

export const isStandard = (t: SizeTier) => t === "small-standard" || t === "large-standard";
export const isBulky = (t: SizeTier) => t === "small-bulky" || t === "large-bulky";

function fmtLb(x: number): string {
  return `${Number(x.toFixed(2))}`;
}

/** Shipping-weight band label as Amazon's table prints it ("6+ to 8 oz", "3.25+ to 3.5 lb", "7+ to 8 lb"). */
export function weightBand(s: SizeInfo, feeType: FeeType): string {
  const w = s.shippingWeight;
  if (s.tier === "small-standard") {
    const i = SMALL_MAX_OZ.findIndex((m) => le(w * 16, m));
    return i <= 0 ? "2 oz or less" : `${SMALL_MAX_OZ[i - 1]}+ to ${SMALL_MAX_OZ[i]} oz`;
  }
  if (s.tier === "large-standard") {
    const i = LARGE_MAX_LB.findIndex((m) => le(w, m));
    if (i === 0) return "4 oz or less";
    if (i > 0 && i <= 3) return `${LARGE_MAX_LB[i - 1] * 16}+ to ${LARGE_MAX_LB[i] * 16} oz`;
    if (i > 3) return `${fmtLb(LARGE_MAX_LB[i - 1])}+ to ${fmtLb(LARGE_MAX_LB[i])} lb`;
    const step = feeType === "apparel" ? 0.5 : 0.25;
    const n = ceilE((w - 3) / step);
    return `${fmtLb(3 + (n - 1) * step)}+ to ${fmtLb(3 + n * step)} lb`;
  }
  const n = Math.max(1, ceilE(w));
  return n <= 1 ? "1 lb or less" : `${n - 1}+ to ${n} lb`;
}

/** Price band index: under $10, $10–$50 (both ends included), over $50. */
export function priceBand(priceCents: number): 0 | 1 | 2 {
  return priceCents < 1000 ? 0 : priceCents <= 5000 ? 1 : 2;
}

const BAND_LABEL = ["under $10", "$10–$50", "over $50"];

export interface Fulfillment {
  amount: number;
  detail: string;
}

/** The fulfillment fee for one unit from the 2026 rate card (no surcharge). */
export function fulfillmentFee(s: SizeInfo, feeType: FeeType, season: Season, band: 0 | 1 | 2): Fulfillment {
  const card = RATES[feeType][season];
  const money = moneyFor(M.us);
  const w = s.shippingWeight;
  if (s.tier === "small-standard") {
    const i = Math.max(0, SMALL_MAX_OZ.findIndex((m) => le(w * 16, m)));
    return { amount: card.small[i][band], detail: "" };
  }
  if (s.tier === "large-standard") {
    const i = LARGE_MAX_LB.findIndex((m) => le(w, m));
    if (i >= 0) return { amount: card.large[i][band], detail: "" };
    const apparel = feeType === "apparel";
    const step = apparel ? 0.5 : 0.25;
    const inc = apparel ? 16 : 8;
    const n = ceilE((w - 3) / step);
    const amount = card.large3[band] + inc * n;
    return { amount, detail: `${money(card.large3[band])} + ${money(inc)} × ${n} ${apparel ? "half-lb" : "4-oz"} step${n === 1 ? "" : "s"} over 3 lb` };
  }
  const perLb = (baseFee: number, inc: number, from: number, weight: number) => {
    const n = Math.max(0, ceilE(weight) - from);
    return { amount: baseFee + inc * n, detail: `${money(baseFee)} + ${money(inc)} × ${n} lb over ${from} lb` };
  };
  switch (s.tier) {
    case "small-bulky":
      return perLb(card.smallBulky[band], 38, 1, w);
    case "large-bulky":
      return perLb(card.largeBulky[band], 38, 1, w);
    case "xl-0-50":
      return perLb(card.xl50[band], 38, 1, w);
    case "xl-50-70":
      return perLb(card.xl70[band], 75, 51, w);
    case "xl-70-150":
      return perLb(card.xl150[band], 75, 71, w);
    default:
      return perLb(card.xl150plus[band], 19, 151, w);
  }
}

/* ------------------------------------------------------------------ add-ons */

/** SIPP discount per certified standard-size unit (cents): [small 2…16 oz], [large rows], 3+ lb. */
const SIPP = {
  nonApparel: { small: [4, 4, 5, 5, 6, 6, 7, 7], large: [4, 4, 7, 8, 9, 9, 10, 11, 12, 13, 14, 14], large3: 23 },
  apparel: { small: [6, 6, 7, 7, 7, 7, 7, 7], large: [6, 6, 6, 7, 8, 8, 9, 9, 12, 12, 14, 14], large3: 22 },
};

export function sippDiscount(s: SizeInfo, feeType: FeeType): number {
  if (!isStandard(s.tier) || feeType === "dangerous") return 0;
  const t = SIPP[feeType];
  if (s.tier === "small-standard") return t.small[Math.max(0, SMALL_MAX_OZ.findIndex((m) => le(s.shippingWeight * 16, m)))];
  const i = LARGE_MAX_LB.findIndex((m) => le(s.shippingWeight, m));
  return i >= 0 ? t.large[i] : t.large3;
}

/** Packaging fee for Small / Large Bulky items not in SIPP, by dimensional weight (upper edges in lb). */
const PACKAGING: [number, number][] = [
  [5, 151],
  [10, 168],
  [15, 197],
  [20, 260],
  [25, 292],
  [30, 347],
  [35, 360],
  [40, 378],
  [45, 380],
  [Infinity, 404],
];

export function bulkyPackagingFee(dimWeight: number): number {
  return PACKAGING.find(([upTo]) => le(dimWeight, upTo))![1];
}

export function overmaxFee(t: SizeTier): number {
  return t === "xl-0-50" ? 1700 : t === "xl-50-70" ? 2100 : t === "xl-70-150" ? 2500 : 0;
}

export const FUEL_SURCHARGE = 3.5;
export const LITHIUM_FEE = 11;

/** Monthly storage per cubic foot, cents: [standard, oversize]. */
const STORAGE = {
  regular: { offpeak: [78, 56], peak: [240, 140] },
  dangerous: { offpeak: [99, 78], peak: [363, 243] },
} as const;

/** Storage utilization surcharge per cubic foot (cents) on inventory aged over 30 days: [standard, oversize]. */
const UTILIZATION: Record<string, { label: string; std: number; over: number }> = {
  below22: { label: "Below 22 weeks (or new / Individual seller, or ≤25 cu ft)", std: 0, over: 0 },
  "22-28": { label: "22–28 weeks", std: 44, over: 23 },
  "28-36": { label: "28–36 weeks", std: 76, over: 46 },
  "36-44": { label: "36–44 weeks", std: 116, over: 63 },
  "44-52": { label: "44–52 weeks", std: 158, over: 76 },
  "52+": { label: "52+ weeks", std: 188, over: 126 },
};

/** Inbound placement fee ranges (cents, [low, high]) for shipment plans created from Jan 15, 2026. */
const PLACEMENT_STD: { tier: SizeTier; upToLb: number; range: [number, number] }[] = [
  { tier: "small-standard", upToLb: 0.5, range: [14, 32] },
  { tier: "small-standard", upToLb: 1, range: [16, 32] },
  { tier: "large-standard", upToLb: 0.75, range: [20, 40] },
  { tier: "large-standard", upToLb: 1.5, range: [24, 50] },
  { tier: "large-standard", upToLb: 3, range: [34, 60] },
  { tier: "large-standard", upToLb: 5, range: [38, 76] },
  { tier: "large-standard", upToLb: 7, range: [40, 98] },
  { tier: "large-standard", upToLb: 10, range: [42, 120] },
  { tier: "large-standard", upToLb: 15, range: [44, 150] },
  { tier: "large-standard", upToLb: 20, range: [55, 190] },
];
const BULKY_WEIGHTS = [5, 12, 28, 42, 50];
const PLACEMENT_BULKY: Record<"small-bulky" | "large-bulky", { minimal: [number, number][]; partial: [number, number][] }> = {
  "small-bulky": {
    minimal: [
      [110, 160],
      [175, 240],
      [274, 350],
      [395, 495],
      [480, 595],
    ],
    partial: [
      [55, 110],
      [65, 175],
      [81, 219],
      [105, 283],
      [123, 332],
    ],
  },
  "large-bulky": {
    minimal: [
      [130, 180],
      [210, 290],
      [340, 410],
      [470, 560],
      [550, 650],
    ],
    partial: [
      [55, 125],
      [65, 180],
      [81, 230],
      [105, 295],
      [123, 350],
    ],
  },
};

/** The published per-unit range for a placement option, or null when there is no fee. */
export function placementRange(s: SizeInfo, option: string): [number, number] | null {
  if (option !== "minimal" && option !== "partial") return null;
  if (isStandard(s.tier)) {
    const row = PLACEMENT_STD.find((r) => r.tier === s.tier && le(s.shippingWeight, r.upToLb)) ?? PLACEMENT_STD.filter((r) => r.tier === s.tier).slice(-1)[0];
    return row.range;
  }
  if (isBulky(s.tier)) {
    const i = BULKY_WEIGHTS.findIndex((m) => le(s.shippingWeight, m));
    return PLACEMENT_BULKY[s.tier as "small-bulky" | "large-bulky"][option][i < 0 ? BULKY_WEIGHTS.length - 1 : i];
  }
  return null; // Extra-Large: no placement fee table.
}

/* ------------------------------------------------------------------ module */

const changes: FeeChange[] = [
  {
    date: "2027-01-15",
    text: "Holiday peak fulfillment fees end (they apply to units shipped October 15, 2026 – January 14, 2027). Amazon has not yet announced the fees that apply from January 15, 2027; its 2026 non-peak table is dated through October 14, 2026.",
    source: S.fba,
    upcoming: true,
  },
  {
    date: "2026-10-31",
    text: "3D printers and 3D printing pens move from Business, Industrial & Scientific Supplies (12% referral fee) to a new “3D Printers” fee category, whose rate Amazon hasn’t published yet.",
    source: AMZ.categories,
    upcoming: true,
  },
  {
    date: "2026-10-15",
    text: "Holiday peak fulfillment fees start: for example a small standard item of 6–8 oz priced $10–$50 goes from $3.54 to $3.74, and a 1–1.25 lb large standard item from $5.04 to $5.34 (before the 3.5% surcharge). Storage is $2.40 per cubic foot for standard-size items in October–December, up from $0.78.",
    source: S.fba,
  },
  {
    date: "2026-04-17",
    text: "New 3.5% fuel and logistics surcharge on FBA fulfillment fees (not on the sale price), about $0.17 per unit on average. Amazon calls it temporary but has not set an end date.",
    source: S.fuel,
  },
  {
    date: "2026-01-15",
    text: "2026 rate cards: standard-size fees rise by $0.08 per unit on average with a new over-$50 price band; a new Small Bulky tier; Bulky items lose the SIPP discount but non-SIPP Bulky items pay a $1.51–$4.04 packaging fee; an Overmax fee of $17–$25 for very long Extra-Large items; inbound placement fees get finer weight bands.",
    source: S.fba,
  },
  {
    date: "2026-01-01",
    text: "Amazon stopped offering FBA prep and item labeling in the US: everything must arrive prepped and labeled.",
    source: S.prep,
  },
  { date: "2024-11-19", text: "Amazon announced no increase to US referral fees or FBA fees for 2025.", source: AMZ.news2025 },
];

function feeTypeOf(inputs: Inputs): FeeType {
  if (bool(inputs, "dangerousGoods")) return "dangerous";
  return str(inputs, "category", DEFAULT_CATEGORY) === "clothing" ? "apparel" : "nonApparel";
}

function sizeOf(inputs: Inputs): SizeInfo {
  return sizeTier([num(inputs, "length"), num(inputs, "width"), num(inputs, "height")], num(inputs, "weight"));
}

function describeWeight(s: SizeInfo): string {
  const oz = (lb: number) => `${Number((lb * 16).toFixed(1))} oz`;
  const lbs = (lb: number) => `${Number(lb.toFixed(2))} lb`;
  const f = s.tier === "small-standard" ? oz : lbs;
  if (s.tier === "small-standard" || s.tier === "xl-150-plus") return `unit weight ${f(s.unitWeight)}`;
  return s.usesDim ? `dimensional weight ${lbs(s.dimWeight)} (more than the ${lbs(s.unitWeight)} unit weight)` : `unit weight ${lbs(s.unitWeight)} (dimensional weight ${lbs(s.dimWeight)})`;
}

function calculate(inputs: Inputs, market: Market) {
  const money = moneyFor(market);
  const cat = getCategory(str(inputs, "category", DEFAULT_CATEGORY));
  const price = toCents(num(inputs, "price"));
  const giftWrap = toCents(num(inputs, "giftWrap"));
  const base = price + giftWrap;
  const plan = str(inputs, "plan", "professional");
  const feeType = feeTypeOf(inputs);
  const season: Season = str(inputs, "season", fbaSeason()) === "nonpeak" ? "nonpeak" : "peak";
  const s = sizeOf(inputs);
  const band = priceBand(price);
  const fees: Line[] = [];

  // Referral + closing
  const ref = referralFee(cat, base);
  fees.push({ id: "referral", label: "Referral fee", amount: ref.amount, kind: "platform", detail: ref.detail, explain: referralExplain(cat, base, true), source: cat.source ?? AMZ.referral });
  const closing = closingLine(cat);
  if (closing) fees.push(closing);

  // Fulfillment
  const ff = fulfillmentFee(s, feeType, season, band);
  const typeLabel = feeType === "apparel" ? ", apparel" : feeType === "dangerous" ? ", dangerous goods" : "";
  const seasonLabel = season === "peak" ? "peak rate" : "non-peak rate";
  fees.push({
    id: "fulfillment",
    label: "FBA fulfillment fee",
    amount: ff.amount,
    kind: "shipping",
    detail: `${TIER_LABEL[s.tier]} ${weightBand(s, feeType)}, priced ${BAND_LABEL[band]}${typeLabel}, ${seasonLabel}${ff.detail ? `: ${ff.detail}` : ""}`,
    explain: `Amazon’s fee to pick, pack and deliver one unit, set by size tier, shipping weight, price band and season${band === 0 ? ". Items under $10 get the lower Low-Price FBA rates automatically" : ""}. ${season === "peak" ? "Peak rates apply to units shipped October 15, 2026 – January 14, 2027." : "These are Amazon’s 2026 non-peak rates."}`,
    source: band === 0 ? S.lowPrice : S.fba,
  });

  const sipp = bool(inputs, "sipp");
  let fulfillmentNet = ff.amount;
  if (sipp && isStandard(s.tier)) {
    const d = sippDiscount(s, feeType);
    if (d) {
      fulfillmentNet -= d;
      fees.push({
        id: "sipp",
        label: "SIPP discount",
        amount: -d,
        kind: "shipping",
        detail: `−${money(d)} per certified unit`,
        explain: "Standard-size products certified for Ships in Product Packaging get a lower fulfillment fee on each certified unit.",
        source: S.sipp,
      });
    }
  }

  fees.push({
    id: "fuel",
    label: "Fuel & logistics surcharge (3.5%)",
    amount: pct(fulfillmentNet, FUEL_SURCHARGE),
    kind: "shipping",
    detail: `3.5% × ${money(fulfillmentNet)}`,
    explain: "Since April 17, 2026 Amazon adds 3.5% to FBA fulfillment fees, including peak rates. It is charged on the fulfillment fee, not on your sale price, and has no announced end date.",
    source: S.fuel,
  });

  if (isBulky(s.tier) && !sipp) {
    const p = bulkyPackagingFee(s.dimWeight);
    fees.push({
      id: "packaging",
      label: "Bulky packaging fee",
      amount: p,
      kind: "shipping",
      detail: `Dimensional weight ${Number(s.dimWeight.toFixed(2))} lb`,
      explain: "Small and Large Bulky items that can’t ship in their own packaging (not SIPP-certified) pay a packaging fee, set by dimensional weight. Turn on SIPP under “More options” if your item is certified.",
      source: S.sipp,
    });
  }

  if (s.overmax) {
    const o = overmaxFee(s.tier);
    fees.push({
      id: "overmax",
      label: "Overmax handling fee",
      amount: o,
      kind: "shipping",
      detail: `Longest side ${Number(s.longest.toFixed(2))} in, length + girth ${Number(s.lengthPlusGirth.toFixed(2))} in`,
      explain: "Extra-Large items up to 150 lb that are longer than 96 inches or over 130 inches in length plus girth pay $17, $21 or $25 on top of the fulfillment fee.",
      source: S.overmax,
    });
  }

  if (bool(inputs, "lithium")) {
    fees.push({
      id: "lithium",
      label: "Lithium battery fee",
      amount: LITHIUM_FEE,
      kind: "shipping",
      detail: "$0.11 × 1 unit",
      explain: "Products that are, contain or come with lithium batteries pay $0.11 per unit. Amazon’s tools show it inside the fulfillment fee.",
      source: S.lithium,
    });
  }

  // Storage
  const months = Math.max(0, num(inputs, "storageMonths", 1));
  const sSeason = str(inputs, "storageSeason", storageSeason()) === "offpeak" ? "offpeak" : "peak";
  const oversize = !isStandard(s.tier);
  const dg = feeType === "dangerous";
  const rate = STORAGE[dg ? "dangerous" : "regular"][sSeason][oversize ? 1 : 0];
  const cuft = s.cubicFeet;
  const cuftText = `${Number(cuft.toFixed(3))} cu ft`;
  if (months > 0) {
    fees.push({
      id: "storage",
      label: "Monthly storage",
      amount: roundCents(cuft * rate * months),
      kind: "other",
      detail: `${cuftText} × ${money(rate)} × ${Number(months.toFixed(2))} month${months === 1 ? "" : "s"}`,
      explain: `Charged each month for the space a unit takes: ${money(rate)} per cubic foot for ${dg ? "dangerous goods, " : ""}${oversize ? "oversize" : "standard-size"} items in ${sSeason === "peak" ? "October–December" : "January–September"}. Faster-selling stock pays less per unit sold.`,
      source: S.storage,
    });
    const util = UTILIZATION[str(inputs, "utilization", "below22")] ?? UTILIZATION.below22;
    const extraMonths = Math.max(0, months - 1);
    const uRate = dg ? 0 : oversize ? util.over : util.std;
    if (uRate && extraMonths > 0) {
      fees.push({
        id: "utilization",
        label: "Storage utilization surcharge",
        amount: roundCents(cuft * uRate * extraMonths),
        kind: "other",
        detail: `${cuftText} × ${money(uRate)} × ${Number(extraMonths.toFixed(2))} month${extraMonths === 1 ? "" : "s"} after the first 30 days`,
        explain: `Professional sellers whose stock covers ${util.label} of sales pay extra per cubic foot on inventory older than 30 days. New sellers, Individual sellers and those with 25 cubic feet or less don’t.`,
        source: S.storage,
      });
    }
  }

  // Inbound placement
  const placement = str(inputs, "placement", "optimized");
  const range = placementRange(s, placement);
  if (range) {
    const partialOnStd = placement === "partial" && isStandard(s.tier);
    fees.push({
      id: "placement",
      label: `Inbound placement fee (${placement === "partial" && !partialOnStd ? "partial split" : "minimal split"})`,
      amount: range[1],
      kind: "shipping",
      detail: `Top of Amazon’s ${money(range[0])}–${money(range[1])} range`,
      explain: `Charged per unit when you send a shipment to ${placement === "partial" && !partialOnStd ? "2–3 locations" : "one location"} instead of letting Amazon split it across 5 or more (free). The exact rate depends on the region; we use the top of the published range.${partialOnStd ? " Partial splits are offered only for Bulky items, so this uses the minimal-split rate." : ""}`,
      source: S.placement,
    });
  }

  // Plan, DSF, ads
  const planFee = planLine(plan, num(inputs, "unitsPerMonth", 100), cat.id === "handmade");
  fees.push(planFee);
  const dsf = dsfLine(str(inputs, "establishment", "other"), [ref.amount, closing?.amount ?? 0, plan === "individual" ? planFee.amount : 0], [fulfillmentNet]);
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

  // Notes
  const notes: string[] = [];
  notes.push(
    `Size tier: ${TIER_LABEL[s.tier]}${s.overmax ? " (Overmax)" : ""}, fee weight ${weightBand(s, feeType)} from the ${describeWeight(s)}. Amazon re-measures items and charges by its own measurements if they differ.`,
  );
  const cliff = priceCliffNote(s, feeType, season, price);
  const bn = bracketNote(cat, base, giftWrap);
  if (cliff) notes.push(cliff);
  else if (bn) notes.push(bn);
  notes.push(
    season === "peak"
      ? "Not included: the low-inventory-level fee (stock under 28 days of supply), returns processing above your category’s return-rate threshold, and the aged inventory surcharge after 180 days."
      : Date.now() >= PEAK_END
        ? "Amazon hasn’t published its fulfillment fees for 2027 yet. These are its 2026 non-peak rates, the latest it has published."
        : "These are the 2026 non-peak rates. Units shipped from October 15, 2026 to January 14, 2027 pay the higher holiday peak rates.",
  );
  notes.push(refundNote(cat, ref.amount));

  const warnings: string[] = [];
  if (num(inputs, "weight") <= 0 || s.cubicFeet <= 0) warnings.push("Enter the packaged dimensions and weight: FBA fees depend on them.");
  if (cat.id === "handmade" && plan === "individual") warnings.push("Handmade referral rates need a Professional plan. On the Individual plan Amazon charges the standard rate for the product’s category.");

  const costs: Line[] = [];
  const item = toCents(num(inputs, "itemCost"));
  const inbound = toCents(num(inputs, "shippingCost"));
  const other = toCents(num(inputs, "otherCost"));
  if (item) costs.push({ id: "itemCost", label: "What you paid for the item", amount: item, kind: "cost" });
  if (inbound) costs.push({ id: "shippingCost", label: "Shipping it to Amazon", amount: inbound, kind: "cost" });
  if (other) costs.push({ id: "otherCost", label: "Prep, labels & other", amount: other, kind: "cost" });

  return assemble({ market, buyerPays: base, saleAmount: base, fees, costs, notes, warnings });
}

/** A note when the price sits just across one of the FBA price bands' edges ($10, $50). */
function priceCliffNote(s: SizeInfo, feeType: FeeType, season: Season, price: number): string | null {
  const money = moneyFor(M.us);
  const fee = (p: number) => fulfillmentFee(s, feeType, season, priceBand(p)).amount;
  if (price >= 1000 && price <= 1199) {
    const low = fee(999);
    const cur = fee(price);
    if (cur > low) return `At $9.99 this item would get the Low-Price FBA rate: ${money(low)} instead of ${money(cur)} per unit (before the surcharge).`;
  }
  if (price >= 800 && price < 1000) {
    const cur = fee(price);
    const up = fee(1000);
    if (up > cur) return `Pricing at $10.00 or more moves this item out of Low-Price FBA: the fulfillment fee would rise from ${money(cur)} to ${money(up)}.`;
  }
  if (price > 5000 && price <= 5199) {
    const at = fee(5000);
    const cur = fee(price);
    if (cur > at) return `Over $50 the fulfillment fee is higher: ${money(cur)} here, ${money(at)} at $50.00.`;
  }
  return null;
}

function schedule(): ScheduleRow[] {
  const season = fbaSeason();
  const card = RATES.nonApparel[season];
  const money = moneyFor(M.us);
  const when = season === "peak" ? "Units shipped Oct 15, 2026 – Jan 14, 2027" : "2026 non-peak rates";
  const trio = (b: Band) => `${money(b[0])} / ${money(b[1])} / ${money(b[2])}`;
  const per = "Per unit; price under $10 / $10–$50 / over $50";
  const rows: ScheduleRow[] = [
    { fee: "Referral fee", amount: "8%–45% by category, most 15%", appliesTo: "Item price + gift wrap (not sales tax), per unit", when: "Every sale; greater of the rate or the category minimum (usually $0.30)", source: AMZ.referral },
  ];
  SMALL_MAX_OZ.forEach((m, i) => rows.push({ fee: `Fulfillment: small standard, ${i === 0 ? "2 oz or less" : `${SMALL_MAX_OZ[i - 1]}+ to ${m} oz`}`, amount: trio(card.small[i]), appliesTo: per, when, source: S.fba }));
  LARGE_MAX_LB.forEach((m, i) => {
    const label = i === 0 ? "4 oz or less" : i <= 3 ? `${LARGE_MAX_LB[i - 1] * 16}+ to ${m * 16} oz` : `${fmtLb(LARGE_MAX_LB[i - 1])}+ to ${fmtLb(m)} lb`;
    rows.push({ fee: `Fulfillment: large standard, ${label}`, amount: trio(card.large[i]), appliesTo: per, when, source: S.fba });
  });
  rows.push(
    { fee: "Fulfillment: large standard, 3+ to 20 lb", amount: `${trio(card.large3)} + $0.08 per 4 oz over 3 lb`, appliesTo: per, when, source: S.fba },
    { fee: "Fulfillment: Small Bulky, up to 50 lb", amount: `${trio(card.smallBulky)} + $0.38 per lb over 1 lb`, appliesTo: per, when, source: S.fba },
    { fee: "Fulfillment: Large Bulky, up to 50 lb", amount: `${trio(card.largeBulky)} + $0.38 per lb over 1 lb`, appliesTo: per, when, source: S.fba },
    { fee: "Fulfillment: Extra-Large 0 to 50 lb", amount: `${trio(card.xl50)} + $0.38 per lb over 1 lb`, appliesTo: per, when, source: S.fba },
    { fee: "Fulfillment: Extra-Large 50+ to 70 lb", amount: `${trio(card.xl70)} + $0.75 per lb over 51 lb`, appliesTo: per, when, source: S.fba },
    { fee: "Fulfillment: Extra-Large 70+ to 150 lb", amount: `${trio(card.xl150)} + $0.75 per lb over 71 lb`, appliesTo: per, when, source: S.fba },
    { fee: "Fulfillment: Extra-Large 150+ lb", amount: `${trio(card.xl150plus)} + $0.19 per lb over 151 lb`, appliesTo: per, when, source: S.fba },
    { fee: "Apparel and dangerous goods", amount: "Separate rate cards", appliesTo: "Clothing & Accessories category; hazmat items", when: "Pick them in the calculator", source: S.fba },
    { fee: "Fuel & logistics surcharge", amount: "3.5%", appliesTo: "The fulfillment fee (not the sale price)", when: "Since April 17, 2026", source: S.fuel },
    { fee: "Monthly storage, standard size", amount: "$0.78 / cu ft (Jan–Sep), $2.40 (Oct–Dec)", appliesTo: "Average daily volume stored", when: "Every month", source: S.storage },
    { fee: "Monthly storage, oversize", amount: "$0.56 / cu ft (Jan–Sep), $1.40 (Oct–Dec)", appliesTo: "Average daily volume stored", when: "Every month", source: S.storage },
    { fee: "Monthly storage, dangerous goods", amount: "$0.99 / $3.63 standard, $0.78 / $2.43 oversize", appliesTo: "Average daily volume stored", when: "Jan–Sep / Oct–Dec", source: S.storage },
    { fee: "Storage utilization surcharge", amount: "$0.44–$1.88 / cu ft (standard), $0.23–$1.26 (oversize)", appliesTo: "Inventory older than 30 days", when: "Stock covering 22+ weeks of sales; not new or Individual sellers", source: S.storage },
    { fee: "Aged inventory surcharge", amount: "$0.50–$5.90 / cu ft; $6.90 or $0.30/unit (366–455 days); $7.90 or $0.35/unit (456+)", appliesTo: "Units older than 180 days", when: "Assessed on the 15th of each month", source: S.aged },
    { fee: "Low-inventory-level fee", amount: "$0.32–$2.09 per unit", appliesTo: "Units shipped", when: "Both 30- and 90-day supply under 28 days", source: S.lowInventory },
    { fee: "Inbound placement fee", amount: "$0.14–$1.90 (standard), $0.55–$6.50 (Bulky); free with 5+ locations", appliesTo: "Units sent in", when: "Minimal or partial shipment splits", source: S.placement },
    { fee: "SIPP discount", amount: "−$0.04 to −$0.23", appliesTo: "Standard-size units certified for SIPP", source: S.sipp },
    { fee: "Bulky packaging fee", amount: "$1.51–$4.04", appliesTo: "Small / Large Bulky units not in SIPP", when: "By dimensional weight", source: S.sipp },
    { fee: "Overmax handling fee", amount: "$17 / $21 / $25", appliesTo: "Extra-Large up to 50 / 70 / 150 lb", when: "Over 96 in long or 130 in length + girth", source: S.overmax },
    { fee: "Lithium battery fee", amount: "$0.11 per unit", appliesTo: "Products with lithium batteries", source: S.lithium },
    { fee: "Selling plan", amount: "$39.99 / month or $0.99 per unit", appliesTo: "Professional / Individual", source: AMZ.subscription },
  );
  return rows;
}

const fields: FieldDef[] = [
  { id: "price", kind: "money", label: "Selling price", section: "sale", help: "Your price per unit. It also sets the FBA price band: under $10, $10–$50 or over $50." },
  {
    id: "category",
    kind: "select",
    label: "Amazon fee category",
    section: "sale",
    searchable: true,
    options: categoryOptions(true),
    help: "Sets the referral fee. Clothing & Accessories also uses the apparel FBA rates.",
  },
  { id: "giftWrap", kind: "money", label: "Gift wrap charged", section: "sale", advanced: true, help: "Amazon takes the referral fee on gift wrap too." },
  {
    id: "plan",
    kind: "segmented",
    label: "Selling plan",
    section: "sale",
    advanced: true,
    options: [
      { value: "professional", label: "Professional · $39.99/mo" },
      { value: "individual", label: "Individual · $0.99/item" },
    ],
  },
  {
    id: "unitsPerMonth",
    kind: "number",
    label: "Units you sell per month",
    section: "sale",
    advanced: true,
    integer: true,
    min: 1,
    max: 1000000,
    unit: "units",
    help: "We spread the $39.99 monthly fee over these sales.",
    showIf: (i) => str(i, "plan", "professional") === "professional" && str(i, "category", DEFAULT_CATEGORY) !== "handmade",
  },
  { id: "length", kind: "number", label: "Longest side", section: "shipping", unit: "in", min: 0, max: 500, step: 0.1, help: "Measure the item packed, as it will reach Amazon." },
  { id: "width", kind: "number", label: "Middle side", section: "shipping", unit: "in", min: 0, max: 500, step: 0.1 },
  { id: "height", kind: "number", label: "Shortest side", section: "shipping", unit: "in", min: 0, max: 500, step: 0.1 },
  { id: "weight", kind: "number", label: "Packaged weight", section: "shipping", unit: "lb", min: 0, max: 2000, step: 0.01, help: "In pounds: 8 oz = 0.5 lb. Bigger, light items are charged by dimensional weight." },
  { id: "dangerousGoods", kind: "toggle", label: "Dangerous goods (hazmat)", section: "shipping", advanced: true, help: "Items Amazon classes as dangerous goods use separate, higher rates." },
  { id: "lithium", kind: "toggle", label: "Contains or comes with lithium batteries", section: "shipping", advanced: true, help: "Adds $0.11 per unit." },
  { id: "sipp", kind: "toggle", label: "SIPP-certified (ships in its own packaging)", section: "shipping", advanced: true, help: "Lowers standard-size fees; Bulky items without it pay a packaging fee." },
  {
    id: "season",
    kind: "segmented",
    label: "When does it ship?",
    section: "options",
    options: [
      { value: "peak", label: "Holiday peak · Oct 15–Jan 14" },
      { value: "nonpeak", label: "Rest of the year" },
    ],
    help: "Amazon charges higher fulfillment fees on units shipped during the holiday peak.",
  },
  { id: "storageMonths", kind: "number", label: "Months in Amazon’s warehouse", section: "options", unit: "months", min: 0, max: 36, step: 0.5, help: "How long a unit sits before it sells. Storage is charged monthly per cubic foot." },
  {
    id: "storageSeason",
    kind: "segmented",
    label: "Storage months fall in",
    section: "options",
    advanced: true,
    options: [
      { value: "offpeak", label: "Jan–Sep" },
      { value: "peak", label: "Oct–Dec" },
    ],
    help: "Storage costs about three times more per cubic foot in October–December.",
  },
  {
    id: "utilization",
    kind: "select",
    label: "Storage utilization ratio",
    section: "options",
    advanced: true,
    options: Object.entries(UTILIZATION).map(([value, u]) => ({ value, label: u.label, hint: u.std ? `+$${(u.std / 100).toFixed(2)}/cu ft standard` : "no surcharge" })),
    help: "Weeks of supply on hand (FBA dashboard). Above 22 weeks Amazon adds a surcharge on stock older than 30 days.",
  },
  {
    id: "placement",
    kind: "select",
    label: "How you send inventory in",
    section: "options",
    advanced: true,
    options: [
      { value: "optimized", label: "Amazon-optimized splits (5+ locations)", hint: "no placement fee" },
      { value: "minimal", label: "Minimal split (one location)", hint: "$0.14–$1.90 standard" },
      { value: "partial", label: "Partial split (2–3 locations, Bulky only)", hint: "$0.55–$3.50" },
    ],
    help: "Sending everything to one warehouse costs an inbound placement fee per unit.",
  },
  { id: "adCost", kind: "money", label: "Ad cost per sale", section: "options", advanced: true, help: "Optional: your Sponsored Products spend divided by units sold." },
  dsfField,
  { id: "itemCost", kind: "money", label: "What the item cost you", section: "costs", help: "Product cost per unit." },
  { id: "shippingCost", kind: "money", label: "Shipping it to Amazon, per unit", section: "costs", help: "Your freight into Amazon’s warehouse, divided by units." },
  { id: "otherCost", kind: "money", label: "Prep, labels & other", section: "costs" },
];

export const amazonFba: CalculatorDef = {
  slug: "amazon-fba",
  name: "Amazon FBA",
  path: "/amazon-fba-calculator",
  category: "marketplaces",
  priceNoun: "selling price",
  sellerNoun: "seller",
  blurb: "Referral fee (most 15%) + FBA fulfillment from $2.43/unit + 3.5% surcharge + storage",
  markets: [M.us],
  defaultMarket: "us",
  priceField: "price",
  fields,
  defaults: () => ({
    price: 19.99,
    category: DEFAULT_CATEGORY,
    giftWrap: 0,
    plan: "professional",
    unitsPerMonth: 100,
    length: 10,
    width: 7,
    height: 0.7,
    weight: 0.5,
    dangerousGoods: false,
    lithium: false,
    sipp: false,
    season: fbaSeason(),
    storageMonths: 1,
    storageSeason: storageSeason(),
    utilization: "below22",
    placement: "optimized",
    adCost: 0,
    establishment: "other",
    itemCost: 0,
    shippingCost: 0,
    otherCost: 0,
  }),
  calculate,
  breakpoints: (inputs) => {
    // FBA price bands ($10.00 and $50.01 raise the fulfillment fee) and bracket referral categories.
    const cat = getCategory(str(inputs, "category", DEFAULT_CATEGORY));
    const gift = toCents(num(inputs, "giftWrap"));
    return [1000, 5001, ...bracketEdges(cat).map((e) => e - gift)].filter((p) => p > 0);
  },
  verifiedAt: "2026-10-23",
  sources,
  changes,
  schedule,
  compare: {
    group: "sell",
    map: (c) => ({ price: c.price + c.shipping, itemCost: c.itemCost, shippingCost: 0 }),
    note: "Amazon ships it: typical small standard item (10 × 7 × 0.7 in, 8 oz), shipping folded into the price, Home & Kitchen, 1 month of storage",
  },
};

export default amazonFba;
