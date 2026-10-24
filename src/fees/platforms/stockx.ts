/*
 * StockX seller fees on the Verified Marketplace (new, unworn items StockX checks before they
 * reach the buyer). Every number is from StockX's own help center and seller news (see `sources`),
 * re-read on 2026-10-23. Research notes with verbatim quotes: research/fees/stockx.md.
 *
 * How a payout is computed (what this module reproduces):
 *  - Transaction fee: the Seller Level rate (Level 1–5: 9 / 8.5 / 8 / 7.5 / 7%) of the final sale
 *    price, i.e. your Ask or the Offer you accepted. Not charged on anything the buyer adds on top
 *    (their own processing fee, shipping, tax or duties).
 *  - Payment processing: 3% of the same sale price, every level, standard and Flex alike.
 *  - Minimum seller fee by region (US $5.00, GB £4.50, EU €5.00, CA C$7.00). StockX doesn't say
 *    whether it floors the transaction fee alone or transaction + processing together; we floor the
 *    transaction fee alone (the stricter reading, it never overstates the payout) and show the
 *    difference in a note when it matters. See research §11 Q1.
 *  - Seller shipping fee on standard (non-Flex) sales, deducted from the payout: US $5.00 since
 *    March 1, 2026 (was $4), UK £4.00, Canada C$6.00, euro countries €5–€17 by country. Refunded
 *    when the item is scanned in at a StockX drop-off location (New York City in our markets).
 *  - Flex (stock already stored at StockX): same level rates + 3% since March 1, 2026, no shipping
 *    fee, no fulfillment fee; monthly storage is invoiced separately (shown as a note).
 *  - No Fee Resale: reselling a StockX purchase within 90 days of delivery pays no transaction,
 *    processing or shipping fee.
 *  - Optional cash-out fee: US debit card 2% (min $1.95, max $9.95); bank transfer ≈ US$2 per payout.
 * StockX doesn't publish a rounding rule; each line is rounded to the cent separately, half up.
 */
import { M } from "../markets";
import { assemble, bool, costLines, formatRate, moneyFor, num, pct, str, toCents } from "../money";
import { FX_DATE, fromUsd } from "../fx";
import type { CalculatorDef, FeeChange, Inputs, Line, Market, ScheduleRow, SelectOption, Source } from "../types";

const MARKETS: Market[] = [M.us, M.uk, M.ca, M.de, M.fr, M.it, M.es, M.nl, M.ie, M.be, M.at, M.pt, M.fi, M.gr];

/** Seller Level → Verified Marketplace base transaction fee (identical for Flex since 2026-03-01). */
const LEVELS: Record<string, { rate: number; needs: string }> = {
  "1": { rate: 9, needs: "Where every seller starts" },
  "2": { rate: 8.5, needs: "12 sales or US$1,500 in a quarter" },
  "3": { rate: 8, needs: "40 sales or US$5,000 in a quarter" },
  "4": { rate: 7.5, needs: "200 sales or US$25,000 in a quarter" },
  "5": { rate: 7, needs: "800 sales or US$100,000 in a quarter" },
};

const PROCESSING = 3;

type FlexRegion = "us" | "uk" | "ca" | "eu";

interface Region {
  /** Minimum Verified seller fee, cents of the market currency. */
  min: number;
  /** "Great Britain", "the European Union"… as StockX's minimum-fee table names the region (with "the" where English needs it). */
  minRegion: string;
  /** Single-item seller shipping fee on standard sales, cents. */
  ship: number;
  flex: FlexRegion;
}

