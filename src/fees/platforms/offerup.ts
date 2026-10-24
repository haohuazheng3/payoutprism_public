/*
 * OfferUp seller costs (US only). Every number is from OfferUp's own pages (see `sources`), re-read
 * 2026-10-23 through the help center's Zendesk API (the HTML pages block plain HTTP). Research notes
 * with verbatim quotes: research/fees/offerup.md.
 *
 * What a sale costs today (what this module reproduces):
 *  - OfferUp is local, in-person only. New listings lost shipping on September 23, 2025 and every
 *    existing listing on October 21, 2025 ("Nationwide shipping ending"). The 12.9% seller service fee
 *    (minimum $1.99, on the item's final price excluding shipping) applied only to shipped sales, so it
 *    no longer applies to anything. In-person sales: "OfferUp doesn’t charge fees or take a commission".
 *    The buyer pays the seller directly (cash recommended); OfferUp takes no buyer fee either.
 *  - Everything else is an optional, fixed-price feature bought through the App Store / Google Play:
 *    Promote Plus $19.99 a month or $99.99 a year; one-off 1- or 3-day promotions (price shown in the
 *    app only); a paid listing once the month's free listings in that category are used (price varies
 *    by category, shown in the app only); OfferUp Premium $7.99 a month (a buyer membership).
 *    Subscriptions are spread evenly over the items the seller sells per month.
 *  - A payment app (Venmo, PayPal…) may charge its own fee. That is not OfferUp's, so the rate is typed
 *    in by the seller.
 * Fixed prices need no rounding; a subscription's per-sale share and the payment-app percentage are
 * each rounded to the cent (half away from zero).
 */
import { M } from "../markets";
import { assemble, bool, costLines, formatRate, moneyFor, num, pct, roundCents, str, toCents } from "../money";
import type { CalculatorDef, FeeChange, Inputs, Line, Market, ScheduleRow, SelectOption, Source } from "../types";

const MARKETS: Market[] = [M.us];

/** Promote Plus (help article 360052029431): "$19.99 per month or $99.99 per year". Cents. */
export const PROMOTE_PLUS_MONTHLY = 1999;
export const PROMOTE_PLUS_YEARLY = 9999;
/** OfferUp Premium (help article 10542076242964): "$7.99 per month". Cents. */
export const PREMIUM_MONTHLY = 799;

interface Category {
  value: string;
  label: string;
  /** Free listings per calendar month (help article 13072929390228). */
  free: number;
  /** A monthly listing subscription exists for this category (help article 16354037338900). */
  subscription: boolean;
}

export const CATEGORIES: Category[] = [
  { value: "other", label: "Most items (all other categories)", free: 200, subscription: false },
  { value: "cars", label: "Cars & Trucks", free: 1, subscription: true },
  { value: "motorcycles", label: "Motorcycles", free: 1, subscription: false },
  { value: "appliances", label: "Appliances", free: 15, subscription: true },
  { value: "phones", label: "Cell Phones & Accessories", free: 15, subscription: true },
  { value: "furniture", label: "Furniture", free: 25, subscription: true },
  { value: "jewelry", label: "Jewelry & Accessories", free: 25, subscription: true },
  { value: "tools", label: "Tools & Machinery", free: 25, subscription: true },
];

const HELP = (slugged: string) => `https://help.offerup.com/hc/en-us/articles/${slugged}`;
const API = (slugged: string) => `https://help.offerup.com/api/v2/help_center/en-us/articles/${slugged.split("-")[0]}.json`;

const S = {
  whatIs: "offerup-what-is",
  shippingEnd: "offerup-shipping-ending",
  shippingOld: "offerup-shipping-sellers-2025",
  limits: "offerup-free-listing-limits",
  single: "offerup-single-listings",
  subs: "offerup-listing-subscriptions",
  promote: "offerup-promote",
  plus: "offerup-promote-plus",
  premium: "offerup-premium",
  paid: "offerup-getting-paid",
  jobs: "offerup-jobs",
  services: "offerup-services",
  terms: "offerup-terms",
} as const;

