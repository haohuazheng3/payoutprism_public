/*
 * TikTok Shop (United States) seller fees. Every number is from TikTok Shop's own Academy pages
 * (see `sources`), verified 2026-10-23. Research notes with verbatim quotes: research/fees/tiktok-shop.md.
 *
 * What one order costs, as the settlement statement lists it:
 *  - Referral fee = rate × (Customer Payment + Platform Discount − Tax). Customer Payment includes
 *    the shipping the buyer pays ("The Referral Fee calculation base includes the shipping fee paid
 *    by the customer"), so the base is: item price after the seller's own discounts + buyer-paid
 *    shipping. TikTok-funded discounts are added back (they never lower the fee); sales tax and
 *    retail delivery fees are taken out.
 *    6% for most categories; 5% for five jewelry sub-categories and for Pre-Owned; Pre-Owned and
 *    Collectibles pay 3% on "any portion of the sale over $10K" (applied here to the order's base).
 *  - No separate payment processing, listing or setup fee: the referral fee "encompasses all TikTok
 *    Shop fees, with the exception of shipping and tax fees".
 *  - Seller-chosen costs: creator (affiliate) commission (1%–80%, on the item price), Smart Promotion
 *    (3.5% of shop GMV, +1.0–2.0 points in campaign periods), campaign service fee (rate × item price
 *    after seller discount + buyer-paid shipping), ad spend.
 *  - Sales tax on the referral fee for sellers registered in Texas or West Virginia (since 2025-11-01;
 *    TikTok doesn't publish the rate, the seller enters it).
 *  - Seller LIVE Auction reduced referral fee (4% / 3%) from 2026-10-01 to 2026-12-31 23:59 PT,
 *    switched on the date in `auctionReductionActive()`. The 3% rate is for high-value orders only:
 *    "$1,500 for Jewelry and $500 for other categories" (compared here with the item price after
 *    the seller's discount, i.e. the winning bid; TikTok doesn't say whether shipping counts).
 * TikTok doesn't publish a rounding rule; its worked examples are to the cent, so each line is
 * rounded half away from zero separately.
 */
import { M } from "../markets";
import { assemble, bool, costLines, formatRate, moneyFor, num, pct, roundCents, str, toCents } from "../money";
import type { CalculatorDef, FeeChange, Inputs, Line, Market, ScheduleRow, SelectOption, Source } from "../types";

const MARKETS: Market[] = [M.us];

/** $10,000.00: Pre-Owned and Collectibles pay 3% on the portion of the sale above this. */
export const TIER_EDGE = 1_000_000;
/** Refund administration fee: 20% of the refunded referral fee, at most $5 per SKU per refund (since 2025-05-15). */
export const REFUND_ADMIN_RATE = 20;
export const REFUND_ADMIN_CAP = 500;

interface Category {
  id: string;
  label: string;
  group: string;
  rate: number;
  /** Rate on the portion of the sale over $10,000. */
  over10k?: number;
}

const G6 = "6% categories";
const GJ = "Jewelry Accessories & Derivatives";
const GC = "Collectibles";
const GP = "Pre-Owned";