/** Minimum fees: "Minimum Verified Seller Fees by Region". Shipping: "Single item shipping costs". */
const REGION: Record<string, Region> = {
  us: { min: 500, minRegion: "the United States", ship: 500, flex: "us" },
  uk: { min: 450, minRegion: "Great Britain", ship: 400, flex: "uk" },
  ca: { min: 700, minRegion: "Canada", ship: 600, flex: "ca" },
  de: { min: 500, minRegion: "the European Union", ship: 500, flex: "eu" },
  fr: { min: 500, minRegion: "the European Union", ship: 700, flex: "eu" },
  it: { min: 500, minRegion: "the European Union", ship: 700, flex: "eu" },
  es: { min: 500, minRegion: "the European Union", ship: 800, flex: "eu" },
  nl: { min: 500, minRegion: "the European Union", ship: 500, flex: "eu" },
  ie: { min: 500, minRegion: "the European Union", ship: 1100, flex: "eu" },
  be: { min: 500, minRegion: "the European Union", ship: 500, flex: "eu" },
  at: { min: 500, minRegion: "the European Union", ship: 500, flex: "eu" },
  pt: { min: 500, minRegion: "the European Union", ship: 1000, flex: "eu" },
  fi: { min: 500, minRegion: "the European Union", ship: 1500, flex: "eu" },
  gr: { min: 500, minRegion: "the European Union", ship: 1700, flex: "eu" },
};

/** Flex storage per item per month by days in storage (0–30 free, 31–90, 91–180, 181+) and the return fee, cents. */
const FLEX_STORAGE: Record<FlexRegion, { tiers: [number, number, number]; returnFee: number }> = {
  us: { tiers: [100, 200, 300], returnFee: 500 },
  eu: { tiers: [100, 200, 300], returnFee: 250 },
  uk: { tiers: [100, 150, 200], returnFee: 250 },
  ca: { tiers: [150, 300, 450], returnFee: 400 },
};

const DEBIT = { rate: 2, min: 195, max: 995 };
const BANK_USD = 200; // "approximately $2 USD … per payout, depending on your payout currency"
const PENALTY_USD = 1500;

const S = {
  fees: "stockx-fees",
  levels: "stockx-levels",
  shipping: "stockx-shipping",
  flex: "stockx-flex",
  dropoff: "stockx-dropoff",
  nfr: "stockx-nfr",
  payout: "stockx-payout-fees",
  late: "stockx-late",
  update2026: "stockx-update-2026",
  balance: "stockx-balance",
  listings: "stockx-listings",
  flexStorage2025: "stockx-flex-storage-2025",
  ukVat: "stockx-uk-vat",
  euVat: "stockx-eu-vat",
} as const;

