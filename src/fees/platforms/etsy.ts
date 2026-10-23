/*
 * Etsy seller fees. Every number is from Etsy's own pages (see `sources`), verified 2026-10-23.
 * Research notes with verbatim quotes: research/fees/etsy.md.
 *
 * How a statement line is computed (what this module reproduces):
 *  - Transaction fee 6.5% of item price (after discounts, incl. personalization) and, as a separate
 *    statement line, 6.5% of shipping + gift wrap. US sellers: not charged on sales tax; sellers
 *    elsewhere: the listing price already includes their VAT.
 *  - Payment processing: country rate × gross order (items + shipping + gift wrap + tax) + a fixed
 *    fee per order. Canada / Australia / New Zealand pay 3% domestically, 4% internationally
 *    (Canadian shops: orders from the US count as domestic).
 *  - Regulatory operating fee (some countries): rate × items + shipping + gift wrap, excl. tax.
 *  - Offsite Ads: 15% or 12% of the same base, capped at US$100 per order.
 *  - Listing fee US$0.20 per item sold (the auto-renewal / multi-quantity charge), converted.
 *  - VAT/GST on Etsy's fees for sellers without a VAT ID on file (local standard rate).
 * Each line is rounded to the cent separately (Etsy lists them separately on the statement).
 */
import { M } from "../markets";
import { assemble, bool, costLines, formatRate, moneyFor, num, pct, str, toCents } from "../money";
import { fromUsd, FX_DATE } from "../fx";
import type { CalculatorDef, FeeChange, Inputs, Line, Market, ScheduleRow, Source } from "../types";

const MARKETS: Market[] = [M.us, M.uk, M.ca, M.au, M.nz, M.de, M.fr, M.it, M.es, M.nl, M.ie, M.in];

interface Processing {
  rate: number;
  /** Rate for international orders where Etsy charges a different one (CA, AU, NZ). */
  intlRate?: number;
  /** Fixed fee per order in the market's currency, cents. */
  fixed: number;
  note?: string;
}

/** Etsy Payments processing by the country of the seller's bank account (Etsy Payments Policy §9.B). */
const PROCESSING: Record<string, Processing> = {
  us: { rate: 3, fixed: 25 },
  uk: { rate: 4, fixed: 20 },
  ca: { rate: 3, intlRate: 4, fixed: 25 },
  au: { rate: 3, intlRate: 4, fixed: 25 },
  nz: { rate: 3, intlRate: 4, fixed: 30 },
  de: { rate: 4, fixed: 30 },
  fr: { rate: 4, fixed: 30 },
  it: { rate: 4, fixed: 30 },
  es: { rate: 4, fixed: 30 },
  nl: { rate: 4, fixed: 30 },
  ie: { rate: 4, fixed: 30 },
  // India: 5% + ₹25, paid out in USD to Payoneer (Payoneer's own withdrawal fees come on top).
  in: { rate: 5, fixed: 2500, note: "Indian shops are paid out in US dollars through Payoneer, which charges its own withdrawal and conversion fees (Etsy says typically up to 3%)." },
};

/** Regulatory operating fee by seller country (help article 1500011073202, edited 2026-06-22). */
const ROF: Record<string, number> = { uk: 0.48, ca: 0.5, fr: 1.14, it: 0.8, es: 0.88, in: 0.05 };

/** Standard VAT/GST rate added to Etsy's fees for sellers without a VAT ID (from each country's tax law; Etsy doesn't publish the rate). */
const VAT_ON_FEES: Record<string, { rate: number; always?: boolean; name: string }> = {
  uk: { rate: 20, name: "VAT" },
  de: { rate: 19, name: "VAT" },
  fr: { rate: 20, name: "VAT" },
  it: { rate: 22, name: "VAT" },
  es: { rate: 21, name: "VAT" },
  nl: { rate: 21, name: "VAT" },
  ie: { rate: 23, name: "VAT", always: true },
  au: { rate: 10, name: "GST" },
  nz: { rate: 15, name: "GST" },
  in: { rate: 18, name: "GST" },
};

