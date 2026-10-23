/*
 * eBay seller fees on ebay.com (US), ebay.co.uk, ebay.ca, ebay.com.au and ebay.de. Every number
 * is from eBay's own pages (see `sources`), re-read on 2026-10-23. Research notes with verbatim
 * quotes: research/fees/ebay-us.md and research/fees/ebay-intl.md.
 *
 * What this module reproduces:
 *  - The final value fee is a percentage of the "total amount of the sale": item price + shipping
 *    + handling + the sales tax eBay collects (US/CA) or the VAT/GST already in the price (UK/AU/DE).
 *    Category thresholds are per item; most are marginal ("2.35% on the portion over $7,500"), a
 *    few are cliffs where the whole sale moves to another rate (handbags, jewelry, bullion,
 *    sneakers). We model one item per order, so the order total is the item's total.
 *  - The per-order fee is a separate statement column ("Final Value Fee - fixed"): $0.30 for
 *    orders of $10.00 or less, $0.40 above (UK £, CA C$; DE €0.35/€0.45; AU Pro $0.30/$0.33).
 *    eBay doesn't define "order total" further; we use the same total (incl. shipping and tax),
 *    which is how eBay.ca's own 2024 example counts it.
 *  - Promoted Listings (general), the international fee and the performance surcharges are all
 *    percentages of that same total.
 *  - UK private sellers, AU sellers on free selling and DE private sellers pay no final value fee;
 *    UK and AU buyers pay a Buyer Protection fee on top (shown in `buyerFees`, not deducted).
 *  - UK and DE business fees are quoted without VAT; AU fees include 10% GST.
 * Each line is rounded to the cent separately (eBay's examples all reproduce this way).
 */
import { M } from "../markets";
import { assemble, bool, costLines, formatMoney, formatRate, moneyFor, num, pct, roundCents, str, toCents } from "../money";
import type { CalculatorDef, FeeChange, Inputs, Line, Market, ScheduleRow, SelectOption, Source } from "../types";

const MARKETS: Market[] = [M.us, M.uk, M.ca, M.au, M.de];

/* ------------------------------------------------------------------------------------------ */
/* Fee rules                                                                                   */
/* ------------------------------------------------------------------------------------------ */

/** A rate that applies to the slice of the total up to `upTo` (whole currency units). */
interface Band {
  rate: number;
  upTo?: number;
}
/** A cliff: the whole sale takes the bands of the first step whose condition holds. */
interface Step {
  /** Applies when the amount is ≤ max. */
  max?: number;
  /** Applies when the amount is < below. */
  below?: number;
  bands: Band[];
  /** eBay waives the per-order fee in this step (US/CA sneakers at $150+). */
  noPerOrder?: boolean;
}
type Rule = { kind: "bands"; bands: Band[] } | { kind: "steps"; steps: Step[]; on?: "item" };

/** m(13.6, 7500, 2.35) = 13.6% up to 7,500, then 2.35% on the portion above. */
function m(...xs: number[]): Rule {
  return { kind: "bands", bands: bands(...xs) };
}
function bands(...xs: number[]): Band[] {
  const out: Band[] = [];
  for (let i = 0; i < xs.length; i += 2) out.push(i + 1 < xs.length ? { rate: xs[i], upTo: xs[i + 1] } : { rate: xs[i] });
  return out;
}
function cliff(steps: Step[], on?: "item"): Rule {
  return { kind: "steps", steps, on };
}

function bandFee(bs: Band[], amount: number) {
  let prev = 0;
  let exact = 0;
  const parts: [number, number][] = [];
  for (const b of bs) {
    const cap = b.upTo === undefined ? Infinity : b.upTo * 100;
    const slice = Math.max(0, Math.min(amount, cap) - prev);
    if (slice > 0) {
      parts.push([b.rate, slice]);
      exact += (slice * b.rate) / 100;
    }
    if (amount <= cap) break;
    prev = cap;
  }
  return { exact, parts };
}

function pickStep(rule: Extract<Rule, { kind: "steps" }>, total: number, item: number): Step {
  const x = rule.on === "item" ? item : total;
  return rule.steps.find((s) => (s.max !== undefined ? x <= s.max * 100 : s.below !== undefined ? x < s.below * 100 : true)) ?? rule.steps[rule.steps.length - 1];
}

/** The percentage part of the final value fee on `total` (cents), unrounded, with its slices. */
function ruleFee(rule: Rule, total: number, item: number) {
  if (rule.kind === "bands") return { ...bandFee(rule.bands, total), noPerOrder: false };
  const step = pickStep(rule, total, item);
  return { ...bandFee(step.bands, total), noPerOrder: Boolean(step.noPerOrder) };
}

/** Thresholds of a rule (whole units), and whether they're measured on the item price. */
function ruleThresholds(rule: Rule): { on: "total" | "item"; at: number[] } {
  if (rule.kind === "bands") return { on: "total", at: rule.bands.flatMap((b) => (b.upTo === undefined ? [] : [b.upTo])) };
  const at: number[] = [];
  for (const s of rule.steps) {
    if (s.max !== undefined) at.push(s.max);
    if (s.below !== undefined) at.push(s.below);
    for (const b of s.bands) if (b.upTo !== undefined) at.push(b.upTo);
  }
  return { on: rule.on === "item" ? "item" : "total", at };
}

function bandsText(bs: Band[], w: (units: number) => string): string {
  if (bs.length === 1) return formatRate(bs[0].rate);
  return bs.map((b, i) => (b.upTo !== undefined ? `${formatRate(b.rate)} ${i === 0 ? "up to" : "to"} ${w(b.upTo)}` : `then ${formatRate(b.rate)}`)).join(", ");
}

/** "13.6% up to $7,500, then 2.35%" / "15% up to $2,000; 9% over $2,000 (whole sale)". */
function ruleText(rule: Rule, w: (units: number) => string): string {
  if (rule.kind === "bands") return bandsText(rule.bands, w);
  const parts = rule.steps.map((s, i) => {
    const prev = rule.steps[i - 1];
    const cond =
      s.max !== undefined ? `up to ${w(s.max)}` : s.below !== undefined ? `under ${w(s.below)}` : prev?.max !== undefined ? `over ${w(prev.max)}` : prev?.below !== undefined ? `from ${w(prev.below)}` : "";
    const rate = bandsText(s.bands, w);
    const body = s.bands.length > 1 ? `${cond}: ${rate}` : `${rate} ${cond}`;
    return `${body}${s.noPerOrder ? " (no per-order fee)" : ""}`;
  });
  return `${parts.join("; ")} (${rule.on === "item" ? "by item price" : "whole sale"})`;
}

/* ------------------------------------------------------------------------------------------ */
/* Categories                                                                                  */
/* ------------------------------------------------------------------------------------------ */

/** ebay.com and ebay.ca: no store / Starter (`ns`) vs Basic and up (`st`). */
interface NaCategory {
  id: string;
  label: string;
  group: string;
  ns: Rule;
  st: Rule;
  /** eBay.ca has no separate rate for this category: it falls under "most categories". */
  caMost?: boolean;
}

const NS_MOST = m(13.6, 7500, 2.35);
const ST_MOST = m(12.7, 2500, 2.35);
const ST_ELEC = m(9.35, 2500, 2.35);
const ST_CORE = m(7.35, 2500, 2.35);

const most = (id: string, label: string, group = "Most categories"): NaCategory => ({ id, label, group, ns: NS_MOST, st: ST_MOST });

const NA_CATEGORIES: NaCategory[] = [
  most("most", "Most categories (anything not listed)"),
  most("clothing", "Clothing, Shoes & Accessories"),
  most("home", "Home & Garden"),
  most("toys", "Toys & Hobbies"),
  most("collectibles", "Collectibles"),
  most("sporting", "Sporting Goods"),
  most("health", "Health & Beauty"),
  most("antiques", "Antiques"),
  most("art", "Art"),
  most("baby", "Baby"),
  most("crafts", "Crafts"),
  most("dolls", "Dolls & Bears"),
  most("pets", "Pet Supplies"),
  most("pottery", "Pottery & Glass"),
  most("entertainment", "Entertainment Memorabilia"),
  most("business", "Business & Industrial"),
  most("sportsmem", "Sports Mem & Fan Shop (not trading cards)"),
  most("vinyl", "Vinyl Records"),
  { id: "phones", label: "Cell Phones & Smartphones", group: "Electronics", ns: NS_MOST, st: ST_ELEC },
  { id: "phoneacc", label: "Cell Phone Accessories", group: "Electronics", ns: NS_MOST, st: ST_MOST },
  { id: "cameras", label: "Cameras & Photo", group: "Electronics", ns: NS_MOST, st: ST_ELEC },
  { id: "cameraacc", label: "Camera, Drone & Photo Accessories, Tripods", group: "Electronics", ns: NS_MOST, st: ST_MOST },
  { id: "laptops", label: "Laptops, Desktops, Tablets, Monitors, Printers, PC Parts", group: "Electronics", ns: NS_MOST, st: ST_CORE },
  { id: "computers", label: "Other Computers, Tablets & Networking", group: "Electronics", ns: NS_MOST, st: ST_ELEC },
  { id: "computeracc", label: "Computer Accessories (keyboards, mice, cables)", group: "Electronics", ns: NS_MOST, st: ST_MOST },
  { id: "electronics", label: "Consumer Electronics (TV, audio, headphones)", group: "Electronics", ns: NS_MOST, st: ST_ELEC },
  { id: "electronicsacc", label: "Electronics Accessories (batteries, TV/audio/VR accessories)", group: "Electronics", ns: NS_MOST, st: ST_MOST },
  { id: "consoles", label: "Video Game Consoles", group: "Electronics", ns: NS_MOST, st: ST_CORE },
  { id: "videogames", label: "Video Games & Video Game Accessories", group: "Electronics", ns: NS_MOST, st: ST_MOST },
  { id: "videogamesother", label: "Other Video Games & Consoles items", group: "Electronics", ns: NS_MOST, st: ST_ELEC },
  { id: "books", label: "Books & Magazines", group: "Books, movies & music", ns: m(15.3, 7500, 2.35), st: m(15.3, 2500, 2.35) },
  { id: "movies", label: "Movies & TV", group: "Books, movies & music", ns: m(15.3, 7500, 2.35), st: m(15.3, 2500, 2.35) },
  { id: "music", label: "Music (CDs, cassettes; not vinyl)", group: "Books, movies & music", ns: m(15.3, 7500, 2.35), st: m(15.3, 2500, 2.35) },
  { id: "cards", label: "Trading Cards (sports, non-sport, CCG) & Comics", group: "Collectibles & cards", ns: m(13.25, 7500, 2.35), st: m(12.35, 2500, 2.35) },
  { id: "coins", label: "Coins & Paper Money", group: "Collectibles & cards", ns: m(13.25, 7500, 2.35), st: m(9, 4000, 2.35) },
  {
    id: "bullion",
    label: "Bullion",
    group: "Collectibles & cards",
    ns: cliff([{ max: 7500, bands: bands(13.6) }, { bands: bands(7) }]),
    st: cliff([{ max: 1500, bands: bands(7.5) }, { max: 10000, bands: bands(5) }, { bands: bands(4.5) }]),
  },
  { id: "stamps", label: "Stamps", group: "Collectibles & cards", ns: NS_MOST, st: m(9.7, 2500, 2.35) },
  { id: "nft", label: "NFTs", group: "Collectibles & cards", ns: m(5), st: m(5) },
  {
    id: "sneakers",
    label: "Athletic Shoes (sneakers)",
    group: "Fashion & luxury",
    ns: cliff([{ below: 150, bands: bands(13.6) }, { bands: bands(8), noPerOrder: true }]),
    st: cliff([{ below: 150, bands: bands(12.7) }, { bands: bands(7), noPerOrder: true }]),
  },
  {
    id: "handbags",
    label: "Women's Bags & Handbags",
    group: "Fashion & luxury",
    ns: cliff([{ max: 2000, bands: bands(15) }, { bands: bands(9) }]),
    st: cliff([{ max: 2000, bands: bands(13) }, { bands: bands(7) }]),
    caMost: true,
  },
  {
    id: "jewelry",
    label: "Jewelry (not watches)",
    group: "Fashion & luxury",
    ns: cliff([{ max: 5000, bands: bands(15) }, { bands: bands(9) }]),
    st: cliff([{ max: 5000, bands: bands(13) }, { bands: bands(7) }]),
    caMost: true,
  },
  { id: "watches", label: "Watches, Parts & Accessories", group: "Fashion & luxury", ns: m(15, 1000, 6.5, 7500, 3), st: m(12.5, 1000, 4, 5000, 3), caMost: true },
  { id: "instruments", label: "Musical Instruments & Gear", group: "Musical instruments", ns: NS_MOST, st: m(10.35, 2500, 2.35) },
  { id: "djproaudio", label: "DJ & Pro Audio Equipment", group: "Musical instruments", ns: NS_MOST, st: ST_ELEC },
  { id: "guitars", label: "Guitars & Basses", group: "Musical instruments", ns: m(6.7, 7500, 2.35), st: m(6.7, 2500, 2.35) },
  { id: "motorsparts", label: "eBay Motors Parts & Accessories, Tools, Safety", group: "eBay Motors parts", ns: NS_MOST, st: m(11.5, 1000, 2.35) },
  { id: "tires", label: "Tires & Wheels (eBay Motors)", group: "eBay Motors parts", ns: NS_MOST, st: m(9.5, 1000, 2.35) },
  { id: "motorsapparel", label: "Motors Apparel, Protective Gear & Merchandise", group: "eBay Motors parts", ns: NS_MOST, st: m(12.7, 1000, 2.35) },
  { id: "incartech", label: "In-Car Technology, GPS & Security", group: "eBay Motors parts", ns: NS_MOST, st: m(9.35, 1000, 2.35) },
  { id: "heavy", label: "Heavy Equipment, Printing Presses, Food Trucks", group: "Business & industrial", ns: m(3, 15000, 0.5), st: m(2.5, 15000, 0.5) },
];