const sources: Source[] = [
  { id: S.fees, title: "What are StockX's fees for sellers?", url: "https://stockx.com/help/articles/What-are-StockXs-fees-for-Sellers", publisher: "StockX Help Center", checked: "2026-10-23" },
  { id: S.levels, title: "What is the StockX Seller Program? What are Seller Levels?", url: "https://stockx.com/help/articles/What-is-the-StockX-Seller-program-what-are-Seller-levels", publisher: "StockX Help Center", checked: "2026-10-23" },
  { id: S.shipping, title: "How much does shipping cost for sellers?", url: "https://stockx.com/help/articles/how-much-does-shipping-cost-for-sellers", publisher: "StockX Help Center", checked: "2026-10-23" },
  { id: S.flex, title: "What is Flex?", url: "https://stockx.com/help/articles/what-is-flex", publisher: "StockX Help Center", checked: "2026-10-23" },
  { id: S.dropoff, title: "StockX Drop-Off Locations", url: "https://stockx.com/help/articles/stockx-drop-off-locations", publisher: "StockX Help Center", checked: "2026-10-23" },
  { id: S.nfr, title: "What is No Fee Resale?", url: "https://stockx.com/help/articles/what-is-no-fee-resale", publisher: "StockX Help Center", checked: "2026-10-23" },
  { id: S.payout, title: "What fees and currencies apply to seller payouts?", url: "https://stockx.com/help/articles/what-fees-and-currencies-apply-to-seller-payouts", publisher: "StockX Help Center", checked: "2026-10-23" },
  { id: S.late, title: "What happens if I don't ship on time?", url: "https://stockx.com/help/articles/what-happens-if-i-dont-ship-on-time", publisher: "StockX Help Center", checked: "2026-10-23" },
  { id: S.ukVat, title: "How does UK VAT affect me as a StockX customer?", url: "https://stockx.com/help/articles/how-does-uk-vat-affect-me-as-a-stockx-customer", publisher: "StockX Help Center", checked: "2026-10-23" },
  { id: S.euVat, title: "How will EU VAT changes affect me as a StockX customer?", url: "https://stockx.com/help/articles/how-will-eu-vat-changes-affect-me-as-a-stockx-customer", publisher: "StockX Help Center", checked: "2026-10-23" },
  {
    id: S.update2026,
    title: "Updates to the StockX Seller Program",
    url: "https://stockx.com/news/en-us/updates-to-the-stockx-seller-program/",
    publisher: "StockX News",
    checked: "2026-10-23",
    watch: "https://stockx.com/news/wp-json/wp/v2/posts?slug=updates-to-the-stockx-seller-program&_fields=modified,title",
  },
  {
    id: S.balance,
    title: "StockX Balance – Store Earnings & Get Rewarded",
    url: "https://stockx.com/news/en-us/stockx-balance/",
    publisher: "StockX News",
    checked: "2026-10-23",
    watch: "https://stockx.com/news/wp-json/wp/v2/posts?slug=stockx-balance&_fields=modified,title",
  },
  {
    id: S.listings,
    title: "Selling on StockX Listings Is Now Open to Every US Seller",
    url: "https://stockx.com/news/en-us/selling-on-stockx-listings-is-now-open-to-every-us-seller/",
    publisher: "StockX News",
    checked: "2026-10-23",
    watch: "https://stockx.com/news/wp-json/wp/v2/posts?slug=selling-on-stockx-listings-is-now-open-to-every-us-seller&_fields=modified,title",
  },
  {
    id: S.flexStorage2025,
    title: "Lower Flex Storage Fees Are Here",
    url: "https://stockx.com/news/en-us/stockx-flex-storage-fee-update/",
    publisher: "StockX News",
    checked: "2026-10-23",
    watch: "https://stockx.com/news/wp-json/wp/v2/posts?slug=stockx-flex-storage-fee-update&_fields=modified,title",
  },
];

const changes: FeeChange[] = [
  {
    date: "2026-10-14",
    text: "StockX Listings (used and unique items) is no longer invite-only: any eligible US seller can list, with zero seller fees and a prepaid label, so the seller keeps 100% of the sale.",
    source: S.listings,
  },
  {
    date: "2026-03-09",
    text: "All US sales payouts now go to StockX Balance instead of straight to PayPal, Venmo or a bank. Balance itself has no StockX fee; withdrawals use the payout method’s own fee, if any.",
    source: S.balance,
  },
  {
    date: "2026-03-01",
    text: "US seller shipping fee on standard (non-Flex) sales raised from $4 to $5. Unchanged for sellers outside the US.",
    source: S.update2026,
  },
  {
    date: "2026-03-01",
    text: "Flex fees up 2 points at every Seller Level (Level 1: 7% → 9%), so Flex now pays the same 9%–7% as standard sales. The $5 Flex fulfillment fee and the 1% Flex Quick Sale discount were removed.",
    source: S.update2026,
  },
  {
    date: "2025-10-01",
    text: "Flex storage fees lowered from the October 2025 invoice, with a new rate for items stored over 90 days: in the US, free for 30 days, $1 a month to day 90, then $2 a month (Europe €1.00 / €2.00, UK £1.00 / £1.50). The announcement didn’t list the old rates; StockX’s help center now lists $2 a month for days 91–180 and $3 a month after that.",
    source: S.flexStorage2025,
  },
];