function help(id: string, slugged: string, title: string): Source {
  return { id, title, url: HELP(slugged), publisher: "OfferUp Help", checked: "2026-10-23", watch: API(slugged) };
}

const sources: Source[] = [
  help(S.whatIs, "360031989092-What-is-OfferUp", "What is OfferUp?"),
  help(S.shippingEnd, "41043186552980-Nationwide-shipping-ending", "Nationwide shipping ending"),
  {
    id: S.shippingOld,
    title: "How shipping works for sellers (archived copy, September 8, 2025)",
    url: "https://web.archive.org/web/20250908183700/https://help.offerup.com/hc/en-us/articles/24723943166740-How-shipping-works-for-sellers",
    publisher: "OfferUp Help (Internet Archive copy)",
    checked: "2026-10-23",
  },
  help(S.limits, "13072929390228-About-free-listing-limits", "About free listing limits"),
  help(S.single, "16353710704788-Buy-single-listings", "Buy single listings"),
  help(S.subs, "16354037338900-For-Sale-listing-subscriptions", "For Sale listing subscriptions"),
  help(S.promote, "360031994412-Promote-your-items", "Promote your items"),
  help(S.plus, "360052029431-Promote-Plus-subscription", "Promote Plus subscription"),
  help(S.premium, "10542076242964-OfferUp-Premium-subscription", "OfferUp Premium subscription"),
  help(S.paid, "360031961592-Getting-paid", "Getting paid"),
  help(S.jobs, "14172591465236-Post-a-job", "Post a job"),
  help(S.services, "38936892561940-Services-subscription", "Services subscription"),
  { id: S.terms, title: "Terms of Service", url: "https://offerup.com/terms", publisher: "OfferUp", checked: "2026-10-23" },
];

const changes: FeeChange[] = [
  {
    date: "2025-10-21",
    text: "Shipping removed from every remaining listing: OfferUp is now local, in-person only. The seller service fee on shipped sales (12.9% of the item price, minimum $1.99) no longer applies to any sale; in-person sales carry no OfferUp fee for the seller or the buyer.",
    source: S.shippingEnd,
  },
  {
    date: "2025-09-23",
    text: "New listings can no longer offer shipping: everything posted from this date is local pickup only. Until then, shipped sales cost the seller 12.9% of the item’s final price (excluding shipping), minimum $1.99.",
    source: S.shippingEnd,
  },
];

function category(inputs: Inputs): Category {
  return CATEGORIES.find((c) => c.value === str(inputs, "category", "other")) ?? CATEGORIES[0];
}