/** ebay.co.uk business sellers (rates exclude VAT). */
interface Cat {
  id: string;
  label: string;
  group: string;
  rule: Rule;
}
const uk = (id: string, label: string, group: string, rule: Rule): Cat => ({ id, label, group, rule });
const UK_CATEGORIES: Cat[] = [
  uk("uk-clothes", "Clothes, Shoes & Accessories", "Fashion", m(11.9)),
  uk("uk-trainers", "Trainers (men's & women's)", "Fashion", cliff([{ below: 100, bands: bands(11.9) }, { bands: bands(7) }], "item")),
  uk("uk-handbags", "Women's Bags & Handbags", "Fashion", m(12.9, 800, 7)),
  uk("uk-jewellery", "Jewellery & Watches (not watches below)", "Fashion", m(14.9, 1000, 4)),
  uk("uk-watches", "Watches, Parts & Accessories", "Fashion", m(12.9, 750, 3)),
  uk("uk-health", "Health & Beauty", "Fashion", m(10.9)),
  uk("uk-hair", "Hair Extensions & Wigs", "Fashion", m(11.9)),
  uk("uk-home", "Home, Furniture & DIY (other)", "Home & garden", m(11.9, 500, 7.9)),
  uk("uk-furniture", "Furniture, Bath, Plumbing & Fixtures", "Home & garden", m(10.9, 500, 7.9, 1000, 3)),
  uk("uk-appliances", "Appliances, DIY Tools & Workshop Equipment", "Home & garden", m(6.9, 400, 3)),
  uk("uk-powerstrips", "Power Strips & Surge Protectors", "Home & garden", m(9.9, 250, 7.9)),
  uk("uk-garden", "Garden & Patio", "Home & garden", m(10.9)),
  uk("uk-pets", "Pet Supplies", "Home & garden", m(12.9)),
  uk("uk-baby", "Baby", "Home & garden", m(10.9)),
  uk("uk-crafts", "Crafts", "Home & garden", m(12.9)),
  uk("uk-pottery", "Pottery, Ceramics & Glass", "Home & garden", m(10.9)),
  uk("uk-phones", "Mobile & Smart Phones", "Electronics", m(6.9, 1000, 3)),
  uk("uk-mobile", "Mobile Phones & Communication (other)", "Electronics", m(9.9)),
  uk("uk-laptops", "Laptops, Desktops, Tablets, Printers, Storage, Servers", "Electronics", m(6.9, 1000, 3)),
  uk("uk-computers", "Computers, Tablets & Networking (other)", "Electronics", m(9.9)),
  uk("uk-camcorders", "Digital Cameras, Camcorders, Lenses, Film Photography", "Electronics", m(6.9, 1000, 3)),
  uk("uk-cameras", "Cameras & Photography (other)", "Electronics", m(9.9)),
  uk("uk-tv", "TVs, Headphones, Home Audio & HiFi, Home Cinema", "Electronics", m(6.9, 1000, 3)),
  uk("uk-soundvision", "Sound & Vision (other)", "Electronics", m(9.9)),
  uk("uk-consoles", "Video Game Consoles", "Electronics", m(6.9, 400, 2)),
  uk("uk-videogames", "Video Games & Consoles (other)", "Electronics", m(9.9)),
  uk("uk-vape", "Electronic Smoking, Parts & Accessories", "Electronics", m(12.9)),
  uk("uk-books", "Books, Comics & Magazines", "Media", m(9.9)),
  uk("uk-films", "Films & TV", "Media", m(9.9)),
  uk("uk-music", "Music", "Media", m(9.9)),
  uk("uk-instruments", "Musical Instruments & DJ Equipment", "Media", m(10.9)),
  uk("uk-collectables", "Collectables", "Collectables & art", m(10.9)),
  uk("uk-antiques", "Antiques", "Collectables & art", m(10.9)),
  uk("uk-art", "Art", "Collectables & art", m(10.9)),
  uk("uk-coins", "Coins", "Collectables & art", m(10.9, 450, 3)),
  uk("uk-stamps", "Stamps", "Collectables & art", m(10.9)),
  uk("uk-dolls", "Dolls & Bears", "Collectables & art", m(10.9)),
  uk("uk-sportsmem", "Sports Memorabilia", "Collectables & art", m(10.9)),
  uk("uk-nft", "NFTs", "Collectables & art", m(5)),
  uk("uk-toys", "Toys & Games", "Toys & sport", m(10.9)),
  uk("uk-sporting", "Sporting Goods", "Toys & sport", m(10.9)),
  uk("uk-tents", "Tents", "Toys & sport", m(10.9, 250, 7.9)),
  uk("uk-vehicleparts", "Vehicle Parts & Accessories (other)", "Vehicle parts", m(9.5, 750, 3)),
  uk("uk-tyres", "Tyres, GPS & Sat Nav, Power Tools", "Vehicle parts", m(6.9, 750, 3)),
  uk("uk-business", "Business, Office & Industrial", "Other", m(12.5)),
  uk("uk-tickets", "Event Tickets", "Other", m(12.9)),
  uk("uk-travel", "Holidays & Travel", "Other", m(7.9, 650, 3)),
  uk("uk-wholesale", "Wholesale & Job Lots", "Other", m(12.9)),
  uk("uk-memorials", "Memorials & Funerals", "Other", m(11.9)),
  uk("uk-everything", "Everything Else", "Other", m(12.9)),
];

/** ebay.com.au Pro plans: four category tiers (rates include GST). */
type AuTier = 1 | 2 | 3 | 4 | "nft";
interface AuCategory {
  id: string;
  label: string;
  group: string;
  tier: AuTier;
}
const AU_CATEGORIES: AuCategory[] = [
  { id: "au-phones", label: "Mobile Phones & Smart Watches", group: "Tier 1", tier: 1 },
  { id: "au-cameras", label: "Cameras, Camcorders & Binoculars", group: "Tier 1", tier: 1 },
  { id: "au-tv", label: "TVs, Home Theatre, Stereos & Audio Players", group: "Tier 1", tier: 1 },
  { id: "au-consoles", label: "Video Game Consoles", group: "Tier 1", tier: 1 },
  { id: "au-appliances", label: "Home Appliances", group: "Tier 1", tier: 1 },
  { id: "au-home", label: "Home & Garden", group: "Tier 2", tier: 2 },
  { id: "au-toys", label: "Toys & Hobbies", group: "Tier 2", tier: 2 },
  { id: "au-computers", label: "Computers, Laptops & Tablets", group: "Tier 2", tier: 2 },
  { id: "au-baby", label: "Baby", group: "Tier 2", tier: 2 },
  { id: "au-pets", label: "Pet Supplies", group: "Tier 2", tier: 2 },
  { id: "au-instruments", label: "Musical Instruments", group: "Tier 2", tier: 2 },
  { id: "au-other", label: "Everything else (Tier 2)", group: "Tier 2", tier: 2 },
  { id: "au-vehicleparts", label: "Vehicle Parts & Accessories", group: "Tier 3", tier: 3 },
  { id: "au-clothing", label: "Clothing, Shoes & Accessories", group: "Tier 4", tier: 4 },
  { id: "au-health", label: "Health & Beauty", group: "Tier 4", tier: 4 },
  { id: "au-jewellery", label: "Jewellery & Watches", group: "Tier 4", tier: 4 },
  { id: "au-media", label: "Books, Movies, Music & Video Games", group: "Tier 4", tier: 4 },
  { id: "au-collectables", label: "Collectables, Antiques, Art, Coins, Stamps, Crafts", group: "Tier 4", tier: 4 },
  { id: "au-sporting", label: "Sporting Goods", group: "Tier 4", tier: 4 },
  { id: "au-business", label: "Business & Industrial", group: "Tier 4", tier: 4 },
  { id: "au-techacc", label: "Phone, Camera, Computer & Electronics Accessories", group: "Tier 4", tier: 4 },
  { id: "au-nft", label: "NFTs", group: "Other", tier: "nft" },
];

/** Pro plans on ebay.com.au: rate per tier up to AU$4,000, rate above, per-order fee (cents), monthly fee (cents). */
const AU_PRO: Record<string, { label: string; tiers: Record<1 | 2 | 3 | 4, number>; above: number; perOrder: number; monthly: number }> = {
  starter: { label: "Pro Starter", tiers: { 1: 13.4, 2: 13.4, 3: 13.4, 4: 13.4 }, above: 2.5, perOrder: 30, monthly: 0 },
  basic: { label: "Pro Basic", tiers: { 1: 8.03, 2: 11.44, 3: 12.43, 4: 13.09 }, above: 2.75, perOrder: 33, monthly: 2745 },
  featured: { label: "Pro Featured", tiers: { 1: 7.26, 2: 10.34, 3: 11.22, 4: 11.77 }, above: 2.75, perOrder: 33, monthly: 8245 },
  anchor: { label: "Pro Anchor", tiers: { 1: 6.82, 2: 9.68, 3: 10.56, 4: 11.11 }, above: 2.75, perOrder: 33, monthly: 60495 },
};