function levelOf(inputs: Inputs): { id: string; rate: number } {
  const id = str(inputs, "level", "1");
  const l = LEVELS[id] ?? LEVELS["1"];
  return { id: LEVELS[id] ? id : "1", rate: l.rate };
}

function regionOf(market: Market): Region {
  return REGION[market.id] ?? REGION.us;
}

/** "$5.00" in the US, "US$5.00 ≈ £3.74" elsewhere. */
function usdText(usdCents: number, market: Market): string {
  const money = moneyFor(market);
  const usd = moneyFor(M.us)(usdCents);
  return market.currency === "USD" ? usd : `US${usd} ≈ ${money(fromUsd(usdCents, market.currency))}`;
}

function storageText(market: Market): string {
  const money = moneyFor(market);
  const s = FLEX_STORAGE[regionOf(market).flex];
  return `free for the first 30 days, then ${money(s.tiers[0])} a month to day 90, ${money(s.tiers[1])} a month to day 180 and ${money(s.tiers[2])} a month after that`;
}

function cashOutOptions(_inputs: Inputs, market: Market): SelectOption[] {
  if (market.id === "us") {
    return [
      { value: "free", label: "Keep in StockX Balance, or PayPal / Venmo", hint: "Free" },
      { value: "debit", label: "Debit card", hint: "2%, min $1.95, max $9.95" },
      { value: "bank", label: "Bank transfer", hint: "About $2 per payout" },
    ];
  }
  return [
    { value: "free", label: "PayPal", hint: "No StockX fee" },
    { value: "bank", label: "Bank transfer", hint: `About ${usdText(BANK_USD, market)} per payout` },
  ];
}