/** "TikTok Shop Referral Fees in 2024 by Category" (revised 2026-10-08), Level 1 + Level 2 categories. */
const CATEGORIES: Category[] = [
  { id: "standard", label: "Most categories", group: G6, rate: 6 },
  ...[
    "Automotive & Motorcycle",
    "Baby & Maternity",
    "Beauty & Personal Care",
    "Books, Magazines & Audio",
    "Computers & Office Equipment",
    "Fashion Accessories",
    "Food & Beverages",
    "Furniture",
    "Health",
    "Home Improvement",
    "Home Supplies",
    "Household Appliances",
    "Kids' Fashion",
    "Kitchenware",
    "Luggage & Bags",
    "Menswear & Underwear",
    "Pet Supplies",
    "Phones & Electronics",
    "Shoes",
    "Sports & Outdoor",
    "Textiles & Soft Furnishings",
    "Tools & Hardware",
    "Toys & Hobbies",
    "Womenswear & Underwear",
  ].map((label) => ({ id: slugify(label), label, group: G6, rate: 6 })),
  { id: "jewelry-diamond", label: "Jewelry: Diamond", group: GJ, rate: 5 },
  { id: "jewelry-gold", label: "Jewelry: Gold", group: GJ, rate: 5 },
  { id: "jewelry-jade", label: "Jewelry: Jade", group: GJ, rate: 5 },
  { id: "jewelry-platinum", label: "Jewelry: Platinum, Carat Gold", group: GJ, rate: 5 },
  { id: "jewelry-ruby", label: "Jewelry: Ruby, Sapphire & Emerald", group: GJ, rate: 5 },
  { id: "jewelry-other", label: "Jewelry: Silver, Pearl, Amber, Crystal & other stones", group: GJ, rate: 6 },
  ...["Cultural Items", "Entertainment", "Sports Collectibles", "Trading Cards & Accessories"].map((label) => ({
    id: `collectibles-${slugify(label)}`,
    label: `Collectibles: ${label}`,
    group: GC,
    rate: 6,
    over10k: 3,
  })),
  ...[
    "Bags",
    "Collectible Trading Cards",
    "Luggage & Travel",
    "Watches",
    "Footwear",
    "Refurbished Phones & Electronics",
    "Fashion Accessories",
    "Menswear",
    "Womenswear",
    "Collectible Coins and Paper Money",
    "Collectible Figures",
    "Collectible Comic Books",
  ].map((label) => ({ id: `preowned-${slugify(label)}`, label: `Pre-Owned: ${label}`, group: GP, rate: 5, over10k: 3 })),
];

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const CATEGORY_BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));
const DEFAULT_CATEGORY = "standard";

export function categoryOf(id: string): Category {
  return CATEGORY_BY_ID.get(id) ?? CATEGORY_BY_ID.get(DEFAULT_CATEGORY)!;
}

/** Seller LIVE Auction referral fee reduction: October 1, 2026 00:00 PT (PDT) to December 31, 2026 23:59 PT (PST). */
export function auctionReductionActive(at: number = Date.now()): boolean {
  const start = Date.UTC(2026, 9, 1, 7, 0); // 00:00 PDT
  const end = Date.UTC(2027, 0, 1, 8, 0); // 24:00 PST on Dec 31
  return at >= start && at < end;
}

const AUCTION_RATE: Record<string, number> = { new: 4, highvalue: 3 };

/** High-value threshold for the 3% existing-seller auction rate: $1,500 for jewelry, $500 for other categories. */
export function highValueThreshold(cat: Category): number {
  return cat.group === GJ ? 150_000 : 50_000;
}

/**
 * Referral fee on a base (cents) for a rate, with the 3% rate on the portion over $10,000 for
 * Pre-Owned and Collectibles. One rounding for the whole line.
 */
export function referralFee(base: number, rate: number, over10k?: number): number {
  if (over10k === undefined || base <= TIER_EDGE) return pct(base, rate);
  return roundCents((TIER_EDGE * rate + (base - TIER_EDGE) * Math.min(over10k, rate)) / 100);
}

/** Refund administration fee for one SKU: 20% of the referral fee on the refunded amount, capped at $5. */
export function refundAdminFee(refundedReferralFee: number): number {
  return Math.min(REFUND_ADMIN_CAP, pct(refundedReferralFee, REFUND_ADMIN_RATE));
}

const S = {
  referral: "tts-referral-updates",
  category: "tts-referral-category",
  home: "tts-seller-home",
  feeTax: "tts-fee-sales-tax",
  sp: "tts-smart-promotion",
  affiliate: "tts-affiliate-setup",
  commission: "tts-affiliate-commission",
  campaign: "tts-campaign-fee",
  auction: "tts-live-auction",
  gmvMax: "tts-gmv-max",
  returns: "tts-returns",
  chargeback: "tts-chargeback",
  texas: "texas-sales-tax",
  wv: "wv-sales-tax",
} as const;

const academy = (id: string) => `https://seller-us.tiktok.com/university/essay?knowledge_id=${id}`;