function salesPerMonth(inputs: Inputs): number {
  return Math.max(1, Math.round(num(inputs, "salesPerMonth", 1)));
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function calculate(inputs: Inputs, market: Market) {
  const money = moneyFor(market);
  const price = toCents(num(inputs, "price"));
  const cat = category(inputs);
  const perMonth = salesPerMonth(inputs);
  const fees: Line[] = [];

  fees.push({
    id: "selling",
    label: "OfferUp selling fee",
    amount: 0,
    kind: "platform",
    detail: "0% · local, in-person sale",
    explain:
      "OfferUp doesn’t charge a fee or take a commission on in-person sales, and the buyer pays no fee either: they pay you directly. The 12.9% seller fee (minimum $1.99) applied only to shipped sales, and shipping ended on October 21, 2025.",
    source: S.whatIs,
  });

  const listingFee = toCents(num(inputs, "listingFee"));
  const allowance = cat.value === "other" ? "200 free listings a month (all other categories combined)" : `${plural(cat.free, "free listing")} a month in ${cat.label}`;
  fees.push({
    id: "listing",
    label: listingFee ? "Paid listing" : "Listing fee",
    amount: listingFee,
    kind: "platform",
    detail: listingFee ? `Over the free limit (${allowance})` : `Free · ${allowance}`,
    explain: listingFee
      ? `You paid to post because this month’s free listings in this category were used up. OfferUp sets the price by category and shows it in the app; a paid listing can’t be canceled or refunded.${cat.subscription ? " If you post often in this category, a monthly listing subscription costs less per listing." : ""}`
      : "Posting is free until you use up the month’s free listings in that category: 1 for Cars & Trucks and for Motorcycles, 15 for Appliances and for Cell Phones, 25 for Furniture, Jewelry and Tools, and 200 combined for everything else. They reset on the 1st and don’t roll over.",
    source: listingFee ? S.single : S.limits,
  });

  const promotion = str(inputs, "promotion", "none");
  if (promotion === "plus-monthly" || promotion === "plus-yearly") {
    const yearly = promotion === "plus-yearly";
    const share = roundCents((yearly ? PROMOTE_PLUS_YEARLY / 12 : PROMOTE_PLUS_MONTHLY) / perMonth);
    fees.push({
      id: "promotion",
      label: `Promote Plus (${yearly ? "yearly" : "monthly"} plan)`,
      amount: share,
      kind: "ads",
      detail: yearly ? `${money(PROMOTE_PLUS_YEARLY)} a year ÷ 12 months ÷ ${plural(perMonth, "sale")}` : `${money(PROMOTE_PLUS_MONTHLY)} a month ÷ ${plural(perMonth, "sale")}`,
      explain: `Promote Plus keeps one item at a time in featured spots on the feed for as long as you subscribe, and you can switch items whenever you like. ${
        yearly ? "$99.99 a year" : "$19.99 a month"
      } through your app store, renewing until you cancel; we split it across the items you sell each month.`,
      source: S.plus,
    });
  } else if (promotion === "single") {
    const paid = toCents(num(inputs, "promoCost"));
    fees.push({
      id: "promotion",
      label: "Promotion (1 or 3 days)",
      amount: paid,
      kind: "ads",
      detail: paid ? "What you paid to promote this item" : "Enter what you paid above",
      explain:
        "A one-off promotion puts the item in featured spots for 1 or 3 days, and you can stack them (1 + 3 = 4 days). OfferUp shows the price in the app before you buy. Promotions can’t be canceled; refunds after they end are case by case, and iPhone purchases are refunded only through Apple.",
      source: S.promote,
    });
  }

  if (bool(inputs, "premium")) {
    fees.push({
      id: "premium",
      label: "OfferUp Premium (your share)",
      amount: roundCents(PREMIUM_MONTHLY / perMonth),
      kind: "subscription",
      detail: `${money(PREMIUM_MONTHLY)} a month ÷ ${plural(perMonth, "sale")}`,
      explain:
        "Premium is a buyer membership: you see new listings 30 minutes before everyone else, with no ads and priority in sellers’ inboxes. It doesn’t change what OfferUp charges on your sales; count it here if you use it to find items you resell.",
      source: S.premium,
    });
  }

  const app = str(inputs, "payMethod", "cash") === "app";
  if (app) {
    const rate = Math.min(100, Math.max(0, num(inputs, "appRate")));
    const fixed = toCents(num(inputs, "appFixed"));
    const amount = pct(price, rate) + fixed;
    fees.push({
      id: "app",
      label: "Payment app fee",
      amount,
      kind: "payment",
      detail: rate || fixed ? `${formatRate(rate)} × ${money(price)}${fixed ? ` + ${money(fixed)}` : ""}` : "Enter your app’s fee under More options",
      explain:
        "Charged by the payment app (Venmo, PayPal and others can charge sellers on payments for goods), not by OfferUp. OfferUp doesn’t handle payment for in-person sales and calls cash the safest way to get paid.",
      source: S.paid,
    });
  }

  const notes: string[] = [
    "The 12.9% fee many sites still quote applied only to shipped sales, and OfferUp ended shipping on October 21, 2025. A local sale costs you and your buyer nothing in OfferUp fees.",
  ];
  if (promotion === "none") {
    notes.push("Promoting? Promote Plus is $19.99 a month or $99.99 a year. Pick it above to see what it costs per sale.");
  } else if (promotion !== "single") {
    notes.push("First time? Promote Plus starts with a 3-day free trial. Cancel at least 24 hours before it (or any renewal) ends; there are no prorated refunds.");
  }
  if (app) notes.push("That fee is your payment app’s, not OfferUp’s. OfferUp says cash is the safest way to get paid.");

  const costs = costLines(inputs, market).map((l) => (l.id === "otherCost" ? { ...l, label: "Gas, cleaning & other costs" } : l));

  return assemble({
    market,
    buyerPays: price,
    saleAmount: price,
    fees,
    costs,
    notes: notes.slice(0, 3),
  });
}

function schedule(): ScheduleRow[] {
  return [
    { fee: "Selling fee / commission", amount: "$0 (0%)", appliesTo: "Local, in-person sales", when: "Every sale", source: S.whatIs },
    { fee: "Buyer fee", amount: "$0", appliesTo: "The buyer pays you directly, in person", when: "Every sale", source: S.terms },
    {
      fee: "Shipping service fee",
      amount: "None now (was 12.9%, min. $1.99)",
      appliesTo: "Item price on shipped sales, not shipping",
      when: "Ended with shipping on October 21, 2025",
      source: S.shippingOld,
    },
    {
      fee: "Listing",
      amount: "Free up to a monthly limit",
      appliesTo: "Per category: Cars & Trucks 1, Motorcycles 1, Appliances 15, Cell Phones 15, Furniture 25, Jewelry 25, Tools 25, all others 200 combined",
      when: "Limits reset on the 1st of each month",
      source: S.limits,
    },
    { fee: "Paid listing", amount: "Varies by category (shown in the app)", appliesTo: "Each listing over the free limit", when: "Only after the month’s free listings run out; no refunds", source: S.single },
    {
      fee: "Listing subscription",
      amount: "Varies by category and package",
      appliesTo: "A monthly bundle of listings in one category",
      when: "Optional: Appliances, Cars & Trucks, Cell Phones, Furniture, Jewelry, Tools",
      source: S.subs,
    },
    { fee: "Promotion (1 or 3 days)", amount: "Shown in the app", appliesTo: "One item", when: "Optional; can’t be canceled", source: S.promote },
    { fee: "Promote Plus", amount: "$19.99/month or $99.99/year", appliesTo: "One promoted item at a time, switch anytime", when: "Optional; 3-day free trial for first-time users", source: S.plus },
    { fee: "OfferUp Premium", amount: "$7.99/month", appliesTo: "Buyer membership: early access to new listings", when: "Optional", source: S.premium },
    { fee: "Job listing", amount: "$25.00 per listing (introductory price)", appliesTo: "One job post, live 30 days", when: "Businesses hiring", source: S.jobs },
    { fee: "Services subscription", amount: "$75/month (longer plans cost less)", appliesTo: "One service listing", when: "Service providers", source: S.services },
  ];
}

const PROMOTION_OPTIONS: SelectOption[] = [
  { value: "none", label: "No promotion" },
  { value: "plus-monthly", label: "Promote Plus, monthly", hint: "$19.99 a month" },
  { value: "plus-yearly", label: "Promote Plus, yearly", hint: "$99.99 a year" },
  { value: "single", label: "1- or 3-day promotion", hint: "enter what you paid" },
];

export const offerup: CalculatorDef = {
  slug: "offerup",
  name: "OfferUp",
  path: "/offerup-fee-calculator",
  category: "marketplaces",
  priceNoun: "sale price",
  sellerNoun: "seller",
  blurb: "No selling or buyer fee on local sales; optional Promote Plus $19.99/month",
  costsHint: "What you paid for it, gas, cleaning. Optional.",
  markets: MARKETS,
  defaultMarket: "us",
  priceField: "price",
  fields: [
    { id: "price", kind: "money", label: "Price you’re selling for", section: "sale", help: "What the buyer pays you at the meetup. OfferUp takes none of it and adds nothing for the buyer." },
    {
      id: "category",
      kind: "select",
      label: "What are you selling?",
      section: "sale",
      advanced: true,
      options: CATEGORIES.map((c) => ({ value: c.value, label: c.label, hint: `${c.free} free a month${c.value === "other" ? ", combined" : ""}` })),
      help: "Sets how many listings you can post free each month before OfferUp charges to post.",
    },
    {
      id: "listingFee",
      kind: "money",
      label: "Paid to post this listing",
      section: "sale",
      advanced: true,
      help: "Only if this month’s free listings in the category ran out: the price the app showed, or a listing subscription’s monthly price divided by its listings.",
    },
    {
      id: "payMethod",
      kind: "segmented",
      label: "How does the buyer pay you?",
      section: "sale",
      advanced: true,
      options: [
        { value: "cash", label: "Cash / no fee" },
        { value: "app", label: "App with a fee" },
      ],
      help: "OfferUp doesn’t handle the payment. A payment app may charge you its own fee.",
    },
    {
      id: "appRate",
      kind: "percent",
      label: "Payment app’s fee rate",
      section: "sale",
      advanced: true,
      max: 10,
      step: 0.01,
      help: "From your app’s fee page (fees for receiving payment for goods).",
      showIf: (i) => str(i, "payMethod", "cash") === "app",
    },
    { id: "appFixed", kind: "money", label: "Plus a fixed fee per payment", section: "sale", advanced: true, showIf: (i) => str(i, "payMethod", "cash") === "app" },
    {
      id: "promotion",
      kind: "select",
      label: "Did you pay to promote it?",
      section: "options",
      options: PROMOTION_OPTIONS,
      help: "Promotions are optional, and they’re the main thing OfferUp charges sellers for.",
    },
    {
      id: "promoCost",
      kind: "money",
      label: "What you paid to promote it",
      section: "options",
      help: "Add up every promotion you bought for this item. OfferUp shows prices in the app; it doesn’t publish a list.",
      showIf: (i) => str(i, "promotion", "none") === "single",
    },
    {
      id: "salesPerMonth",
      kind: "number",
      label: "Items you sell a month",
      section: "options",
      integer: true,
      min: 1,
      max: 500,
      help: "We split monthly subscriptions evenly across these sales.",
      showIf: (i) => str(i, "promotion", "none").startsWith("plus") || bool(i, "premium"),
    },
    {
      id: "premium",
      kind: "toggle",
      label: "I pay for OfferUp Premium ($7.99 a month)",
      section: "options",
      advanced: true,
      help: "A buyer membership with early access to new listings. Count it if you use it to find items you resell.",
    },
    { id: "itemCost", kind: "money", label: "What you paid for it", section: "costs", help: "If you bought it to resell." },
    { id: "otherCost", kind: "money", label: "Gas, cleaning & other costs", section: "costs" },
  ],
  defaults: () => ({
    price: 100,
    category: "other",
    listingFee: 0,
    payMethod: "cash",
    appRate: 0,
    appFixed: 0,
    promotion: "none",
    promoCost: 0,
    salesPerMonth: 1,
    premium: false,
    itemCost: 0,
    otherCost: 0,
  }),
  calculate,
  // Every fee is either a fixed amount or (payment app) one percentage of the whole price: the
  // payout rises steadily with the price and never changes shape, so there are no breakpoints.
  breakpoints: () => [],
  verifiedAt: "2026-10-23",
  sources,
  changes,
  schedule,
  compare: {
    group: "sell",
    map: (c) => ({ price: c.price, itemCost: c.itemCost }),
    note: "Local pickup only, no shipping",
  },
};

export default offerup;