function calculate(inputs: Inputs, market: Market) {
  const money = moneyFor(market);
  const us = market.id === "us";
  const region = regionOf(market);
  const price = toCents(num(inputs, "price"));
  const { id: levelId, rate } = levelOf(inputs);
  const flex = str(inputs, "fulfillment", "standard") === "flex";
  const noFee = !flex && bool(inputs, "noFeeResale");
  const dropOff = us && !flex && bool(inputs, "dropOff");

  const fees: Line[] = [];
  const notes: string[] = [];

  if (noFee) {
    fees.push({
      id: "nofeeresale",
      label: "No Fee Resale",
      amount: 0,
      kind: "platform",
      detail: "No transaction, processing or shipping fee",
      explain:
        "Reselling something you bought on StockX within 90 days of delivery, in the same condition with the StockX tag still on, costs no transaction, processing or shipping fee. Not available for items sent to Flex.",
      source: S.nfr,
    });
  } else {
    const raw = pct(price, rate);
    const minApplies = price > 0 && raw < region.min;
    const transaction = minApplies ? region.min : raw;
    const edge = Math.ceil((region.min * 100) / rate);
    fees.push({
      id: "transaction",
      label: `Transaction fee (Level ${levelId}, ${formatRate(rate)})`,
      amount: transaction,
      kind: "platform",
      detail: minApplies ? `${formatRate(rate)} would be ${money(raw)}; minimum ${money(region.min)}` : `${formatRate(rate)} × ${money(price)}`,
      explain: `StockX’s fee for your Seller Level, charged on the final sale price only. StockX’s minimum seller fee in ${region.minRegion} is ${money(region.min)} a sale; we apply it to this fee, so at Level ${levelId} anything under ${money(edge)} pays ${money(region.min)}.${flex ? " Flex sales have paid the same level rates as standard sales since March 1, 2026." : ""}`,
      source: S.fees,
    });
    const processing = pct(price, PROCESSING);
    fees.push({
      id: "processing",
      label: "Payment processing (3%)",
      amount: processing,
      kind: "payment",
      detail: `3% × ${money(price)}`,
      explain: "Every Verified Marketplace sale pays 3% of the sale price for payment processing, at every Seller Level and on Flex too. It is separate from the processing fee StockX charges your buyer.",
      source: S.fees,
    });
    if (minApplies) {
      const lenient = Math.max(raw + processing, region.min);
      const diff = transaction + processing - lenient;
      if (diff > 0)
        notes.push(
          `The ${money(region.min)} minimum fee applies here. StockX doesn’t say whether it also covers the 3% processing fee; we count it on the transaction fee alone, the stricter reading. If it covers both, you keep ${money(diff)} more.`,
        );
    }

    if (flex) {
      fees.push({
        id: "shipping",
        label: "Shipping fee",
        amount: 0,
        kind: "shipping",
        detail: "None on Flex sales",
        explain: "Flex items already sit in StockX’s warehouse and ship straight to the buyer, so there is no seller shipping fee, and since March 1, 2026 no $5 fulfillment fee either. Storage is billed separately each month.",
        source: S.update2026,
      });
    } else {
      fees.push({
        id: "shipping",
        label: dropOff ? "Shipping fee (refunded at drop-off)" : "Shipping fee",
        amount: dropOff ? 0 : region.ship,
        kind: "shipping",
        detail: dropOff ? `${money(region.ship)} charged, refunded when scanned in` : `${money(region.ship)} per item`,
        explain: dropOff
          ? "StockX refunds the shipping fee once the item is scanned in at its New York City drop-off location (237 Lafayette St.)."
          : us
            ? "StockX deducts $5.00 from your payout for the prepaid label to its verification center ($4 before March 1, 2026). StockX adjusts it for heavier items and multi-item packs."
            : `StockX deducts an estimated base rate of ${money(region.ship)} from your payout for the prepaid label to its verification center. StockX says it varies with the item’s price, size and type, carrier rates and your location.`,
        source: dropOff ? S.dropoff : S.shipping,
      });
    }
  }

  const cashOut = str(inputs, "cashOut", "free");
  const before = price - fees.reduce((s, l) => s + l.amount, 0);
  if (before > 0 && cashOut === "debit" && us) {
    const fee = Math.min(before, Math.min(DEBIT.max, Math.max(DEBIT.min, pct(before, DEBIT.rate))));
    fees.push({
      id: "cashout",
      label: "Debit card withdrawal fee",
      amount: fee,
      kind: "payout",
      detail: `2% × ${money(before)}, min $1.95, max $9.95`,
      explain: "Withdrawing your StockX Balance to a Visa or Mastercard debit card costs 2% of the amount (at least $1.95, at most $9.95). Keeping it in Balance or withdrawing to PayPal or Venmo is free.",
      source: S.payout,
    });
  } else if (before > 0 && cashOut === "bank") {
    const fee = Math.min(before, fromUsd(BANK_USD, market.currency));
    fees.push({
      id: "cashout",
      label: "Bank transfer fee (approx.)",
      amount: fee,
      kind: "payout",
      detail: `${us ? "≈ " : ""}${usdText(BANK_USD, market)} per payout`,
      explain: `StockX says a bank transfer may cost approximately US$2 per payout, depending on your payout currency; your bank may charge its own fee on top. It is per payout, so several sales paid out together share it.${us ? "" : ` We convert at the ECB reference rate of ${FX_DATE}; StockX uses its own rate. PayPal has no StockX fee.`}`,
      source: S.payout,
    });
  }

  if (flex) {
    const s = FLEX_STORAGE[region.flex];
    notes.push(`Flex storage is billed separately on the 15th of each month: ${storageText(market)}. If StockX sends an item back after 180+ days, it charges ${money(s.returnFee)} per item.`);
  } else if (!noFee && !dropOff) {
    notes.push(`Through Flex there is no ${money(region.ship)} shipping fee, so the same sale keeps ${money(region.ship)} more if it sells within its first 30 days in storage (before what it costs you to send it in).`);
  }
  if (market.id === "uk" || market.id === "nl")
    notes.push(
      market.id === "uk"
        ? "VAT-registered in the UK? StockX adds output VAT to your payout under self-billing, and you pay it to HMRC. It isn’t included here."
        : "VAT-registered and shipping from the Netherlands? StockX adds 21% VAT to your payout under self-billing, and you pay it to the Dutch tax authority. It isn’t included here.",
    );

  return assemble({
    market,
    buyerPays: price,
    saleAmount: price,
    fees,
    costs: costLines(inputs, market),
    notes,
  });
}