/** Share & Save refund: 6.5% from 2026-10-20 09:00 ET through 2027-01-04 09:00 ET, otherwise 4%. */
export function shareSaveRate(at: number = Date.now()): number {
  const start = Date.UTC(2026, 9, 20, 13, 0); // 09:00 EDT
  const end = Date.UTC(2027, 0, 4, 14, 0); // 09:00 EST
  return at >= start && at < end ? 6.5 : 4;
}

const S = {
  fees: "etsy-fees",
  payments: "etsy-payments",
  processing: "etsy-processing",
  rof: "etsy-rof",
  offsite: "etsy-offsite",
  multi: "etsy-multi",
  vat: "etsy-vat",
  texas: "etsy-texas",
  share: "etsy-share-save",
  shareHoliday: "etsy-share-holiday",
  fx: "etsy-fx",
  rofNews: "etsy-rof-announcement",
} as const;

const sources: Source[] = [
  { id: S.fees, title: "Fees & Payments Policy", url: "https://www.etsy.com/legal/fees", publisher: "Etsy", checked: "2026-10-23" },
  { id: S.payments, title: "Etsy Payments Policy", url: "https://www.etsy.com/legal/etsy-payments", publisher: "Etsy", checked: "2026-10-23" },
  {
    id: S.processing,
    title: "What are Payment Processing Fees for Selling on Etsy?",
    url: "https://help.etsy.com/hc/en-us/articles/115015628847",
    publisher: "Etsy Help",
    checked: "2026-10-23",
    watch: "https://help.etsy.com/api/v2/help_center/en-us/articles/115015628847.json",
  },
  {
    id: S.rof,
    title: "What is a Regulatory Operating Fee?",
    url: "https://help.etsy.com/hc/en-us/articles/1500011073202",
    publisher: "Etsy Help",
    checked: "2026-10-23",
    watch: "https://help.etsy.com/api/v2/help_center/en-us/articles/1500011073202.json",
  },
  {
    id: S.offsite,
    title: "How Etsy's Offsite Ads Work",
    url: "https://help.etsy.com/hc/en-us/articles/360000338367",
    publisher: "Etsy Help",
    checked: "2026-10-23",
    watch: "https://help.etsy.com/api/v2/help_center/en-us/articles/360000338367.json",
  },
  {
    id: S.multi,
    title: "Fees and Listing Multiple Quantities",
    url: "https://help.etsy.com/hc/en-us/articles/360000344908",
    publisher: "Etsy Help",
    checked: "2026-10-23",
    watch: "https://help.etsy.com/api/v2/help_center/en-us/articles/360000344908.json",
  },
  {
    id: S.vat,
    title: "How VAT Is Collected on Seller Fees",
    url: "https://help.etsy.com/hc/en-us/articles/360040584433",
    publisher: "Etsy Help",
    checked: "2026-10-23",
    watch: "https://help.etsy.com/api/v2/help_center/en-us/articles/360040584433.json",
  },
  {
    id: S.texas,
    title: "What are Sales and Use Taxes on Seller Fees in Texas?",
    url: "https://help.etsy.com/hc/en-us/articles/35267490737431",
    publisher: "Etsy Help",
    checked: "2026-10-23",
    watch: "https://help.etsy.com/api/v2/help_center/en-us/articles/35267490737431.json",
  },
  {
    id: S.share,
    title: "How to Save on Etsy Fees with the Share & Save Program",
    url: "https://help.etsy.com/hc/en-us/articles/16981332744087",
    publisher: "Etsy Help",
    checked: "2026-10-23",
    watch: "https://help.etsy.com/api/v2/help_center/en-us/articles/16981332744087.json",
  },
  { id: S.shareHoliday, title: "Share & Save Holiday Promo Terms", url: "https://www.etsy.com/legal/policy/share-save-holiday-promo-terms/1518738546775", publisher: "Etsy", checked: "2026-10-23" },
  {
    id: S.fx,
    title: "Currency Conversion Fees",
    url: "https://help.etsy.com/hc/en-us/articles/360000344668",
    publisher: "Etsy Help",
    checked: "2026-10-23",
    watch: "https://help.etsy.com/api/v2/help_center/en-us/articles/360000344668.json",
  },
  {
    id: S.rofNews,
    title: "Regulatory Operating Fee updates for some markets",
    url: "https://community.etsy.com/forum/announcements-290/topic/regulatory-operating-fee-updates-for-some-markets-181930/",
    publisher: "Etsy Community (official announcement)",
    checked: "2026-10-23",
  },
];