const sources: Source[] = [
  { id: S.referral, title: "TikTok Shop Referral Fee Updates - 2024", url: academy("5982454398175018"), publisher: "TikTok Shop US Academy", checked: "2026-10-23" },
  { id: S.category, title: "TikTok Shop Referral Fees in 2024 by Category", url: academy("5988482086864682"), publisher: "TikTok Shop US Academy", checked: "2026-10-23" },
  { id: S.home, title: "TikTok Shop US | Sell Through Content, Creators, and LIVE", url: "https://seller.tiktok.com/", publisher: "TikTok Shop", checked: "2026-10-23" },
  { id: S.feeTax, title: "Sales Tax on Referral Fees — Effective November 1, 2025", url: academy("1017269682849550"), publisher: "TikTok Shop US Academy", checked: "2026-10-23" },
  { id: S.sp, title: "US Smart Promotion Introduction / FAQ", url: academy("4827354015483691"), publisher: "TikTok Shop US Academy", checked: "2026-10-23" },
  { id: S.affiliate, title: "Setting Up Affiliate Collaborations", url: academy("6837873164896001"), publisher: "TikTok Shop US Academy", checked: "2026-10-23" },
  { id: S.commission, title: "How Standard Affiliate Commission Works", url: academy("6077860360177451"), publisher: "TikTok Shop US Academy", checked: "2026-10-23" },
  { id: S.campaign, title: "Campaign service fees", url: academy("3460256793495310"), publisher: "TikTok Shop US Academy", checked: "2026-10-23" },
  { id: S.auction, title: "26Q4 Seller LIVE Auction Referral Fee Reduction Policy", url: academy("6219480922474258"), publisher: "TikTok Shop US Academy", checked: "2026-10-23" },
  { id: S.gmvMax, title: "Commission Saving via GMV Max", url: academy("1007832535975694"), publisher: "TikTok Shop US Academy", checked: "2026-10-23" },
  { id: S.returns, title: "Customer Order Cancellation, Return, and Refund Policy", url: academy("3253210454181634"), publisher: "TikTok Shop US Academy", checked: "2026-10-23" },
  { id: S.chargeback, title: "Chargeback Policy", url: academy("7989055607670570"), publisher: "TikTok Shop US Academy", checked: "2026-10-23" },
  { id: S.texas, title: "Sales and Use Tax", url: "https://comptroller.texas.gov/taxes/sales/", publisher: "Texas Comptroller of Public Accounts", checked: "2026-10-23" },
  { id: S.wv, title: "Sales and Use Tax", url: "https://tax.wv.gov/Business/SalesAndUseTax/Pages/SalesAndUseTax.aspx", publisher: "West Virginia Tax Division", checked: "2026-10-23" },
];

const changes: FeeChange[] = [
  {
    date: "2027-01-01",
    text: "The Seller LIVE Auction reduced referral fees (4% and 3%) end after December 31, 2026, 11:59 p.m. PT. Auction orders go back to the category’s standard 5% or 6%.",
    source: S.auction,
    upcoming: true,
  },
  {
    date: "2026-10-01",
    text: "Seller LIVE Auction orders with a $1 starting bid: referral fee cut from the standard 5%–6% to 4% for eligible new auction sellers, and to 3% on high-value orders in 7 categories for eligible existing auction sellers (up to $400K of auction sales per week).",
    source: S.auction,
  },
  {
    date: "2026-03-03",
    text: "Most sellers moved from Co-funded Promotion to Smart Promotion: a fixed 3.5% of shop GMV, 1.0–2.0 points more during campaign periods. From April 2026 it is required to join platform campaigns, Flash Sales, Premium Offers and Weekly Promos.",
    source: S.sp,
  },
  { date: "2025-11-01", text: "Sellers whose business is registered in Texas or West Virginia now pay state sales tax on their referral fees.", source: S.feeTax },
  { date: "2025-05-15", text: "Refund administration fee (20% of the refunded referral fee) went from uncapped to a maximum of $5 per SKU per refund.", source: S.referral },
  { date: "2024-10-31", text: "Referral fee for five jewelry sub-categories (Diamond, Gold, Jade, Platinum & Carat Gold, Ruby/Sapphire & Emerald) cut from 6% to 5%.", source: S.category },
  { date: "2024-04-01", text: "Referral fee raised to 6% per order on all qualified orders. It covers every TikTok Shop fee except shipping and tax.", source: S.referral },
];

const SMART_PROMO = new Set(["3.5", "4.5", "5.5"]);

function clampPct(v: number, max: number): number {
  return Math.min(max, Math.max(0, v));
}