function schedule(market: Market): ScheduleRow[] {
  const money = moneyFor(market);
  const us = market.id === "us";
  const region = regionOf(market);
  const storage = FLEX_STORAGE[region.flex];
  const rows: ScheduleRow[] = Object.entries(LEVELS).map(([id, l]) => ({
    fee: `Transaction fee, Level ${id}`,
    amount: formatRate(l.rate),
    appliesTo: "Final sale price",
    when: l.needs,
    source: id === "1" ? S.fees : S.levels,
  }));
  rows.push(
    {
      fee: "Minimum seller fee",
      amount: money(region.min),
      appliesTo: "Each sale (we apply it to the transaction fee)",
      when: `Low prices: under ${money(Math.ceil((region.min * 100) / 9))} at Level 1`,
      source: S.fees,
    },
    { fee: "Payment processing", amount: "3%", appliesTo: "Final sale price", when: "Every sale, all levels, Flex too", source: S.fees },
    {
      fee: "Seller shipping fee",
      amount: money(region.ship),
      appliesTo: "Each item, deducted from your payout",
      when: us ? "Standard sales; refunded at the NYC drop-off" : "Standard (non-Flex) sales",
      source: S.shipping,
    },
    { fee: "Flex storage", amount: `Free 30 days, then ${money(storage.tiers[0])}–${money(storage.tiers[2])}/month`, appliesTo: "Each item stored in Flex", when: "Invoiced monthly", source: S.flex },
    { fee: "Flex return fee", amount: `${money(storage.returnFee)} per item`, appliesTo: "Items StockX sends back", when: "Stored 180+ days", source: S.flex },
    { fee: "Missed shipment penalty", amount: us ? money(PENALTY_USD) : `${usdText(PENALTY_USD, market)} (local equivalent)`, appliesTo: "Each cancelled sale", when: "Item not shipped in time", source: S.late },
  );
  if (us) rows.push({ fee: "Debit card withdrawal", amount: "2%, min $1.95, max $9.95", appliesTo: "Amount withdrawn", when: "Cashing out to a debit card", source: S.payout });
  rows.push(
    { fee: "Bank transfer payout", amount: us ? "≈ $2.00" : "≈ US$2", appliesTo: "Each payout", when: "Depends on payout currency", source: S.payout },
    { fee: "No Fee Resale", amount: "No fees", appliesTo: "Transaction, processing and shipping", when: "Reselling a StockX purchase within 90 days", source: S.nfr },
  );
  if (us) rows.push({ fee: "Listings (used items)", amount: "0%", appliesTo: "Listing price", when: "Listings Marketplace, at launch", source: S.fees });
  return rows;
}