const changes: FeeChange[] = [
  { date: "2027-01-04", text: "Share & Save refund returns from 6.5% to 4% of the order (holiday promotion ends at 9:00 a.m. ET).", source: S.shareHoliday, upcoming: true },
  { date: "2026-10-20", text: "Share & Save holiday promotion: sales through your own share link get 6.5% back instead of 4%, which cancels the transaction fee.", source: S.shareHoliday },
  {
    date: "2026-06-22",
    text: "Regulatory operating fees changed: UK 0.32% → 0.48%, France 0.47% → 1.14%, Italy 0.32% → 0.80%, Spain 0.72% → 0.88%, India 0.29% → 0.05%, Türkiye 2.27% → 1.67%, and a new 1.97% fee in Hungary. Canada’s is now 0.50% (was 1.15%).",
    source: S.rofNews,
  },
  { date: "2025-10-01", text: "Texas sellers: 6.25% Texas sales tax is charged on 80% of Etsy transaction fees.", source: S.texas },
  { date: "2022-04-11", text: "Transaction fee raised from 5% to 6.5% of the item price, shipping and gift wrap.", source: S.fees },
];

function calculate(inputs: Inputs, market: Market) {
  const money = moneyFor(market);
  const us = market.id === "us";
  const qty = Math.max(1, Math.round(num(inputs, "quantity", 1)));
  const unit = toCents(num(inputs, "price"));
  const discountPct = Math.min(100, Math.max(0, num(inputs, "discount")));
  const itemsGross = unit * qty;
  const discount = pct(itemsGross, discountPct);
  const items = itemsGross - discount;
  const shipping = toCents(num(inputs, "shippingCharged"));
  const giftWrap = toCents(num(inputs, "giftWrap"));
  const orderBase = items + shipping + giftWrap; // transaction fee / ROF / ads base
  const taxRate = us ? Math.max(0, num(inputs, "salesTax")) : 0;
  const tax = pct(orderBase, taxRate);
  const gross = orderBase + tax; // processing base

  const fees: Line[] = [];
  const listingEach = fromUsd(20, market.currency);
  fees.push({
    id: "listing",
    label: "Listing fee",
    amount: listingEach * qty,
    kind: "platform",
    detail: `${us ? "$0.20" : `US$0.20 ≈ ${money(listingEach)}`} × ${qty} item${qty > 1 ? "s" : ""}`,
    explain:
      "US$0.20 per item sold: a listing renews automatically (and is charged again) when an item sells with stock left, and each extra unit in one order costs another US$0.20. Charged in US dollars and converted at the day’s rate.",
    source: S.multi,
  });
  fees.push({
    id: "transaction",
    label: "Transaction fee",
    amount: pct(items, 6.5),
    kind: "platform",
    detail: `6.5% × ${money(items)}`,
    explain: us
      ? "6.5% of the item price after any discount, including personalization. Not charged on sales tax."
      : "6.5% of the item price after any discount. Outside the US your listing price includes your VAT, so the fee is charged on that.",
    source: S.fees,
  });
  if (shipping + giftWrap > 0) {
    fees.push({
      id: "transaction-shipping",
      label: "Transaction fee: shipping",
      amount: pct(shipping + giftWrap, 6.5),
      kind: "platform",
      detail: `6.5% × ${money(shipping + giftWrap)}`,
      explain: "Etsy takes the same 6.5% on what the buyer pays for shipping and gift wrap. It appears as its own line on your statement.",
      source: S.fees,
    });
  }

  const proc = PROCESSING[market.id] ?? PROCESSING.us;
  const intl = proc.intlRate !== undefined && str(inputs, "buyerRegion", "domestic") === "international";
  const procRate = intl ? proc.intlRate! : proc.rate;
  fees.push({
    id: "processing",
    label: "Payment processing",
    amount: pct(gross, procRate) + proc.fixed,
    kind: "payment",
    detail: `${formatRate(procRate)} × ${money(gross)} + ${money(proc.fixed)}`,
    explain: `Etsy Payments charges ${formatRate(procRate)} of everything the buyer pays${tax ? " (including the sales tax)" : ", including shipping and any tax,"} plus ${money(proc.fixed)} per order. The rate depends on the country of your bank account${proc.intlRate !== undefined ? ` (${formatRate(proc.rate)} for domestic orders, ${formatRate(proc.intlRate)} for international ones)` : ""}.`,
    source: S.processing,
  });

  const rof = ROF[market.id];
  if (rof) {
    fees.push({
      id: "rof",
      label: "Regulatory operating fee",
      amount: pct(orderBase, rof),
      kind: "platform",
      detail: `${formatRate(rof)} × ${money(orderBase)}`,
      explain: `A fee Etsy charges sellers based in ${market.label} for the cost of complying with local regulations. ${formatRate(rof)} of the item price, shipping and gift wrap since June 22, 2026.`,
      source: S.rof,
    });
  }

  const offsite = str(inputs, "offsiteAds", "none");
  if (offsite === "15" || offsite === "12") {
    const rate = Number(offsite);
    const raw = pct(orderBase, rate);
    const cap = fromUsd(10000, market.currency);
    const capped = raw > cap;
    fees.push({
      id: "offsite",
      label: `Offsite Ads fee (${rate}%)`,
      amount: capped ? cap : raw,
      kind: "ads",
      detail: capped ? `${rate}% would be ${money(raw)}, capped at ${us ? "$100" : `US$100 ≈ ${money(cap)}`}` : `${rate}% × ${money(orderBase)}`,
      explain:
        "Charged only when a buyer clicked one of Etsy’s ads on another site and ordered within 30 days. 15% if your shop has never made US$10,000 in a 12-month period; 12% (and no opting out) once it has. Never more than US$100 per order.",
      source: S.offsite,
    });
  }

  if (bool(inputs, "currencyConversion")) {
    fees.push({
      id: "fx",
      label: "Currency conversion",
      amount: pct(orderBase, 2.5),
      kind: "payment",
      detail: `2.5% × ${money(orderBase)}`,
      explain: "Charged when your listings are priced in a different currency from your payment account. Listing in your account’s currency avoids it.",
      source: S.fx,
    });
  }

  const adSpend = toCents(num(inputs, "etsyAds"));
  if (adSpend) {
    fees.push({ id: "etsyads", label: "Etsy Ads spend", amount: adSpend, kind: "ads", detail: "Your cost per sale from Etsy Ads", explain: "Etsy Ads are paid per click from your daily budget; enter what your ads cost you per sale on average." });
  }

  const etsyFees = fees.reduce((s, l) => s + l.amount, 0);
  const vat = VAT_ON_FEES[market.id];
  if (vat && (vat.always || bool(inputs, "vatOnFees"))) {
    fees.push({
      id: "vat",
      label: `${vat.name} on Etsy fees (${formatRate(vat.rate)})`,
      amount: pct(etsyFees, vat.rate),
      kind: "tax",
      detail: `${formatRate(vat.rate)} × ${money(etsyFees)}`,
      explain: vat.always
        ? `Etsy adds ${vat.name} to its fees for sellers in ${market.label} whether or not you have a VAT number.`
        : `Etsy adds ${vat.name} to all its fees unless you’ve added a valid ${vat.name} ID to your account. ${formatRate(vat.rate)} is ${market.label}’s standard rate; registered businesses can usually reclaim it.`,
      source: S.vat,
    });
  }

  if (us && bool(inputs, "texas")) {
    const t = fees.find((l) => l.id === "transaction")!.amount + (fees.find((l) => l.id === "transaction-shipping")?.amount ?? 0);
    fees.push({
      id: "texas",
      label: "Texas sales tax on fees",
      amount: pct(pct(t, 80), 6.25),
      kind: "tax",
      detail: `6.25% × 80% × ${money(t)}`,
      explain: "Since October 1, 2025, sellers located in Texas pay 6.25% Texas sales tax on 80% of their Etsy transaction fees.",
      source: S.texas,
    });
  }

  if (bool(inputs, "shareSave")) {
    const rate = shareSaveRate();
    fees.push({
      id: "sharesave",
      label: `Share & Save refund (${formatRate(rate)})`,
      amount: -pct(orderBase, rate),
      kind: "platform",
      detail: `−${formatRate(rate)} × ${money(orderBase)}`,
      explain:
        rate === 6.5
          ? "Sales that come through your own Share & Save link get 6.5% of the order back until January 4, 2027 (holiday promotion), then 4%."
          : "Sales that come through your own Share & Save link get 4% of the order (item, shipping and gift wrap) back as a fee credit.",
      source: S.share,
    });
  }

  const notes: string[] = [];
  if (us && !taxRate) notes.push("Processing is also charged on sales tax your buyer pays. Add their tax rate under “More options” for the exact figure.");
  if (!us) notes.push(`US-dollar amounts are converted at the ECB reference rate of ${FX_DATE}; Etsy uses the rate on the day it charges.`);
  if (proc.note) notes.push(proc.note);
  if (str(inputs, "offsiteAds", "none") === "none") notes.push("If this order comes from an Offsite Ad, add 12–15% (up to US$100). Turn it on above to price for the worst case.");

  return assemble({
    market,
    buyerPays: gross,
    saleAmount: orderBase,
    fees,
    costs: costLines(inputs, market),
    notes,
  });
}