function calculate(inputs: Inputs, market: Market) {
  const money = moneyFor(market);
  const qty = Math.max(1, Math.round(num(inputs, "quantity", 1)));
  const unit = toCents(num(inputs, "price"));
  const itemsGross = unit * qty;
  const sellerDiscount = pct(itemsGross, clampPct(num(inputs, "sellerDiscount"), 100));
  const items = itemsGross - sellerDiscount;
  const shipping = toCents(num(inputs, "shippingCharged"));
  // Customer Payment + Platform Discount − Tax = item price after the seller's discounts + buyer-paid shipping.
  const base = items + shipping;
  const platformDiscount = Math.min(toCents(num(inputs, "platformDiscount")), base);
  const paidBeforeTax = base - platformDiscount;
  const tax = pct(paidBeforeTax, clampPct(num(inputs, "salesTax"), 20));
  const customerPayment = paidBeforeTax + tax;

  const cat = categoryOf(str(inputs, "category", DEFAULT_CATEGORY));
  const auction = str(inputs, "auction", "no");
  const auctionAsked = auction in AUCTION_RATE;
  const auctionLive = auctionAsked && auctionReductionActive();
  // The 3% existing-seller rate needs a high-value order ($1,500 jewelry / $500 other categories).
  const belowHighValue = auctionLive && auction === "highvalue" && items < highValueThreshold(cat);
  const auctionOn = auctionLive && !belowHighValue;
  // The auction rate replaces the category's headline rate; the 3% band above $10,000 still applies.
  const rate = auctionOn ? AUCTION_RATE[auction] : cat.rate;
  const tiered = cat.over10k !== undefined && base > TIER_EDGE;
  const referral = referralFee(base, rate, cat.over10k);

  const fees: Line[] = [];
  const parts = [`${money(items)} item${qty > 1 ? "s" : ""}`];
  if (shipping) parts.push(`${money(shipping)} shipping`);
  const notes0 = parts.length > 1 ? [parts.join(" + ")] : [];
  if (platformDiscount) notes0.push(`incl. the ${money(platformDiscount)} TikTok coupon`);
  const baseText = notes0.length ? ` (${notes0.join("; ")})` : "";
  const over = cat.over10k !== undefined ? Math.min(cat.over10k, rate) : 0;
  fees.push({
    id: "referral",
    label: "Referral fee",
    amount: referral,
    kind: "platform",
    detail: tiered ? `${formatRate(rate)} × ${money(TIER_EDGE)} + ${formatRate(over)} × ${money(base - TIER_EDGE)}` : `${formatRate(rate)} × ${money(base)}${baseText}`,
    explain: [
      auctionOn
        ? `${formatRate(rate)} for this $1-start Seller LIVE Auction order (reduced rate until December 31, 2026 PT), on the item price after your own discounts plus the shipping the buyer pays.`
        : `${formatRate(cat.rate)} of the item price after your own discounts plus the shipping the buyer pays. Coupons TikTok pays for are added back, so they don’t lower it; sales tax is left out.`,
      cat.over10k !== undefined ? `${cat.group} items pay ${formatRate(over)} on the part of the sale over $10,000.` : "",
    ]
      .filter(Boolean)
      .join(" "),
    source: auctionOn ? S.auction : S.category,
  });
  fees.push({
    id: "processing",
    label: "Payment processing",
    amount: 0,
    kind: "payment",
    detail: "Included in the referral fee",
    explain: "TikTok Shop doesn’t charge a separate card processing fee: the referral fee covers all TikTok Shop fees except shipping and tax.",
    source: S.referral,
  });

  if (bool(inputs, "feeTax")) {
    const r = clampPct(num(inputs, "feeTaxRate"), 20);
    fees.push({
      id: "feetax",
      label: "Sales tax on referral fee",
      amount: pct(referral, r),
      kind: "tax",
      detail: `${formatRate(r)} × ${money(referral)}`,
      explain:
        "Since November 1, 2025, TikTok adds state sales tax to the referral fee for sellers whose business is registered in Texas or West Virginia. Your settlement report and monthly invoice show the exact amount.",
      source: S.feeTax,
    });
  }

  const aff = clampPct(num(inputs, "affiliate"), 80);
  if (aff > 0) {
    fees.push({
      id: "affiliate",
      label: "Affiliate commission",
      amount: pct(items, aff),
      kind: "ads",
      detail: `${formatRate(aff)} × ${money(items)}`,
      explain:
        "Paid to the creator whose video, LIVE or showcase made the sale, at the rate you set (1%–80%). TikTok works it out as (revenue − refunds) × your rate; we apply it to the item price after your own discount, without shipping or tax.",
      source: S.commission,
    });
  }

  const sp = str(inputs, "smartPromo", "none");
  if (SMART_PROMO.has(sp)) {
    const r = Number(sp);
    fees.push({
      id: "smartpromo",
      label: "Smart Promotion fee",
      amount: pct(base, r),
      kind: "ads",
      detail: `${formatRate(r)} × ${money(base)}`,
      explain: `${r === 3.5 ? "3.5% of your shop’s sales outside campaign periods" : `${formatRate(r)}: the 3.5% rate plus ${formatRate(r - 3.5)} during a TikTok campaign period`}, charged only if you’ve joined Smart Promotion. TikTok doesn’t define the GMV it’s charged on in more detail, so we apply it to the same amount as the referral fee.`,
      source: S.sp,
    });
  }

  const camp = clampPct(num(inputs, "campaignFee"), 20);
  if (camp > 0) {
    fees.push({
      id: "campaign",
      label: "Campaign service fee",
      amount: pct(base, camp),
      kind: "ads",
      detail: `${formatRate(camp)} × ${money(base)}`,
      explain:
        "Charged once per order on products you registered in a Standard Registration or Flash Sale campaign that lists a fee: the campaign’s rate × (campaign price after your discount + shipping the buyer pays). TikTok-funded discounts don’t count.",
      source: S.campaign,
    });
  }

  const ad = toCents(num(inputs, "adCost"));
  if (ad) {
    fees.push({ id: "ads", label: "Ad spend", amount: ad, kind: "ads", detail: "Your ad cost per order", explain: "What your TikTok ads (such as GMV Max) cost you per order, on average. Entered by you." });
  }

  const notes: string[] = [];
  if (auctionAsked && !auctionLive) notes.push("The LIVE auction reduced referral fee only runs from October 1 to December 31, 2026 (PT), so the standard rate is used.");
  if (belowHighValue)
    notes.push(
      `TikTok’s 3% auction rate only applies to high-value orders: ${money(highValueThreshold(cat))} or more in ${cat.group === GJ ? "jewelry" : "this category"}. Below that the standard ${formatRate(cat.rate)} applies.`,
    );
  if (camp > 0 && SMART_PROMO.has(sp))
    notes.push("TikTok’s Smart Promotion page says enrolled sellers pay no additional fee to join platform campaigns, Flash Sales and Premium Offers. Check the campaign’s Fee Policy before counting both.");
  notes.push(
    `If the buyer gets a full refund, TikTok gives back the referral fee minus a 20% refund administration fee: ${money(refundAdminFee(referral))} on this order (never more than $5 per SKU).`,
  );
  if (aff === 0 && notes.length < 2) notes.push("Sold through a creator’s video or LIVE? Add their commission above: it comes out of your payout on top of the referral fee.");

  return assemble({
    market,
    buyerPays: customerPayment,
    saleAmount: base,
    fees,
    costs: costLines(inputs, market),
    notes,
  });
}