export const stockx: CalculatorDef = {
  slug: "stockx",
  name: "StockX",
  path: "/stockx-fee-calculator",
  category: "marketplaces",
  priceNoun: "sale price",
  sellerNoun: "seller",
  blurb: "9% (Level 1) + 3% processing + $5 shipping fee, $5 minimum (US)",
  markets: MARKETS,
  defaultMarket: "us",
  priceField: "price",
  fields: [
    {
      id: "price",
      kind: "money",
      label: "Sale price (your Ask)",
      section: "sale",
      help: "Fees come out of this. The buyer’s own fees, shipping and tax go on top and never reach you.",
    },
    {
      id: "level",
      kind: "select",
      label: "Your Seller Level",
      section: "sale",
      options: Object.entries(LEVELS).map(([value, l]) => ({ value, label: `Level ${value} · ${formatRate(l.rate)}`, hint: l.needs })),
      help: "Find it under Profile in Account Settings. Reach a level in a calendar quarter and you keep it through the next one.",
    },
    {
      id: "fulfillment",
      kind: "segmented",
      label: "How does it get to the buyer?",
      section: "shipping",
      options: [
        { value: "standard", label: "I ship it after it sells" },
        { value: "flex", label: "Flex (stored at StockX)" },
      ],
      help: "Flex sales pay no shipping fee, but storage is billed monthly after 30 days.",
    },
    {
      id: "dropOff",
      kind: "toggle",
      label: "I’ll drop it off at StockX in New York",
      section: "shipping",
      advanced: true,
      help: "The shipping fee is refunded once the item is scanned in at 237 Lafayette St.",
      showIf: (i, m) => m.id === "us" && str(i, "fulfillment", "standard") !== "flex",
    },
    {
      id: "noFeeResale",
      kind: "toggle",
      label: "I bought it on StockX in the last 90 days",
      section: "options",
      advanced: true,
      help: "No Fee Resale: same condition with the StockX tag on, and you pay no StockX fees.",
      showIf: (i) => str(i, "fulfillment", "standard") !== "flex",
    },
    {
      id: "cashOut",
      kind: "select",
      label: "How you take the money out",
      section: "options",
      advanced: true,
      options: cashOutOptions,
      help: "Some payout methods cost a fee on top of StockX’s selling fees.",
    },
    { id: "itemCost", kind: "money", label: "What you paid for it", section: "costs", help: "Retail price plus any sales tax you paid." },
    { id: "shippingCost", kind: "money", label: "Postage you pay yourself", section: "costs", help: "StockX’s label fee is already counted above; add what it costs to send stock into Flex." },
    { id: "otherCost", kind: "money", label: "Box, packaging & other", section: "costs" },
  ],
  defaults: (market) => ({
    price: market.id === "us" ? 200 : market.id === "uk" ? 150 : market.id === "ca" ? 250 : 180,
    level: "1",
    fulfillment: "standard",
    dropOff: false,
    noFeeResale: false,
    cashOut: "free",
    itemCost: 0,
    shippingCost: 0,
    otherCost: 0,
  }),
  calculate,
  breakpoints: (inputs, market) => {
    const flex = str(inputs, "fulfillment", "standard") === "flex";
    const noFee = !flex && bool(inputs, "noFeeResale");
    const region = regionOf(market);
    const rate = levelOf(inputs).rate;
    const out: number[] = [];
    // Where the level percentage overtakes the minimum seller fee (the fee is flat below it).
    const edge = Math.ceil((region.min * 100) / rate);
    if (!noFee) out.push(edge);
    // Debit-card cash-out (US): 2% reaches the $1.95 minimum and the $9.95 maximum of the amount withdrawn.
    if (market.id === "us" && str(inputs, "cashOut", "free") === "debit") {
      const ship = flex || noFee || bool(inputs, "dropOff") ? 0 : region.ship;
      for (const withdrawn of [(DEBIT.min * 100) / DEBIT.rate, (DEBIT.max * 100) / DEBIT.rate]) {
        if (noFee) {
          out.push(Math.ceil(withdrawn));
          continue;
        }
        const percent = (withdrawn + ship) / (1 - (rate + PROCESSING) / 100);
        out.push(Math.ceil(percent >= edge ? percent : (withdrawn + ship + region.min) / (1 - PROCESSING / 100)));
      }
    }
    return out;
  },
  verifiedAt: "2026-10-23",
  sources,
  changes,
  schedule,
  compare: {
    group: "sell",
    map: (c) => ({ price: c.price, itemCost: c.itemCost }),
    note: "Level 1, you ship it on StockX’s $5 label; the buyer’s shipping goes to StockX",
  },
};

export default stockx;