function auRule(plan: string, tier: AuTier): Rule {
  if (tier === "nft") return m(5.5);
  const p = AU_PRO[plan] ?? AU_PRO.starter;
  return m(p.tiers[tier], 4000, p.above);
}

/** ebay.de business sellers (rates exclude VAT; Above Standard / Top Rated sellers). */
interface DeCategory extends Cat {
  /** Rate with an eBay Shop, where it differs. */
  shopRule?: Rule;
  /** Rate for "Neu: Sonstige", refurbished and used items, where the table has one. */
  usedRate?: number;
}
const DE_CATEGORIES: DeCategory[] = [
  { id: "de-clothing", label: "Clothing & Accessories (Kleidung & Accessoires)", group: "Fashion", rule: m(12, 990, 3) },
  { id: "de-sneakers", label: "Sneakers", group: "Fashion", rule: cliff([{ below: 100, bands: bands(12) }, { bands: bands(7, 990, 3) }], "item") },
  { id: "de-jewelry", label: "Watches & Jewellery (Uhren & Schmuck)", group: "Fashion", rule: m(16, 990, 3), shopRule: m(16, 500, 3) },
  { id: "de-watchparts", label: "Watch Parts & Accessories", group: "Fashion", rule: m(14, 990, 3), shopRule: m(14, 400, 3) },
  { id: "de-watches", label: "Wristwatches, Pocket & Collector Watches", group: "Fashion", rule: m(11, 990, 3), shopRule: m(11, 400, 3) },
  { id: "de-devices", label: "Electronics: computers, phones, cameras, TV & audio, consoles, appliances (Geräte)", group: "Electronics", rule: m(7), usedRate: 5 },
  { id: "de-accessories", label: "Electronics accessories: phone, camera, PC, TV & audio (Zubehör)", group: "Electronics", rule: m(12), usedRate: 5 },
  { id: "de-standard", label: "Sport, Baby, Pets, Furniture & Home, Crafts, Travel, Food, Misc.", group: "Home & sport", rule: m(14), usedRate: 5 },
  { id: "de-garden", label: "Garden & Patio, DIY (Heimwerker)", group: "Home & sport", rule: m(13), usedRate: 5 },
  { id: "de-business", label: "Business & Industrial, Office & Stationery", group: "Home & sport", rule: m(14), usedRate: 5 },
  { id: "de-instruments", label: "Musical Instruments", group: "Media", rule: m(11), usedRate: 5 },
  { id: "de-media", label: "Books, Films, Music, PC & Video Games, Tickets", group: "Media", rule: m(12, 990, 3) },
  { id: "de-collectibles", label: "Collectibles, Antiques & Art, Toys, Beauty & Health, Stamps", group: "Collectibles", rule: m(12, 990, 3) },
  { id: "de-models", label: "Model Making, Trading Cards, TCGs", group: "Collectibles", rule: m(11, 990, 3) },
  { id: "de-coins", label: "Coins (Münzen)", group: "Collectibles", rule: m(6.5, 990, 3) },
  { id: "de-nft", label: "NFTs", group: "Collectibles", rule: m(5) },
  { id: "de-carparts", label: "Car & Motorcycle Parts", group: "Vehicle parts", rule: m(12, 990, 3) },
  { id: "de-carelectronics", label: "Car electronics: entertainment, dashcams, GPS, chargers", group: "Vehicle parts", rule: m(6.5, 990, 3), shopRule: m(6.5, 300, 3) },
  { id: "de-wheels", label: "Wheels, Rims & Tyres", group: "Vehicle parts", rule: m(6.5, 990, 3) },
  { id: "de-motogear", label: "Motorcycle Clothing & Gear, Roof & Bike Racks, Motor Oil", group: "Vehicle parts", rule: m(11, 990, 3) },
];

/* ------------------------------------------------------------------------------------------ */
/* Plans, surcharges, international fees                                                      */
/* ------------------------------------------------------------------------------------------ */

/** Store subscription per month, cents: [monthly renewal, yearly renewal]. */
const US_STORES: Record<string, { label: string; table: "ns" | "st"; fee?: [number | null, number] }> = {
  none: { label: "No store", table: "ns" },
  starter: { label: "Starter store", table: "ns", fee: [795, 495] },
  basic: { label: "Basic store", table: "st", fee: [2795, 2195] },
  premium: { label: "Premium store", table: "st", fee: [7495, 5995] },
  anchor: { label: "Anchor store", table: "st", fee: [34995, 29995] },
  enterprise: { label: "Enterprise store", table: "st", fee: [null, 299995] },
};
const CA_STORES: Record<string, { label: string; table: "ns" | "st"; fee?: [number | null, number] }> = {
  none: { label: "No store", table: "ns" },
  basic: { label: "Basic", table: "st", fee: [2495, 1995] },
  premium: { label: "Premium", table: "st", fee: [7495, 5995] },
  anchor: { label: "Anchor", table: "st", fee: [34995, 29995] },
};
/** eBay Shop monthly price, cents, excluding VAT. */
const UK_SHOPS: Record<string, { label: string; fee: number }> = {
  none: { label: "No shop", fee: 0 },
  basic: { label: "Basic shop · £27/month", fee: 2700 },
  featured: { label: "Featured shop · £77/month", fee: 7700 },
  anchor: { label: "Anchor shop · £437/month", fee: 43700 },
};
const DE_SHOPS: Record<string, { label: string; fee: number }> = {
  none: { label: "No shop", fee: 0 },
  basis: { label: "Basis-Shop · €39.95/month", fee: 3995 },
  top: { label: "Top-Shop · €79.95/month", fee: 7995 },
  premium: { label: "Premium-Shop · €299.95/month", fee: 29995 },
  platin: { label: "Platin-Shop · €4,999.95/month", fee: 499995 },
};

/** Below Standard / very high "not as described" surcharges, % of the total sale: [normal, after 4+ months]. */
const SURCHARGE: Record<string, { below: [number, number]; inad: [number, number]; stack: boolean }> = {
  us: { below: [6, 7], inad: [5, 6], stack: false },
  ca: { below: [6, 7], inad: [5, 6], stack: false },
  uk: { below: [6, 7], inad: [4, 5], stack: true },
  au: { below: [5.5, 6.6], inad: [5.5, 6.6], stack: false },
};