function schedule(market: Market): ScheduleRow[] {
  const money = moneyFor(market);
  const proc = PROCESSING[market.id] ?? PROCESSING.us;
  const rows: ScheduleRow[] = [
    { fee: "Listing fee", amount: "US$0.20", appliesTo: "Each listing, each 4-month renewal, each item sold", source: S.multi },
    { fee: "Transaction fee", amount: "6.5%", appliesTo: market.id === "us" ? "Item price + shipping + gift wrap (not sales tax)" : "Item price (incl. your VAT) + shipping + gift wrap", source: S.fees },
    {
      fee: "Payment processing",
      amount: proc.intlRate !== undefined ? `${formatRate(proc.rate)} domestic / ${formatRate(proc.intlRate)} intl + ${money(proc.fixed)}` : `${formatRate(proc.rate)} + ${money(proc.fixed)}`,
      appliesTo: "Everything the buyer pays, incl. shipping and tax",
      source: S.processing,
    },
  ];
  const rof = ROF[market.id];
  if (rof) rows.push({ fee: "Regulatory operating fee", amount: formatRate(rof), appliesTo: "Item price + shipping + gift wrap", source: S.rof });
  rows.push(
    { fee: "Offsite Ads", amount: "15% or 12%, max US$100", appliesTo: "Item price + shipping + gift wrap", when: "Only orders from an Etsy ad on another site", source: S.offsite },
    { fee: "Currency conversion", amount: "2.5%", appliesTo: "The sale amount", when: "Listing currency ≠ payment account currency", source: S.fx },
  );
  const vat = VAT_ON_FEES[market.id];
  if (vat) rows.push({ fee: `${vat.name} on fees`, amount: `${formatRate(vat.rate)} (standard rate)`, appliesTo: "All Etsy fees", when: vat.always ? "Always" : "No VAT ID on your account", source: S.vat });
  if (market.id === "us") rows.push({ fee: "Texas sales tax on fees", amount: "6.25% × 80%", appliesTo: "Transaction fees", when: "Sellers located in Texas", source: S.texas });
  rows.push({ fee: "Share & Save", amount: `−${formatRate(shareSaveRate())} (credit)`, appliesTo: "Item price + shipping + gift wrap", when: "Sales through your own share link", source: S.share });
  return rows;
}