function schedule(market: Market): ScheduleRow[] {
  void market;
  const rows: ScheduleRow[] = [
    { fee: "Referral fee", amount: "6%", appliesTo: "Item price after your discounts + shipping the buyer pays (TikTok-funded coupons included, sales tax excluded)", when: "Every completed order, most categories", source: S.category },
    { fee: "Referral fee: fine jewelry", amount: "5%", appliesTo: "Same base", when: "Diamond, Gold, Jade, Platinum & Carat Gold, Ruby/Sapphire & Emerald", source: S.category },
    { fee: "Referral fee: Pre-Owned", amount: "5%; 3% on the part over $10,000", appliesTo: "Same base", when: "12 Pre-Owned categories (bags, watches, trading cards…)", source: S.category },
    { fee: "Referral fee: Collectibles", amount: "6%; 3% on the part over $10,000", appliesTo: "Same base", when: "Cultural items, entertainment, sports collectibles, trading cards", source: S.category },
  ];
  if (auctionReductionActive()) {
    rows.push({ fee: "LIVE auction referral fee", amount: "4% new auction sellers / 3% high-value orders", appliesTo: "Same base", when: "$1-start Seller LIVE Auction orders until Dec 31, 2026 (PT); 3% from $500 ($1,500 jewelry) in 7 categories", source: S.auction });
  }
  rows.push(
    { fee: "Payment processing", amount: "Included", appliesTo: "Covered by the referral fee", when: "No separate charge", source: S.referral },
    { fee: "Setup fee", amount: "$0", appliesTo: "—", when: "Opening a shop; no listing or monthly fee either", source: S.home },
    { fee: "Refund administration fee", amount: "20%, max $5 per SKU", appliesTo: "The referral fee TikTok refunds", when: "Refunds, returns and cancellations", source: S.referral },
    { fee: "Affiliate commission", amount: "1%–80% (you set it)", appliesTo: "Item revenue minus refunds", when: "Sales through a creator’s video, LIVE or showcase", source: S.affiliate },
    { fee: "Smart Promotion", amount: "3.5%; +1.0–2.0 points in campaigns", appliesTo: "Your shop’s GMV", when: "If you join (required for platform campaigns)", source: S.sp },
    { fee: "Campaign service fee", amount: "Set per campaign", appliesTo: "Campaign price after your discount + shipping the buyer pays", when: "Products registered in a campaign whose Fee Policy lists one (not for Smart Promotion members in platform campaigns)", source: S.campaign },
    { fee: "Sales tax on referral fee", amount: "Your state’s rate", appliesTo: "Referral fee", when: "Business registered in Texas or West Virginia", source: S.feeTax },
    { fee: "Chargeback appeal", amount: "$10 per chargeback", appliesTo: "—", when: "When you appeal a chargeback (not auto-contested ones)", source: S.chargeback },
  );
  return rows;
}