/** Seller currency conversion charge by registered country, with announced increases. */
export function conversionRate(marketId: string, at: number = Date.now()): number {
  switch (marketId) {
    case "uk":
      return at >= Date.UTC(2026, 11, 1, 0, 0) ? 2.75 : 2.5; // 1 December 2026, 00:00 GMT
    case "au":
      return at >= Date.UTC(2026, 9, 31, 13, 0) ? 3.25 : 3; // 1 November 2026, 00:00 AEDT
    case "de":
      return at >= Date.UTC(2026, 11, 1, 23, 0) ? 3.25 : 3; // 2 December 2026, 00:00 CET
    default:
      return 3.25; // US (since 14 October 2026) and Canada
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Sources and changes                                                                         */
/* ------------------------------------------------------------------------------------------ */

const S = {
  us: "ebay-us-fees",
  usStore: "ebay-us-store",
  usCenter: "ebay-us-seller-center",
  usTrp: "ebay-us-standards",
  usPl: "ebay-us-promoted",
  plAttr: "ebay-pl-attribution",
  plNews: "ebay-pl-2026",
  usPayout: "ebay-us-payouts",
  us2025: "ebay-us-2025",
  ukPrivate: "ebay-uk-private",
  ukBusiness: "ebay-uk-business",
  ukBp: "ebay-uk-buyer-protection",
  ukBpNews: "ebay-uk-buyer-protection-news",
  ukRate: "ebay-uk-2026",
  ukEis: "ebay-uk-eis",
  ukRof: "ebay-uk-rof",
  ukFree: "ebay-uk-free-selling",
  ukPl: "ebay-uk-promoted",
  ca: "ebay-ca-fees",
  caStore: "ebay-ca-store",
  ca2025: "ebay-ca-2025",
  ca2024: "ebay-ca-2024",
  caPl: "ebay-ca-promoted",
  au: "ebay-au-fees",
  auPro: "ebay-au-pro",
  auBp: "ebay-au-buyer-protection",
  auChanges: "ebay-au-2026",
  auPl: "ebay-au-promoted",
  dePrivate: "ebay-de-private",
  deBusiness: "ebay-de-business",
  dePl: "ebay-de-promoted",
} as const;

const C = "2026-10-23";
const sources: Source[] = [
  { id: S.us, title: "Selling fees", url: "https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822", publisher: "eBay", checked: C },
  { id: S.usStore, title: "Store selling fees", url: "https://www.ebay.com/help/selling/selling-fees/store-fees?id=4809", publisher: "eBay", checked: C },
  { id: S.usCenter, title: "Seller fees", url: "https://www.ebay.com/sellercenter/selling/start-selling-on-ebay/seller-fees", publisher: "eBay Seller Center", checked: C },
  { id: S.usTrp, title: "Seller standards policy", url: "https://www.ebay.com/help/policies/selling-policies/seller-standards-policy?id=4347", publisher: "eBay", checked: C },
  { id: S.usPl, title: "General campaign strategy", url: "https://www.ebay.com/help/selling/listings/listing-tips/promoted-listings?id=4164", publisher: "eBay", checked: C },
  { id: S.plAttr, title: "How eBay Advertising attribution works", url: "https://pages.ebay.com/sell/pl/attribution.html", publisher: "eBay", checked: C },
  {
    id: S.plNews,
    title: "Seller Announcement: Updates to eBay’s Promoted Listings are coming soon",
    url: "https://community.ebay.com/t5/Announcements/Seller-Announcement-Updates-to-eBay-s-Promoted-Listings-are/ba-p/35311118",
    publisher: "eBay Community (official announcement)",
    checked: C,
  },
  { id: S.usPayout, title: "Getting paid for items you've sold", url: "https://www.ebay.com/help/fees-billing/payouts-payments-paid/get-paid-managed-payments-seller?id=4814", publisher: "eBay", checked: C },
  { id: S.us2025, title: "Final value fee changes", url: "https://www.ebay.com/sellercenter/resources/seller-updates/2025-january/final-value-fee", publisher: "eBay Seller Center", checked: C },
  { id: S.ukPrivate, title: "Fees for private sellers", url: "https://www.ebay.co.uk/help/selling/fees-credits-invoices/selling-fees?id=4822", publisher: "eBay UK", checked: C },
  { id: S.ukBusiness, title: "Fees for business sellers", url: "https://www.ebay.co.uk/help/selling/fees-credits-invoices/fees-business-sellers?id=4809", publisher: "eBay UK", checked: C },
  { id: S.ukBp, title: "Introducing Buyer Protection", url: "https://pages.ebay.co.uk/buyerprotection/", publisher: "eBay UK", checked: C },
  { id: S.ukBpNews, title: "Buyer protection", url: "https://www.ebay.co.uk/sellercentre/news/2025-january/buyer-protection", publisher: "eBay UK Seller Centre", checked: C },
  { id: S.ukRate, title: "Rate Card Change", url: "https://www.ebay.co.uk/sellercentre/news/2026-january/rate-card-change", publisher: "eBay UK Seller Centre", checked: C },
  { id: S.ukEis, title: "eBay International Shipping", url: "https://www.ebay.co.uk/sellercentre/postage/ebay-international-shipping", publisher: "eBay UK Seller Centre", checked: C },
  { id: S.ukRof, title: "Seller Fees", url: "https://www.ebay.co.uk/sellercentre/selling/start-selling/fees", publisher: "eBay UK Seller Centre", checked: C },
  { id: S.ukFree, title: "Start cashing in on your past loves", url: "https://pages.ebay.co.uk/selling-on-ebay/", publisher: "eBay UK", checked: C },
  { id: S.ukPl, title: "General campaign strategy", url: "https://www.ebay.co.uk/help/selling/listings/listing-tips/promoted-listings?id=4164", publisher: "eBay UK", checked: C },
  { id: S.ca, title: "Selling fees", url: "https://www.ebay.ca/help/selling/fees-credits-invoices/selling-fees?id=4822", publisher: "eBay Canada", checked: C },
  { id: S.caStore, title: "Store selling fees", url: "https://www.ebay.ca/help/selling/selling-fees/store-fees?id=4809", publisher: "eBay Canada", checked: C },
  { id: S.ca2025, title: "Final value fee changes", url: "https://www.ebay.ca/sellercentre/resources/seller-updates/2025-january/final-value-fees", publisher: "eBay Canada Seller Centre", checked: C },
  { id: S.ca2024, title: "Fees & Financials", url: "https://www.ebay.ca/sellercentre/resources/seller-updates/2024-winter/financials", publisher: "eBay Canada Seller Centre", checked: C },
  { id: S.caPl, title: "General campaign strategy", url: "https://www.ebay.ca/help/selling/listings/listing-tips/promoted-listings?id=4164", publisher: "eBay Canada", checked: C },
  { id: S.au, title: "Selling fees without a Pro plan", url: "https://www.ebay.com.au/help/selling/fees-credits-invoices/selling-fees?id=4822", publisher: "eBay Australia", checked: C },
  { id: S.auPro, title: "eBay Pro selling fees", url: "https://www.ebay.com.au/help/selling/fees-credits-invoices/ebay-pro-selling-fees?id=4809", publisher: "eBay Australia", checked: C },
  { id: S.auBp, title: "Introducing Buyer Protection", url: "https://pages.ebay.com.au/buyerprotection/", publisher: "eBay Australia", checked: C },
  { id: S.auChanges, title: "Important changes to eBay selling", url: "https://pages.ebay.com.au/about-pro-subscription/", publisher: "eBay Australia", checked: C },
  { id: S.auPl, title: "General campaign strategy", url: "https://www.ebay.com.au/help/selling/listings/listing-tips/promoted-listings?id=4164", publisher: "eBay Australia", checked: C },
  { id: S.dePrivate, title: "Gebühren für private Verkäufer", url: "https://www.ebay.de/help/selling/fees-credits-invoices/gebhren-fr-private-verkufer?id=4822", publisher: "eBay Germany", checked: C },
  { id: S.deBusiness, title: "Gebühren für gewerbliche Verkäufer", url: "https://www.ebay.de/help/selling/fees-credits-invoices/shop-selling-fees?id=4809", publisher: "eBay Germany", checked: C },
  { id: S.dePl, title: "Allgemeine Kampagnenstrategie", url: "https://www.ebay.de/help/selling/listings/listing-tips/promoted-listings?id=4164", publisher: "eBay Germany", checked: C },
];

const changes: FeeChange[] = [
  { date: "2026-12-02", text: "Germany: seller currency conversion charge rises from 3% to 3.25%.", source: S.deBusiness, upcoming: true },
  { date: "2026-12-01", text: "UK: seller currency conversion charge rises from 2.5% to 2.75%.", source: S.ukBusiness, upcoming: true },
  { date: "2026-11-01", text: "Australia: seller currency conversion charge rises from 3% to 3.25%.", source: S.au, upcoming: true },
  { date: "2026-10-14", text: "US: seller currency conversion charge rose from 3% to 3.25% (only applies when eBay converts your funds).", source: S.us },
  {
    date: "2026-07-01",
    text: "US: sellers rated Below Standard four months in a row pay an extra 7% of the total sale (was 6%); a ‘not as described’ return rate rated Very High four months in a row costs 6% (was 5%).",
    source: S.us,
  },
  {
    date: "2026-05-12",
    text: "Australia: free selling for Australian sellers with up to AU$25,000 in sales over 12 months (buyers pay a Buyer Protection fee instead); Stores became Pro plans, and sellers above the limit move to Pro Starter at 13.4% + $0.30.",
    source: S.auChanges,
  },
  {
    date: "2026-02-12",
    text: "UK business sellers: per-order fee on orders over £10 rose from £0.30 to £0.40; Business, Office & Industrial 11.9% → 12.5%; Vehicle Parts 8.9% → 9.5% up to £750 then 3%; Tyres, GPS and Power Tools thresholds moved to £750.",
    source: S.ukRate,
  },
  {
    date: "2026-01-13",
    text: "Promoted Listings (general campaigns): an ad fee is now charged when the item sells within 30 days of any buyer’s click on the ad, at the ad rate in effect at the time of sale. Already the rule on eBay UK, Australia and Germany.",
    source: S.plNews,
  },
  { date: "2025-03-03", text: "Canada: final value fees up by as much as 0.35 points; most categories 13.25% → 13.6% without a store.", source: S.ca2025 },
  { date: "2025-02-14", text: "US: final value fees up by as much as 0.35 points; most categories 13.25% → 13.6% without a store and 12.35% → 12.7% with a Basic store or higher.", source: S.us2025 },
  { date: "2025-02-04", text: "UK: buyers start paying a Buyer Protection fee on items from UK private sellers.", source: S.ukBpNews },
  { date: "2024-10-01", text: "UK: private sellers stop paying final value fees and the regulatory operating fee (vehicles excepted).", source: S.ukFree },
  { date: "2024-03-22", text: "Canada: per-order fee on orders over $10 rose from $0.30 to $0.40.", source: S.ca2024 },
];

/* ------------------------------------------------------------------------------------------ */
/* Inputs → the seller's situation                                                             */
/* ------------------------------------------------------------------------------------------ */

type Regime = "na" | "uk-private" | "uk-business" | "au-free" | "au-pro" | "de-private" | "de-business";

function regime(inputs: Inputs, market: Market): Regime {
  switch (market.id) {
    case "uk":
      return str(inputs, "sellerUk", "private") === "business" ? "uk-business" : "uk-private";
    case "au":
      return str(inputs, "planAu", "free") === "free" ? "au-free" : "au-pro";
    case "de":
      return str(inputs, "sellerDe", "private") === "business" ? "de-business" : "de-private";
    default:
      return "na";
  }
}

const hasFvf = (r: Regime) => r === "na" || r === "uk-business" || r === "au-pro" || r === "de-business";

function naStore(inputs: Inputs, market: Market) {
  const table = market.id === "ca" ? CA_STORES : US_STORES;
  const id = str(inputs, market.id === "ca" ? "storeCa" : "store", "none");
  return { id: table[id] ? id : "none", ...(table[id] ?? table.none) };
}

function categoryRule(inputs: Inputs, market: Market): { label: string; rule: Rule; usedRate?: number } {
  const id = str(inputs, "category");
  if (market.id === "uk") {
    const c = UK_CATEGORIES.find((x) => x.id === id) ?? UK_CATEGORIES[0];
    return { label: c.label, rule: c.rule };
  }
  if (market.id === "au") {
    const c = AU_CATEGORIES.find((x) => x.id === id) ?? AU_CATEGORIES.find((x) => x.id === "au-home")!;
    return { label: c.label, rule: auRule(str(inputs, "planAu", "starter"), c.tier) };
  }
  if (market.id === "de") {
    const c = DE_CATEGORIES.find((x) => x.id === id) ?? DE_CATEGORIES[0];
    const shop = str(inputs, "shopDe", "none") !== "none";
    return { label: c.label, rule: shop && c.shopRule ? c.shopRule : c.rule, usedRate: c.usedRate };
  }
  const c = NA_CATEGORIES.find((x) => x.id === id) ?? NA_CATEGORIES[0];
  const st = naStore(inputs, market).table === "st";
  if (market.id === "ca" && c.caMost) return { label: c.label, rule: st ? ST_MOST : NS_MOST };
  return { label: c.label, rule: st ? c.st : c.ns };
}

/** The rule actually applied, after the DE condition rate. */
function appliedRule(inputs: Inputs, market: Market) {
  const c = categoryRule(inputs, market);
  const used = market.id === "de" && c.usedRate !== undefined && str(inputs, "conditionDe", "new") === "used";
  return { ...c, rule: used ? m(c.usedRate!) : c.rule, used };
}

function taxRate(inputs: Inputs, market: Market): number {
  return market.id === "us" || market.id === "ca" ? Math.min(30, Math.max(0, num(inputs, "salesTax"))) : 0;
}

function amounts(inputs: Inputs, market: Market, priceCents?: number) {
  const price = priceCents ?? toCents(num(inputs, "price"));
  const shipping = toCents(num(inputs, "shippingCharged"));
  const tax = pct(price + shipping, taxRate(inputs, market));
  return { price, shipping, tax, total: price + shipping + tax };
}

/** UK / AU Buyer Protection fee on one item (cents). */
function buyerProtection(market: Market, item: number) {
  const tiers = market.id === "uk" ? bands(7, 20, 4, 300, 2, 4000, 0) : bands(8, 20, 6, 500, 4, 5000, 0);
  const flat = market.id === "uk" ? 10 : 30;
  const f = bandFee(tiers, item);
  return { amount: roundCents(f.exact) + flat, parts: f.parts.filter(([r]) => r > 0), flat };
}

/** Plans with a monthly price, for the "share of your store fee" line (cents per month). */
function monthlyPlanFee(inputs: Inputs, market: Market): { fee: number; label: string; note?: string } | null {
  const r = regime(inputs, market);
  if (r === "na") {
    const s = naStore(inputs, market);
    if (!s.fee) return null;
    const yearly = str(inputs, "storeBilling", "yearly") === "yearly";
    const fee = yearly || s.fee[0] === null ? s.fee[1] : s.fee[0];
    return { fee, label: s.label, note: !yearly && s.fee[0] === null ? "only sold with yearly renewal" : yearly ? "yearly renewal" : "monthly renewal" };
  }
  if (r === "uk-business") {
    const s = UK_SHOPS[str(inputs, "shopUk", "none")] ?? UK_SHOPS.none;
    return s.fee ? { fee: s.fee, label: s.label.split(" ·")[0] } : null;
  }
  if (r === "au-pro") {
    const p = AU_PRO[str(inputs, "planAu", "starter")] ?? AU_PRO.starter;
    return p.monthly ? { fee: p.monthly, label: p.label } : null;
  }
  if (r === "de-business") {
    const s = DE_SHOPS[str(inputs, "shopDe", "none")] ?? DE_SHOPS.none;
    return s.fee ? { fee: s.fee, label: s.label.split(" ·")[0] } : null;
  }
  return null;
}

function abroad(i: Inputs): boolean {
  return str(i, "buyer", "domestic") === "abroad";
}

/* ------------------------------------------------------------------------------------------ */
/* calculate()                                                                                 */
/* ------------------------------------------------------------------------------------------ */

function calculate(inputs: Inputs, market: Market) {
  const money = moneyFor(market);
  const whole = (units: number) => formatMoney(units * 100, market.currency, market.locale, { whole: true });
  const r = regime(inputs, market);
  const { price, shipping, tax, total } = amounts(inputs, market);
  const saleAmount = price + shipping;
  const id = market.id;
  const auPro = r === "au-pro";
  const gst = id === "au" && bool(inputs, "gstExempt") ? 1 / 1.1 : 1; // AU prices include GST; exempt ABN holders pay ÷ 1.1
  const src = ({ us: S.us, ca: S.ca, uk: S.ukBusiness, au: S.auPro, de: S.deBusiness } as Record<string, string>)[id] ?? S.us;
  const totalWhat =
    id === "us" || id === "ca"
      ? `the total sale: item, shipping and the ${tax ? `${money(tax)} ` : ""}sales tax the buyer pays`
      : `the total sale: item and postage, ${id === "au" ? "GST" : "VAT"} included`;

  const fees: Line[] = [];
  let noPerOrder = false;

  if (hasFvf(r)) {
    const c = appliedRule(inputs, market);
    const f = ruleFee(c.rule, total, price);
    noPerOrder = f.noPerOrder;
    const variable = roundCents(f.exact * gst);
    const detail = f.parts.length ? f.parts.map(([rate, slice]) => `${formatRate(rate)} × ${money(slice)}`).join(" + ") + (gst !== 1 ? " ÷ 1.1 (no GST)" : "") : "No sale";
    const planText =
      r === "na"
        ? naStore(inputs, market).table === "st"
          ? " with a Basic store or higher"
          : naStore(inputs, market).id === "starter"
            ? " with a Starter store (same rates as no store)"
            : " without a store"
        : r === "au-pro"
          ? ` on ${AU_PRO[str(inputs, "planAu", "starter")]?.label ?? "Pro Starter"}`
          : r === "de-business" && c.used
            ? " for used, refurbished and ‘new: other’ items"
            : "";
    fees.push({
      id: "fvf",
      label: "Final value fee",
      amount: variable,
      kind: "platform",
      detail,
      explain: `${c.label}${planText}: ${ruleText(c.rule, whole)}. Charged on ${totalWhat}${c.rule.kind === "bands" && c.rule.bands.length > 1 ? "; only the part above each threshold gets the lower rate" : ""}.${id === "uk" || id === "de" ? " Rates exclude VAT." : id === "au" ? (gst === 1 ? " Rates include 10% GST." : "") : ""}`,
      source: src,
    });

    // Top Rated Plus (US) / Premium Service (UK business): 10% off the percentage part only.
    if ((id === "us" || r === "uk-business") && bool(inputs, "topRated") && variable) {
      fees.push({
        id: "toprated",
        label: id === "us" ? "Top Rated Plus discount" : "Premium Service discount",
        amount: -pct(variable, 10),
        kind: "platform",
        detail: `−10% × ${money(variable)}`,
        explain:
          id === "us"
            ? "Top Rated sellers get 10% off the percentage part of the final value fee on Top Rated Plus listings (same or 1-day handling, 30-day free returns). The per-order fee isn’t discounted."
            : "Top-rated sellers get 10% off the variable final value fee on Premium Service listings. The per-order fee isn’t discounted.",
        source: id === "us" ? S.usTrp : S.ukBusiness,
      });
    }

    // Per-order fee ("Final Value Fee - fixed").
    if (total > 0) {
      let fixed: number;
      let explain: string;
      if (auPro) {
        const p = AU_PRO[str(inputs, "planAu", "starter")] ?? AU_PRO.starter;
        fixed = roundCents(p.perOrder * gst);
        explain = `${p.label} charges ${money(p.perOrder)} per order (GST included), however many items the buyer buys at one checkout.`;
      } else {
        const [low, high] = id === "de" ? [35, 45] : [30, 40];
        fixed = total <= 1000 ? low : high;
        explain = `${money(low)} for orders of ${money(1000)} or less, ${money(high)} above, once per order (all items one buyer pays for at one checkout with the same shipping method). We count the order total including shipping${id === "us" || id === "ca" ? " and tax" : ""}.`;
      }
      if (noPerOrder) {
        fees.push({ id: "perorder", label: "Per-order fee", amount: 0, kind: "platform", detail: "Not charged", explain: "eBay doesn’t charge the per-order fee on athletic shoes when the total sale is $150 or more.", source: src });
      } else {
        fees.push({ id: "perorder", label: "Per-order fee", amount: fixed, kind: "platform", detail: auPro ? (gst !== 1 ? "÷ 1.1 (no GST)" : "Per order") : `Order total ${money(total)}`, explain, source: src });
      }
    }

    // Platin-Shop: 10% off the whole final value fee, fixed part included.
    if (r === "de-business" && str(inputs, "shopDe", "none") === "platin") {
      const base = fees.filter((l) => l.id === "fvf" || l.id === "perorder").reduce((s, l) => s + l.amount, 0);
      fees.push({ id: "platin", label: "Platin-Shop discount", amount: -pct(base, 10), kind: "platform", detail: `−10% × ${money(base)}`, explain: "Platin-Shop subscribers get 10% off the whole final value fee, variable and fixed parts.", source: S.deBusiness });
    }
  } else {
    // Free-selling regimes: show the zero line so people see why.
    const why =
      r === "uk-private"
        ? { text: "UK-based private sellers pay no final value fee or regulatory operating fee since 1 October 2024 (cars, motorcycles and vehicles excepted).", source: S.ukPrivate }
        : r === "au-free"
          ? { text: "Australian sellers without a Pro plan who sold AU$25,000 or less on eBay in the last 12 months pay no final value fee (since 12 May 2026). Buyers pay a Buyer Protection fee instead.", source: S.au }
          : { text: "Selling on eBay.de is free for private sellers within Germany. Fees only apply to optional upgrades, ads and international orders you ship yourself.", source: S.dePrivate };
    fees.push({ id: "fvf", label: "Final value fee", amount: 0, kind: "platform", detail: "Not charged", explain: why.text, source: why.source });
  }

  // UK business: regulatory operating fee 0.35% of the total sale.
  if (r === "uk-business" && total > 0) {
    fees.push({
      id: "rof",
      label: "Regulatory operating fee",
      amount: pct(total, 0.35),
      kind: "platform",
      detail: `0.35% × ${money(total)}`,
      explain: "A fee eBay charges UK business sellers to cover regulatory costs: 0.35% (plus VAT) of the item price and postage. It isn’t a government tax.",
      source: S.ukBusiness,
    });
  }

  // Performance surcharges.
  const sur = SURCHARGE[id];
  if (sur && (r === "na" || r === "uk-business" || id === "au") && total > 0) {
    const level = str(inputs, "performance", "standard");
    const inad = str(inputs, "inad", "none");
    const below = level === "below" ? sur.below[0] : level === "below4" ? sur.below[1] : 0;
    const inadRate = inad === "high" ? sur.inad[0] : inad === "high4" ? sur.inad[1] : 0;
    const unit = id === "uk" ? " percentage points" : "%";
    if (below) {
      fees.push({
        id: "belowstandard",
        label: `Below Standard surcharge (${formatRate(below)})`,
        amount: pct(total, below * gst),
        kind: "platform",
        detail: `${formatRate(below)} × ${money(total)}${gst !== 1 ? " ÷ 1.1" : ""}`,
        explain: `Sellers rated Below Standard on the 20th pay an extra ${formatRate(sur.below[0]).replace("%", unit)} of the total sale the following month, ${formatRate(sur.below[1]).replace("%", unit)} after four or more months in a row.`,
        source: id === "us" ? S.us : id === "ca" ? S.ca : id === "uk" ? S.ukBusiness : S.au,
      });
    }
    if (inadRate && (sur.stack || !below)) {
      fees.push({
        id: "inad",
        label: `‘Not as described’ surcharge (${formatRate(inadRate)})`,
        amount: pct(total, inadRate * gst),
        kind: "platform",
        detail: `${formatRate(inadRate)} × ${money(total)}${gst !== 1 ? " ÷ 1.1" : ""}`,
        explain: `When your rate of ‘item not as described’ returns is rated Very High in a category, sales there cost an extra ${formatRate(sur.inad[0]).replace("%", unit)} of the total sale, ${formatRate(sur.inad[1]).replace("%", unit)} after four months in a row.${sur.stack ? "" : " Not charged on top of the Below Standard surcharge."}`,
        source: id === "us" ? S.us : id === "ca" ? S.ca : id === "uk" ? S.ukBusiness : S.au,
      });
    }
  }

  // International fee.
  if (abroad(inputs) && total > 0) {
    const eis = bool(inputs, "eis") && (id === "us" || id === "ca" || r === "uk-business" || id === "de");
    let rate = 0;
    let explain = "";
    let source: string = src;
    if (id === "us") {
      rate = 1.65;
      explain = "1.65% of the total sale when the buyer’s delivery address or registered address is outside the US, even if you ship to a US address. Not charged on eligible items sent with eBay International Shipping.";
      source = S.us;
    } else if (id === "ca") {
      rate = str(inputs, "intlRegionCa", "us") === "us" ? 0.4 : 1;
      explain = "0.4% of the total sale for buyers in the US, 1% for other countries (by delivery or registered address). Not charged on eligible items sent with eBay International Shipping.";
      source = S.ca;
    } else if (r === "uk-private") {
      rate = 3;
      explain = "UK private sellers pay 3% (VAT included) of the total sale, postage included, when the delivery address is outside the UK.";
      source = S.ukPrivate;
    } else if (r === "uk-business") {
      const region = str(inputs, "intlRegionUk", "eu");
      rate = region === "eu" ? 1.05 : region === "usca" ? 1.8 : 2;
      explain = "1.05% for the eurozone, Denmark, Finland, Iceland, Norway and Sweden; 1.8% for the US and Canada; 2% elsewhere (plus VAT). Waived on eBay International Shipping orders.";
      source = S.ukBusiness;
    } else if (id === "au") {
      rate = auPro ? 1.1 : 3;
      explain = auPro
        ? "1.1% (GST included) of the total sale when the delivery address is outside Australia."
        : "Sellers without a Pro plan pay 3% (GST included) of the total sale when the delivery address is outside Australia.";
      source = auPro ? S.auPro : S.au;
    } else if (r === "de-private") {
      rate = 5;
      explain = "5% of everything the buyer pays (postage included) when you list on eBay.de and arrange the international shipping yourself. Nothing with eBay International Shipping or eBay-Versand.";
      source = S.dePrivate;
    } else {
      const region = str(inputs, "intlRegionDe", "eu");
      rate = region === "eu" ? 0 : region === "europe" ? 1.6 : region === "uk" ? 1.2 : 3.3;
      explain = "Free within the eurozone and Sweden; 1.6% for the rest of Europe, the US and Canada; 1.2% for the UK; 3.3% elsewhere. Not charged on eligible eBay International Shipping orders.";
      source = S.deBusiness;
    }
    if (eis) {
      fees.push({ id: "intl", label: "International fee", amount: 0, kind: "platform", detail: "eBay International Shipping", explain: "No international fee on eligible items sent with eBay International Shipping. The buyer pays the international postage and import charges.", source: id === "uk" ? S.ukEis : source });
    } else if (rate) {
      const amount = pct(total, rate * gst);
      fees.push({ id: "intl", label: `International fee (${formatRate(rate)})`, amount, kind: "platform", detail: `${formatRate(rate)} × ${money(total)}${gst !== 1 ? " ÷ 1.1" : ""}`, explain, source });
    }
  }

  // Promoted Listings, general campaign: ad rate × the total sale.
  const adRate = Math.min(100, Math.max(0, num(inputs, "adRate")));
  if (adRate && total > 0) {
    fees.push({
      id: "ads",
      label: `Promoted Listings ad fee (${formatRate(adRate)})`,
      amount: pct(total, adRate),
      kind: "ads",
      detail: `${formatRate(adRate)} × ${money(total)}`,
      explain: `General campaigns charge your ad rate on the total sale, ${id === "us" || id === "ca" ? "shipping and sales tax included" : "postage and taxes included"}, when the item sells within 30 days of any buyer’s click on the ad, at the rate in effect when it sells.${id === "uk" || id === "au" || id === "de" ? ` eBay may add ${id === "au" ? "GST" : "VAT"} to ad fees.` : ""}`,
      source: ({ us: S.usPl, ca: S.caPl, uk: S.ukPl, au: S.auPl, de: S.dePl } as Record<string, string>)[id] ?? S.usPl,
    });
  }

  // Store / shop / Pro subscription, shared over the orders of a month.
  const orders = Math.max(0, Math.round(num(inputs, "ordersPerMonth")));
  const plan = monthlyPlanFee(inputs, market);
  if (plan && orders > 0) {
    fees.push({
      id: "subscription",
      label: `${plan.label} subscription (share per order)`,
      amount: roundCents((plan.fee * gst) / orders),
      kind: "subscription",
      detail: `${money(roundCents(plan.fee * gst))} ÷ ${orders} orders${plan.note ? ` (${plan.note})` : ""}`,
      explain: "Your monthly subscription spread over the orders you make in a month, so you can see whether the lower rates pay for it. eBay bills it monthly, not per sale.",
      source: id === "us" ? S.usStore : id === "ca" ? S.caStore : id === "uk" ? S.ukBusiness : id === "au" ? S.auPro : S.deBusiness,
    });
  }

  // VAT on eBay's fees (UK and DE business fees are quoted without VAT).
  const vatRate = r === "uk-business" ? 20 : r === "de-business" ? 19 : 0;
  if (vatRate && bool(inputs, "vatOnFees")) {
    const base = fees.reduce((s, l) => s + l.amount, 0);
    if (base > 0) {
      fees.push({
        id: "vat",
        label: `VAT on eBay fees (${vatRate}%)`,
        amount: pct(base, vatRate),
        kind: "tax",
        detail: `${vatRate}% × ${money(base)}`,
        explain:
          r === "uk-business"
            ? "eBay’s business fees are quoted without VAT and charged with 20% UK VAT on top. VAT-registered businesses can usually reclaim it; turn this off if you do."
            : "eBay.de quotes business fees without VAT. Leave this on if your eBay invoice adds 19% German VAT (for example, no VAT ID on file).",
        source: r === "uk-business" ? S.ukBusiness : S.deBusiness,
      });
    }
  }

  // Seller currency conversion charge, when eBay converts the proceeds.
  if (bool(inputs, "currencyConversion")) {
    const rate = conversionRate(id);
    const base = saleAmount - fees.reduce((s, l) => s + l.amount, 0);
    if (base > 0) {
      fees.push({
        id: "conversion",
        label: `Currency conversion (${formatRate(rate)})`,
        amount: pct(base, rate),
        kind: "payment",
        detail: `≈ ${formatRate(rate)} × ${money(base)}`,
        explain: `Built into eBay’s exchange rate when it converts your money, for example when you sell on another country’s eBay site: ${formatRate(rate)} for sellers registered in ${market.label}. Estimated here on what’s left after the other fees.`,
        source: id === "uk" ? S.ukBusiness : id === "au" ? S.au : id === "de" ? S.deBusiness : id === "ca" ? S.ca : S.us,
      });
    }
  }

  // US express payout.
  if (id === "us" && bool(inputs, "expressPayout")) {
    fees.push({
      id: "express",
      label: "Express payout fee",
      amount: 200,
      kind: "payout",
      detail: "$2.00 per payout",
      explain: "Standard payouts are free. An express payout to your debit card or bank, usually within 30 minutes, costs $2.00 each time (shared across all the sales in that payout).",
      source: S.usPayout,
    });
  }

  // Buyer Protection fee (UK private sellers, AU sellers on free selling): paid by the buyer.
  const buyerFees: Line[] = [];
  if ((r === "uk-private" || r === "au-free") && price > 0) {
    const bp = buyerProtection(market, price);
    buyerFees.push({
      id: "buyerprotection",
      label: "Buyer Protection fee (paid by the buyer)",
      amount: bp.amount,
      kind: "other",
      detail: `${bp.parts.map(([rate, slice]) => `${formatRate(rate)} × ${money(slice)}`).join(" + ")} + ${money(bp.flat)}`,
      explain:
        id === "uk"
          ? "Added to your price for the buyer, not taken from you: £0.10 per item plus 7% of the item price up to £20, 4% from £20 to £300 and 2% from £300 to £4,000. Not charged on postage. VAT included."
          : "Added to your price for the buyer, not taken from you: AU$0.30 per item plus 8% of the item price up to $20, 6% from $20 to $500 and 4% from $500 to $5,000. Not charged on postage. GST included.",
      source: id === "uk" ? S.ukBp : S.auBp,
    });
  }

  const notes: string[] = [];
  if (r === "uk-private") notes.push("Buyers see your price plus the Buyer Protection fee; you receive your full price and postage.");
  if (r === "au-free") notes.push("Free selling needs an Australian address, no Pro plan and AU$25,000 or less in eBay sales (incl. postage and tax) over the last 12 full months; above that eBay moves you to Pro Starter (13.4% + $0.30).");
  if (r === "de-business") notes.push("Rates are for sellers rated Above Standard or Top Rated. Below Standard sellers pay a separate, higher rate card on eBay.de.");
  if (id === "us" && !taxRate(inputs, market)) notes.push("eBay also takes its percentage of the sales tax the buyer pays. Add the buyer’s tax rate for the exact fee.");
  if (!adRate && r !== "de-private") notes.push("Promoting this listing? Add your ad rate: it’s charged on the whole sale, shipping and tax included, if anyone clicked the ad in the 30 days before it sold.");

  return assemble({
    market,
    buyerPays: total + buyerFees.reduce((s, l) => s + l.amount, 0),
    saleAmount,
    fees,
    buyerFees,
    costs: costLines(inputs, market),
    notes: notes.slice(0, 3),
  });
}

/* ------------------------------------------------------------------------------------------ */
/* Breakpoints: every price where the formula changes shape                                    */
/* ------------------------------------------------------------------------------------------ */

/** Lowest price (cents) whose total satisfies `ok`, or null. The total rises with the price. */
function lowestPrice(inputs: Inputs, market: Market, ok: (total: number) => boolean): number | null {
  let lo = 0;
  let hi = 100_000_000;
  if (!ok(amounts(inputs, market, hi).total)) return null;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (ok(amounts(inputs, market, mid).total)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

function breakpoints(inputs: Inputs, market: Market): number[] {
  const r = regime(inputs, market);
  if (!hasFvf(r)) return [];
  const out: number[] = [];
  const atTotal = (cents: number) => {
    const ge = lowestPrice(inputs, market, (t) => t >= cents);
    const gt = lowestPrice(inputs, market, (t) => t > cents);
    if (ge !== null) out.push(ge);
    if (gt !== null) out.push(gt);
  };
  // Per-order fee steps up above an order total of 10.00 (not on AU Pro, which is flat).
  if (r !== "au-pro") atTotal(1000);
  const { rule } = appliedRule(inputs, market);
  const th = ruleThresholds(rule);
  for (const units of th.at) {
    if (th.on === "item") {
      out.push(units * 100, units * 100 + 1);
      // Bands inside an item-price step are still measured on the total.
      atTotal(units * 100);
    } else atTotal(units * 100);
  }
  return [...new Set(out)].filter((c) => c > 0).sort((a, b) => a - b);
}

/* ------------------------------------------------------------------------------------------ */
/* Fee table per market                                                                        */
/* ------------------------------------------------------------------------------------------ */

function schedule(market: Market): ScheduleRow[] {
  switch (market.id) {
    case "uk":
      return [
        { fee: "Final value fee", amount: "None", appliesTo: "—", when: "UK private sellers (not vehicles)", source: S.ukPrivate },
        { fee: "Buyer Protection fee (buyer pays)", amount: "£0.10 + 7% to £20, 4% to £300, 2% to £4,000", appliesTo: "Item price, per item", when: "Items from UK private sellers", source: S.ukBp },
        { fee: "International fee", amount: "3% (incl. VAT)", appliesTo: "Item + postage + taxes", when: "Private sellers, buyer outside the UK", source: S.ukPrivate },
        { fee: "Listing fee", amount: "300 free a month, then 35p", appliesTo: "Each new listing", when: "Private sellers", source: S.ukPrivate },
        { fee: "Final value fee", amount: "9.9%–14.9% by category (5% NFTs), lower rate above some thresholds", appliesTo: "Item + postage + taxes, per item", when: "Business sellers, + VAT", source: S.ukBusiness },
        { fee: "Per-order fee", amount: "£0.30 (orders ≤ £10) / £0.40", appliesTo: "Each order", when: "Business sellers", source: S.ukBusiness },
        { fee: "Regulatory operating fee", amount: "0.35%", appliesTo: "Item + postage + taxes", when: "Business sellers", source: S.ukBusiness },
        { fee: "International fee", amount: "1.05% eurozone & Nordics / 1.8% US & Canada / 2% elsewhere", appliesTo: "Item + handling + postage + taxes", when: "Business sellers; not on eBay International Shipping", source: S.ukBusiness },
        { fee: "Below Standard surcharge", amount: "+6 points (+7 after 4 months)", appliesTo: "Total sale", when: "Business sellers rated Below Standard", source: S.ukBusiness },
        { fee: "‘Not as described’ surcharge", amount: "+4 points (+5 after 4 months)", appliesTo: "Total sale", when: "Very High rate in that category", source: S.ukBusiness },
        { fee: "Promoted Listings (general)", amount: "2%–100%, you choose", appliesTo: "Total sale incl. postage and taxes", when: "Sold within 30 days of an ad click", source: S.ukPl },
        { fee: "VAT on fees", amount: "20%", appliesTo: "All business fees", when: "Business sellers (reclaimable if VAT-registered)", source: S.ukBusiness },
        { fee: "Shop subscription", amount: "£27 / £77 / £437 a month", appliesTo: "Basic / Featured / Anchor", when: "Optional", source: S.ukBusiness },
        { fee: "Currency conversion", amount: `${formatRate(conversionRate("uk"))}${conversionRate("uk") < 2.75 ? " (2.75% from 1 Dec 2026)" : ""}`, appliesTo: "Converted amount", when: "Only when eBay converts your funds", source: S.ukBusiness },
      ];
    case "au":
      return [
        { fee: "Final value fee", amount: "None", appliesTo: "—", when: "No Pro plan, ≤ AU$25,000 sales in 12 months", source: S.au },
        { fee: "Buyer Protection fee (buyer pays)", amount: "$0.30 + 8% to $20, 6% to $500, 4% to $5,000", appliesTo: "Item price, per item", when: "Items from sellers without Pro", source: S.auBp },
        { fee: "International fee", amount: "3% (no Pro) / 1.1% (Pro)", appliesTo: "Total sale", when: "Delivery outside Australia", source: S.au },
        { fee: "Pro Starter", amount: "13.4% to $4,000, then 2.5%, + $0.30 per order", appliesTo: "Total sale incl. postage, per item", when: "Automatic above $25,000; no monthly fee", source: S.auPro },
        { fee: "Pro Basic", amount: "8.03%–13.09% by tier, 2.75% above $4,000, + $0.33", appliesTo: "Total sale, per item", when: "$27.45 a month", source: S.auPro },
        { fee: "Pro Featured", amount: "7.26%–11.77% by tier, 2.75% above $4,000, + $0.33", appliesTo: "Total sale, per item", when: "$82.45 a month", source: S.auPro },
        { fee: "Pro Anchor", amount: "6.82%–11.11% by tier, 2.75% above $4,000, + $0.33", appliesTo: "Total sale, per item", when: "$604.95 a month", source: S.auPro },
        { fee: "Below Standard / ‘not as described’", amount: "5.5% (6.6% after 4 months)", appliesTo: "Total sale", when: "Low seller rating", source: S.au },
        { fee: "Promoted Listings (general)", amount: "2%–100%, you choose", appliesTo: "Total sale incl. postage and taxes", when: "Sold within 30 days of an ad click", source: S.auPl },
        { fee: "Currency conversion", amount: `${formatRate(conversionRate("au"))}${conversionRate("au") < 3.25 ? " (3.25% from 1 Nov 2026)" : ""}`, appliesTo: "Converted amount", when: "Only when eBay converts your funds", source: S.au },
      ];
    case "de":
      return [
        { fee: "Final value fee", amount: "None", appliesTo: "—", when: "Private sellers, sales within Germany", source: S.dePrivate },
        { fee: "International fee", amount: "5% (none with eBay International Shipping)", appliesTo: "Everything the buyer pays", when: "Private sellers shipping abroad themselves", source: S.dePrivate },
        { fee: "Final value fee", amount: "5%–16% by category and condition, 3% above €990 in many", appliesTo: "Total sale incl. postage and VAT", when: "Business sellers, + VAT", source: S.deBusiness },
        { fee: "Per-order fee", amount: "€0.35 (orders ≤ €10) / €0.45", appliesTo: "Each order", when: "Business sellers", source: S.deBusiness },
        { fee: "International fee", amount: "Free eurozone & Sweden / 1.6% rest of Europe, US, Canada / 1.2% UK / 3.3% elsewhere", appliesTo: "Total sale", when: "Business sellers; not on eBay International Shipping", source: S.deBusiness },
        { fee: "eBay Shop", amount: "€39.95 / €79.95 / €299.95 / €4,999.95 a month", appliesTo: "Basis / Top / Premium / Platin", when: "Platin: 10% off final value fees", source: S.deBusiness },
        { fee: "Promoted Listings (general)", amount: "2%–100%, you choose", appliesTo: "Total sale incl. postage and taxes", when: "Sold within 30 days of an ad click", source: S.dePl },
        { fee: "Currency conversion", amount: `${formatRate(conversionRate("de"))}${conversionRate("de") < 3.25 ? " (3.25% from 2 Dec 2026)" : ""}`, appliesTo: "Converted amount", when: "Only when eBay converts your funds", source: S.deBusiness },
      ];
    case "ca":
      return [
        { fee: "Final value fee", amount: "13.6% up to $7,500, then 2.35%", appliesTo: "Item + shipping + sales tax, per item", when: "Most categories, no store", source: S.ca },
        { fee: "Final value fee", amount: "12.7% up to $2,500, then 2.35%", appliesTo: "Item + shipping + sales tax, per item", when: "Most categories, Basic store or higher", source: S.caStore },
        { fee: "Other categories", amount: "5%–15.3% (electronics 7.35%–9.35% with a store)", appliesTo: "Same", when: "Books, cards, coins, sneakers, guitars…", source: S.caStore },
        { fee: "Per-order fee", amount: "$0.30 (orders ≤ $10) / $0.40", appliesTo: "Each order", when: "Not on sneakers $150+", source: S.ca },
        { fee: "International fee", amount: "0.4% US / 1% elsewhere", appliesTo: "Total sale", when: "Not on eBay International Shipping", source: S.ca },
        { fee: "Below Standard surcharge", amount: "+6% (+7% after 4 months)", appliesTo: "Total sale", when: "Below Standard sellers", source: S.ca },
        { fee: "‘Not as described’ surcharge", amount: "+5% (+6% after 4 months)", appliesTo: "Total sale", when: "Very High rate in that category", source: S.ca },
        { fee: "Promoted Listings (general)", amount: "2%–100%, you choose", appliesTo: "Total sale incl. shipping and tax", when: "Sold within 30 days of an ad click", source: S.caPl },
        { fee: "Insertion fee", amount: "250 free a month, then $0.30", appliesTo: "Each listing", when: "No store", source: S.ca },
        { fee: "Store subscription", amount: "Basic $19.95–$24.95, Premium $59.95–$74.95, Anchor $299.95–$349.95 a month", appliesTo: "Yearly / monthly renewal", when: "Optional", source: S.caStore },
        { fee: "Currency conversion", amount: "3.25%", appliesTo: "Converted amount", when: "Only when eBay converts your funds", source: S.ca },
      ];
    default:
      return [
        { fee: "Final value fee", amount: "13.6% up to $7,500, then 2.35%", appliesTo: "Item + shipping + sales tax, per item", when: "Most categories, no store or Starter store", source: S.us },
        { fee: "Final value fee", amount: "12.7% up to $2,500, then 2.35%", appliesTo: "Item + shipping + sales tax, per item", when: "Most categories, Basic store or higher", source: S.usStore },
        { fee: "Books, movies & music", amount: "15.3%", appliesTo: "Same", when: "Up to $7,500 (no store) / $2,500 (store)", source: S.us },
        { fee: "Electronics with a store", amount: "7.35%–9.35% (12.7% accessories)", appliesTo: "Same", when: "Basic store or higher; 13.6% without", source: S.usStore },
        { fee: "Sneakers $150+", amount: "8% (7% with a store), no per-order fee", appliesTo: "Same", when: "Athletic shoes", source: S.us },
        { fee: "Jewelry / handbags", amount: "15% (13% store), 9% (7%) above $5,000 / $2,000", appliesTo: "Whole sale", when: "Rate drops for the whole sale above the threshold", source: S.us },
        { fee: "Per-order fee", amount: "$0.30 (orders ≤ $10) / $0.40", appliesTo: "Each order", when: "All sellers", source: S.us },
        { fee: "International fee", amount: "1.65%", appliesTo: "Total sale", when: "Buyer’s address abroad; not on eBay International Shipping", source: S.us },
        { fee: "Below Standard surcharge", amount: "+6% (+7% after 4 months)", appliesTo: "Total sale", when: "Below Standard sellers", source: S.us },
        { fee: "‘Not as described’ surcharge", amount: "+5% (+6% after 4 months)", appliesTo: "Total sale", when: "Very High rate in that category", source: S.us },
        { fee: "Promoted Listings (general)", amount: "2%–100%, you choose", appliesTo: "Total sale incl. shipping and tax", when: "Sold within 30 days of any buyer’s ad click", source: S.usPl },
        { fee: "Top Rated Plus", amount: "−10% of the percentage fee", appliesTo: "Final value fee (not the per-order fee)", when: "Top Rated sellers’ qualifying listings", source: S.usTrp },
        { fee: "Insertion fee", amount: "250 free a month, then $0.35", appliesTo: "Each listing, per category", when: "No store", source: S.us },
        { fee: "Store subscription", amount: "Starter $4.95–$7.95 to Enterprise $2,999.95 a month", appliesTo: "Yearly / monthly renewal", when: "Optional", source: S.usStore },
        { fee: "Express payout", amount: "$2.00", appliesTo: "Each express payout", when: "Standard payouts are free", source: S.usPayout },
        { fee: "Currency conversion", amount: "3.25%", appliesTo: "Converted amount", when: "Only when eBay converts your funds", source: S.us },
      ];
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Fields                                                                                      */
/* ------------------------------------------------------------------------------------------ */

const isNa = (m: Market) => m.id === "us" || m.id === "ca";
const fvfShown = (i: Inputs, m: Market) => hasFvf(regime(i, m));
const surchargeShown = (i: Inputs, m: Market) => isNa(m) || m.id === "au" || regime(i, m) === "uk-business";

function categoryOptions(inputs: Inputs, market: Market): SelectOption[] {
  const whole = (units: number) => formatMoney(units * 100, market.currency, market.locale, { whole: true });
  if (market.id === "uk") return UK_CATEGORIES.map((c) => ({ value: c.id, label: c.label, group: c.group, hint: ruleText(c.rule, whole) }));
  if (market.id === "au") {
    const plan = str(inputs, "planAu", "starter");
    return AU_CATEGORIES.map((c) => ({ value: c.id, label: c.label, group: c.group, hint: ruleText(auRule(plan === "free" ? "starter" : plan, c.tier), whole) }));
  }
  if (market.id === "de") {
    const shop = str(inputs, "shopDe", "none") !== "none";
    return DE_CATEGORIES.map((c) => ({
      value: c.id,
      label: c.label,
      group: c.group,
      hint: `${ruleText(shop && c.shopRule ? c.shopRule : c.rule, whole)}${c.usedRate !== undefined ? `; used ${formatRate(c.usedRate)}` : ""}`,
    }));
  }
  const st = naStore(inputs, market).table === "st";
  return NA_CATEGORIES.map((c) => {
    const rule = market.id === "ca" && c.caMost ? (st ? ST_MOST : NS_MOST) : st ? c.st : c.ns;
    return { value: c.id, label: c.label, group: c.group, hint: ruleText(rule, whole) };
  });
}

const DEFAULT_CATEGORY: Record<string, string> = { us: "most", ca: "most", uk: "uk-clothes", au: "au-home", de: "de-clothing" };

export const ebay: CalculatorDef = {
  slug: "ebay",
  name: "eBay",
  path: "/ebay-fee-calculator",
  category: "marketplaces",
  priceNoun: "item price",
  sellerNoun: "seller",
  blurb: "13.6% of the total incl. shipping & tax + $0.40 per order (US, no store)",
  markets: MARKETS,
  defaultMarket: "us",
  priceField: "price",
  fields: [
    { id: "price", kind: "money", label: "Item price", section: "sale", help: "Your Buy It Now price or the winning bid, before shipping and tax." },
    {
      id: "store",
      kind: "select",
      label: "Do you have an eBay Store?",
      section: "sale",
      options: Object.entries(US_STORES).map(([value, s]) => ({ value, label: s.label, hint: s.table === "st" ? "12.7% most categories" : "13.6% most categories" })),
      help: "Basic and higher stores pay lower rates (12.7% in most categories, 7.35%–9.35% in electronics). Starter pays the no-store rates.",
      showIf: (_i, m) => m.id === "us",
    },
    {
      id: "storeCa",
      kind: "segmented",
      label: "Do you have an eBay Store?",
      section: "sale",
      options: Object.entries(CA_STORES).map(([value, s]) => ({ value, label: s.label })),
      help: "Stores pay 12.7% in most categories instead of 13.6%, and less in electronics.",
      showIf: (_i, m) => m.id === "ca",
    },
    {
      id: "sellerUk",
      kind: "segmented",
      label: "Are you selling as",
      section: "sale",
      options: [
        { value: "private", label: "Private seller" },
        { value: "business", label: "Business" },
      ],
      help: "UK private sellers pay no final value fee; the buyer pays a Buyer Protection fee on top of your price.",
      showIf: (_i, m) => m.id === "uk",
    },
    {
      id: "planAu",
      kind: "select",
      label: "Your eBay plan",
      section: "sale",
      options: [
        { value: "free", label: "No Pro plan (free selling)", hint: "0% if ≤ AU$25,000 a year" },
        { value: "starter", label: "Pro Starter", hint: "13.4% + $0.30, no monthly fee" },
        { value: "basic", label: "Pro Basic", hint: "$27.45 a month" },
        { value: "featured", label: "Pro Featured", hint: "$82.45 a month" },
        { value: "anchor", label: "Pro Anchor", hint: "$604.95 a month" },
      ],
      help: "Free selling covers sellers with AU$25,000 or less in sales over 12 months; above that eBay moves you to Pro Starter.",
      showIf: (_i, m) => m.id === "au",
    },
    {
      id: "sellerDe",
      kind: "segmented",
      label: "Are you selling as",
      section: "sale",
      options: [
        { value: "private", label: "Private (privat)" },
        { value: "business", label: "Business (gewerblich)" },
      ],
      help: "Private sellers pay nothing on sales within Germany.",
      showIf: (_i, m) => m.id === "de",
    },
    {
      id: "shopDe",
      kind: "select",
      label: "Do you have an eBay Shop?",
      section: "sale",
      options: Object.entries(DE_SHOPS).map(([value, s]) => ({ value, label: s.label })),
      help: "A shop lowers the threshold in watches, jewellery and car electronics; Platin takes 10% off every final value fee.",
      showIf: (i, m) => regime(i, m) === "de-business",
    },
    {
      id: "category",
      kind: "select",
      label: "Category",
      section: "sale",
      searchable: true,
      options: categoryOptions,
      help: "The rate depends on the category. Search for yours; the hint shows its rate.",
      showIf: fvfShown,
    },
    {
      id: "conditionDe",
      kind: "segmented",
      label: "Item condition",
      section: "sale",
      options: [
        { value: "new", label: "New" },
        { value: "used", label: "Used, refurbished, new (other)" },
      ],
      help: "In this category eBay.de charges 5% for used, refurbished and ‘new: other’ items.",
      showIf: (i, m) => regime(i, m) === "de-business" && DE_CATEGORIES.find((c) => c.id === str(i, "category"))?.usedRate !== undefined,
    },
    {
      id: "salesTax",
      kind: "percent",
      label: "Sales tax the buyer pays",
      section: "sale",
      max: 30,
      step: 0.25,
      help: "eBay collects it for the state or province, but its fee is charged on the tax too. Use 0 if the buyer’s state has none.",
      showIf: (_i, m) => isNa(m),
    },
    { id: "shippingCharged", kind: "money", label: "Shipping you charge", section: "shipping", help: "eBay’s percentage applies to this too. Enter 0 for free shipping." },
    {
      id: "buyer",
      kind: "segmented",
      label: "Where is the buyer?",
      section: "shipping",
      options: [
        { value: "domestic", label: "Same country" },
        { value: "abroad", label: "Abroad" },
      ],
      help: "International orders add an international fee unless you use eBay International Shipping.",
    },
    {
      id: "intlRegionUk",
      kind: "segmented",
      label: "Buyer’s region",
      section: "shipping",
      options: [
        { value: "eu", label: "Eurozone / Nordics" },
        { value: "usca", label: "US / Canada" },
        { value: "other", label: "Elsewhere" },
      ],
      showIf: (i, m) => abroad(i) && regime(i, m) === "uk-business",
    },
    {
      id: "intlRegionCa",
      kind: "segmented",
      label: "Buyer’s country",
      section: "shipping",
      options: [
        { value: "us", label: "United States" },
        { value: "other", label: "Elsewhere" },
      ],
      showIf: (i, m) => abroad(i) && m.id === "ca",
    },
    {
      id: "intlRegionDe",
      kind: "select",
      label: "Buyer’s region",
      section: "shipping",
      options: [
        { value: "eu", label: "Eurozone or Sweden", hint: "free" },
        { value: "europe", label: "Rest of Europe, US or Canada", hint: "1.6%" },
        { value: "uk", label: "United Kingdom", hint: "1.2%" },
        { value: "other", label: "Elsewhere", hint: "3.3%" },
      ],
      showIf: (i, m) => abroad(i) && regime(i, m) === "de-business",
    },
    {
      id: "eis",
      kind: "toggle",
      label: "Shipped with eBay International Shipping",
      section: "shipping",
      help: "No international fee on eligible items; enter only the domestic postage the buyer pays you above.",
      showIf: (i, m) => abroad(i) && (isNa(m) || m.id === "de" || regime(i, m) === "uk-business"),
    },
    {
      id: "adRate",
      kind: "percent",
      label: "Promoted Listings ad rate",
      section: "options",
      max: 100,
      step: 0.1,
      help: "General campaigns: charged on the whole sale, shipping and tax included, if anyone clicked the ad within 30 days. 0 if you don’t promote.",
    },
    {
      id: "shopUk",
      kind: "select",
      label: "eBay Shop",
      section: "options",
      advanced: true,
      options: Object.entries(UK_SHOPS).map(([value, s]) => ({ value, label: s.label })),
      help: "A UK shop doesn’t change the final value fee; it adds free listings. Used only to share its cost per order below.",
      showIf: (i, m) => regime(i, m) === "uk-business",
    },
    {
      id: "topRated",
      kind: "toggle",
      label: "Top Rated Plus / Premium Service listing",
      section: "options",
      advanced: true,
      help: "Top Rated sellers get 10% off the percentage part of the fee on qualifying listings.",
      showIf: (i, m) => m.id === "us" || regime(i, m) === "uk-business",
    },
    {
      id: "performance",
      kind: "segmented",
      label: "Your seller level",
      section: "options",
      advanced: true,
      options: [
        { value: "standard", label: "Above standard" },
        { value: "below", label: "Below standard" },
        { value: "below4", label: "Below, 4+ months" },
      ],
      help: "Below Standard sellers pay a surcharge on the total sale, higher after four months in a row.",
      showIf: surchargeShown,
    },
    {
      id: "inad",
      kind: "segmented",
      label: "‘Not as described’ returns rated Very High here?",
      section: "options",
      advanced: true,
      options: [
        { value: "none", label: "No" },
        { value: "high", label: "Yes" },
        { value: "high4", label: "Yes, 4+ months" },
      ],
      help: "eBay adds a surcharge in categories where your ‘item not as described’ return rate is Very High.",
      showIf: surchargeShown,
    },
    {
      id: "vatOnFees",
      kind: "toggle",
      label: "Count VAT on eBay’s fees",
      section: "options",
      advanced: true,
      help: "Business fees are quoted without VAT. Turn off if you reclaim it as a VAT-registered business.",
      showIf: (i, m) => regime(i, m) === "uk-business" || regime(i, m) === "de-business",
    },
    {
      id: "gstExempt",
      kind: "toggle",
      label: "My ABN is registered for GST-free eBay fees",
      section: "options",
      advanced: true,
      help: "eBay.com.au fees include 10% GST unless you’ve registered for tax-exempt status.",
      showIf: (_i, m) => m.id === "au",
    },
    {
      id: "ordersPerMonth",
      kind: "number",
      label: "Orders per month (to share your plan’s fee)",
      section: "options",
      advanced: true,
      integer: true,
      min: 0,
      max: 100000,
      help: "Spreads your store, shop or Pro subscription over your monthly orders. 0 leaves it out.",
      showIf: (i, m) => monthlyPlanFee(i, m) !== null,
    },
    {
      id: "storeBilling",
      kind: "segmented",
      label: "Store renewal",
      section: "options",
      advanced: true,
      options: [
        { value: "yearly", label: "Yearly (cheaper)" },
        { value: "monthly", label: "Monthly" },
      ],
      help: "Both are billed every month; yearly renewal costs less per month.",
      showIf: (i, m) => isNa(m) && monthlyPlanFee(i, m) !== null,
    },
    {
      id: "currencyConversion",
      kind: "toggle",
      label: "eBay converts this sale to another currency",
      section: "options",
      advanced: true,
      help: "For example when you sell on another country’s eBay site. The charge is built into eBay’s exchange rate.",
    },
    { id: "expressPayout", kind: "toggle", label: "I take an express payout ($2.00)", section: "options", advanced: true, help: "Standard payouts are free.", showIf: (_i, m) => m.id === "us" },
    { id: "itemCost", kind: "money", label: "What the item cost you", section: "costs", help: "What you paid for it, or materials." },
    { id: "shippingCost", kind: "money", label: "Postage / label you pay", section: "costs" },
    { id: "otherCost", kind: "money", label: "Packaging & other", section: "costs" },
  ],
  defaults: (market) => {
    const id = market.id;
    return {
      price: id === "uk" || id === "de" ? 20 : id === "us" ? 25 : 30,
      store: "none",
      storeCa: "none",
      sellerUk: "private",
      planAu: "free",
      sellerDe: "private",
      shopDe: "none",
      category: DEFAULT_CATEGORY[id] ?? "most",
      conditionDe: "new",
      salesTax: id === "us" ? 7 : id === "ca" ? 13 : 0,
      shippingCharged: id === "uk" ? 3.5 : id === "de" ? 5 : id === "us" ? 5 : 10,
      buyer: "domestic",
      intlRegionUk: "eu",
      intlRegionCa: "us",
      intlRegionDe: "eu",
      eis: false,
      adRate: 0,
      shopUk: "none",
      topRated: false,
      performance: "standard",
      inad: "none",
      vatOnFees: id === "uk",
      gstExempt: false,
      ordersPerMonth: 0,
      storeBilling: "yearly",
      currencyConversion: false,
      expressPayout: false,
      itemCost: 0,
      shippingCost: 0,
      otherCost: 0,
    };
  },
  calculate,
  breakpoints,
  verifiedAt: "2026-10-23",
  sources,
  changes,
  schedule,
  compare: {
    group: "sell",
    map: (c) => ({ price: c.price, shippingCharged: c.shipping, salesTax: 0, itemCost: c.itemCost, shippingCost: c.shippingCost }),
    note: "US, no store, most categories, no ads, before sales tax",
  },
};

export default ebay;