export const etsy: CalculatorDef = {
  slug: "etsy",
  name: "Etsy",
  path: "/etsy-fee-calculator",
  category: "marketplaces",
  priceNoun: "item price",
  sellerNoun: "seller",
  blurb: "6.5% transaction + 3% + $0.25 processing + $0.20 listing (US)",
  markets: MARKETS,
  defaultMarket: "us",
  priceField: "price",
  fields: [
    { id: "price", kind: "money", label: "Item price", section: "sale", help: "Your listing price per item (after any sale price, before a coupon)." },
    { id: "quantity", kind: "number", label: "Items in the order", section: "sale", integer: true, min: 1, max: 999, advanced: true },
    { id: "discount", kind: "percent", label: "Coupon or sale discount", section: "sale", advanced: true, max: 100, help: "Fees are charged on the discounted price." },
    { id: "giftWrap", kind: "money", label: "Gift wrap charged", section: "sale", advanced: true },
    {
      id: "salesTax",
      kind: "percent",
      label: "Buyer’s sales tax rate",
      section: "sale",
      advanced: true,
      max: 20,
      help: "Etsy collects it for the state; processing (3%) is charged on it too.",
      showIf: (_i, m) => m.id === "us",
    },
    { id: "shippingCharged", kind: "money", label: "Shipping you charge", section: "shipping", help: "Etsy takes 6.5% of this too, so “free shipping” built into the price costs the same." },
    {
      id: "buyerRegion",
      kind: "segmented",
      label: "Where is the buyer?",
      section: "shipping",
      options: [
        { value: "domestic", label: "Domestic" },
        { value: "international", label: "International" },
      ],
      help: "Processing is 3% for domestic orders and 4% for international ones. Canadian shops: US orders count as domestic.",
      showIf: (_i, m) => m.id === "ca" || m.id === "au" || m.id === "nz",
    },
    {
      id: "offsiteAds",
      kind: "segmented",
      label: "Did the buyer come from an Offsite Ad?",
      section: "options",
      options: [
        { value: "none", label: "No" },
        { value: "15", label: "Yes · 15%" },
        { value: "12", label: "Yes · 12%" },
      ],
      help: "12% applies (and is mandatory) once your shop has made US$10,000 in a 12-month period. Capped at US$100 per order.",
    },
    {
      id: "vatOnFees",
      kind: "toggle",
      label: "Etsy adds VAT/GST to my fees",
      section: "options",
      help: "Yes unless you’ve added a valid VAT or GST number to your Etsy account.",
      showIf: (_i, m) => Boolean(VAT_ON_FEES[m.id]) && !VAT_ON_FEES[m.id].always,
    },
    { id: "shareSave", kind: "toggle", label: "Sale came through my Share & Save link", section: "options", advanced: true, help: "Etsy refunds part of its fees on these orders." },
    { id: "currencyConversion", kind: "toggle", label: "My listing currency differs from my bank account’s", section: "options", advanced: true },
    { id: "texas", kind: "toggle", label: "My shop is located in Texas", section: "options", advanced: true, showIf: (_i, m) => m.id === "us" },
    { id: "etsyAds", kind: "money", label: "Etsy Ads cost per sale", section: "options", advanced: true, help: "Optional: what your on-site ads cost you per order, on average." },
    { id: "itemCost", kind: "money", label: "What the item cost you", section: "costs", help: "Materials or what you paid for it." },
    { id: "shippingCost", kind: "money", label: "Postage / label you pay", section: "costs" },
    { id: "otherCost", kind: "money", label: "Packaging & other", section: "costs" },
  ],
  defaults: (market) => ({
    price: market.id === "in" ? 2000 : 25,
    quantity: 1,
    discount: 0,
    giftWrap: 0,
    salesTax: 0,
    shippingCharged: market.id === "in" ? 400 : 5,
    buyerRegion: "domestic",
    offsiteAds: "none",
    vatOnFees: Boolean(VAT_ON_FEES[market.id]),
    shareSave: false,
    currencyConversion: false,
    texas: false,
    etsyAds: 0,
    itemCost: 0,
    shippingCost: 0,
    otherCost: 0,
  }),
  calculate,
  breakpoints: (inputs, market) => {
    // The Offsite Ads cap makes the fee flat above US$100 / rate; the payout stays monotonic, but give the solver the edge anyway.
    const offsite = str(inputs, "offsiteAds", "none");
    if (offsite === "none") return [];
    const cap = fromUsd(10000, market.currency);
    return [Math.ceil((cap * 100) / Number(offsite))];
  },
  verifiedAt: "2026-10-23",
  sources,
  changes,
  schedule,
  compare: {
    group: "sell",
    map: (c) => ({ price: c.price, shippingCharged: c.shipping, itemCost: c.itemCost, shippingCost: c.shippingCost }),
    note: "US shop, domestic buyer, no Offsite Ad",
  },
};

export default etsy;