const categoryOptions: SelectOption[] = CATEGORIES.map((c) => ({
  value: c.id,
  label: c.label,
  group: c.group,
  hint: c.over10k !== undefined ? `${formatRate(c.rate)} · ${formatRate(c.over10k)} over $10K` : formatRate(c.rate),
}));

export const tiktokShop: CalculatorDef = {
  slug: "tiktok-shop",
  name: "TikTok Shop",
  path: "/tiktok-shop-fee-calculator",
  category: "marketplaces",
  priceNoun: "item price",
  sellerNoun: "seller",
  blurb: "6% referral fee on item + shipping, processing included (US)",
  markets: MARKETS,
  defaultMarket: "us",
  priceField: "price",
  fields: [
    { id: "price", kind: "money", label: "Item price", section: "sale", help: "Your selling price per item. Put a discount you fund under “More options”." },
    {
      id: "category",
      kind: "select",
      label: "Category",
      section: "sale",
      searchable: true,
      options: categoryOptions,
      help: "6% almost everywhere. Five fine jewelry types and all Pre-Owned items pay 5%.",
    },
    { id: "quantity", kind: "number", label: "Items in the order", section: "sale", integer: true, min: 1, max: 999, advanced: true },
    { id: "sellerDiscount", kind: "percent", label: "Discount or coupon you pay for", section: "sale", advanced: true, max: 100, help: "Your own discounts lower the referral fee." },
    { id: "platformDiscount", kind: "money", label: "Coupon TikTok pays for", section: "sale", advanced: true, help: "TikTok pays you this back, and still charges its fee on it." },
    { id: "salesTax", kind: "percent", label: "Buyer’s sales tax rate", section: "sale", advanced: true, max: 20, help: "Left out of TikTok’s fee; it only changes what the buyer pays." },
    { id: "shippingCharged", kind: "money", label: "Shipping the buyer pays", section: "shipping", help: "TikTok takes its fee on this too. Enter 0 if you offer free shipping." },
    { id: "affiliate", kind: "percent", label: "Creator commission", section: "options", max: 80, help: "If a creator’s video or LIVE made the sale: the rate you set them (1%–80%)." },
    {
      id: "smartPromo",
      kind: "segmented",
      label: "Have you joined Smart Promotion?",
      section: "options",
      options: [
        { value: "none", label: "No" },
        { value: "3.5", label: "Yes · 3.5%" },
        { value: "4.5", label: "Campaign · 4.5%" },
        { value: "5.5", label: "Campaign · 5.5%" },
      ],
      help: "A fixed fee on your shop’s sales; 1–2 points more during TikTok’s campaign periods.",
    },
    { id: "campaignFee", kind: "percent", label: "Campaign service fee", section: "options", advanced: true, max: 20, step: 0.1, help: "Only if a campaign you registered for lists a fee in its Fee Policy. Smart Promotion members pay none for platform campaigns and Flash Sales." },
    {
      id: "auction",
      kind: "segmented",
      label: "Sold in a $1-start Seller LIVE Auction?",
      section: "options",
      advanced: true,
      options: [
        { value: "no", label: "No" },
        { value: "new", label: "New auction seller · 4%" },
        { value: "highvalue", label: "High-value order · 3%" },
      ],
      help: "Automatic for eligible sellers through Dec 31, 2026 (PT). 3%: existing auction sellers, orders from $500 ($1,500 jewelry) in 7 categories.",
    },
    { id: "adCost", kind: "money", label: "Ad cost per order", section: "options", advanced: true, help: "Optional: what your TikTok ads cost you per order, on average." },
    { id: "feeTax", kind: "toggle", label: "My business is registered in Texas or West Virginia", section: "options", advanced: true, help: "TikTok adds state sales tax to your referral fee." },
    {
      id: "feeTaxRate",
      kind: "percent",
      label: "Sales tax rate on the fee",
      section: "options",
      advanced: true,
      max: 20,
      step: 0.01,
      help: "TikTok doesn’t publish it. State rates: Texas 6.25%, West Virginia 6%; local tax can add more. Your invoice shows the exact rate.",
      showIf: (i) => bool(i, "feeTax"),
    },
    { id: "itemCost", kind: "money", label: "What the item cost you", section: "costs", help: "What you paid for it, or materials." },
    { id: "shippingCost", kind: "money", label: "Shipping label or FBT fee you pay", section: "costs", help: "With TikTok Shipping or FBT this comes out of your settlement." },
    { id: "otherCost", kind: "money", label: "Packaging & other", section: "costs" },
  ],
  defaults: () => ({
    price: 25,
    category: DEFAULT_CATEGORY,
    quantity: 1,
    sellerDiscount: 0,
    platformDiscount: 0,
    salesTax: 0,
    shippingCharged: 5,
    affiliate: 0,
    smartPromo: "none",
    campaignFee: 0,
    auction: "no",
    adCost: 0,
    feeTax: false,
    feeTaxRate: 6.25,
    itemCost: 0,
    shippingCost: 0,
    otherCost: 0,
  }),
  calculate,
  breakpoints: (inputs) => {
    const cat = categoryOf(str(inputs, "category", DEFAULT_CATEGORY));
    const qty = Math.max(1, Math.round(num(inputs, "quantity", 1)));
    const keep = 1 - clampPct(num(inputs, "sellerDiscount"), 100) / 100;
    if (keep <= 0) return [];
    const out: number[] = [];
    // Pre-Owned and Collectibles drop to 3% above a $10,000 sale: the price where item + shipping reaches it.
    if (cat.over10k !== undefined) {
      const itemsNeeded = TIER_EDGE - toCents(num(inputs, "shippingCharged"));
      if (itemsNeeded > 0) out.push(Math.ceil(itemsNeeded / (qty * keep)));
    }
    // The 3% high-value LIVE auction rate starts at $500 ($1,500 jewelry) of item price.
    if (str(inputs, "auction", "no") === "highvalue" && auctionReductionActive()) out.push(Math.ceil(highValueThreshold(cat) / (qty * keep)));
    return out;
  },
  verifiedAt: "2026-10-23",
  sources,
  changes,
  schedule,
  compare: {
    group: "sell",
    map: (c) => ({ price: c.price, shippingCharged: c.shipping, itemCost: c.itemCost, shippingCost: c.shippingCost }),
    note: "Most categories, no creator commission or Smart Promotion",
  },
};

export default tiktokShop;
