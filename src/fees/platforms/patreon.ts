/*
 * Patreon creator fees. Every number is from Patreon's own pages (see `sources`), re-read on
 * 2026-10-23 through the help center's public JSON API (the HTML pages answer plain HTTP with a
 * Cloudflare 403). Research notes with verbatim quotes: research/fees/patreon.md.
 *
 * What one month of membership income goes through (what this module reproduces):
 *  - Platform fee: the plan's percentage of what members pay, excluding sales tax/VAT. Standard plan
 *    10% (pages published after 2025-08-04, or legacy pages that were unpublished and republished);
 *    legacy Pro 8%, Pro + Merch 11%, Founders 5%. On iOS in-app purchases it is charged on the
 *    (higher) app price.
 *  - Payment processing: a percentage of each payment INCLUDING tax, plus a fixed fee per payment in
 *    the payout currency. Standard plan: one rate for every amount. Legacy plans: micropayment rate
 *    when the tier price is at or below a local threshold ($3), standard rate above. Founders (USD
 *    only): 1.6% + $0.30 cards, 2.65% + $0.28 PayPal/Venmo. We work on a month's total, so the fixed
 *    fee is multiplied by the number of paid members and the threshold is tested on the average
 *    pledge (income ÷ members).
 *  - Currency conversion: 2.5% of payments made in another currency than the payout currency,
 *    tax included.
 *  - iOS in-app purchases: Apple takes 30% (15% after a year subscribed; 25% / 12% for members in
 *    China) of the app price, Patreon charges no processing. By default the app price is the list
 *    price ÷ (1 − 30%); one-time purchases are then rounded to the nearest 50 cents (documented only
 *    for one-time purchases, so memberships are not rounded here).
 *  - Tax on the platform fee where the law requires it (rate depends on the creator's location).
 *  - Payout fee: per withdrawal, by method and payout currency; percentage fees apply to the amount
 *    withdrawn (we withdraw the month's net in equal parts).
 * Patreon publishes no rounding rule; each line is rounded to the cent once (half away from zero).
 */
import { M } from "../markets";
import { assemble, bool, formatRate, moneyFor, num, pct, roundCents, str, toCents } from "../money";
import type { CalculatorDef, FeeChange, Inputs, Line, Market, ScheduleRow, SelectOption, Source } from "../types";

/** Creators outside the US who keep US dollars as their payout currency (different payout methods). */
const USD_INTL: Market = { ...M.us, id: "usd", label: "Outside the US, paid in US$", flag: "🌍" };
/** Euro payout currency: the same rates in every euro country. */
const EURO: Market = { ...M.ie, id: "eu", label: "Euro countries", flag: "🇪🇺" };

const MARKETS: Market[] = [M.us, USD_INTL, M.uk, EURO, M.ca, M.au, M.nz, M.se, M.dk, M.no, M.pl];

const S = {
  overview: "patreon-fees-overview",
  standard: "patreon-standard-plan",
  faq: "patreon-fees-faq",
  founders: "patreon-founders",
  pricing: "patreon-pricing",
  ios: "patreon-ios",
  iosFaq: "patreon-ios-faq",
  iosShop: "patreon-ios-shop",
  taxFees: "patreon-tax-on-fees",
  fx: "patreon-currency",
  payoutsIntl: "patreon-payouts-intl",
  shop: "patreon-one-time",
  announce: "patreon-2025-pricing",
  epic: "patreon-epic-ruling",
  billing: "patreon-subscription-billing",
} as const;

const hc = (id: string, slug: string, title: string): Omit<Source, "id"> => ({
  title,
  url: `https://support.patreon.com/hc/en-us/articles/${id}-${slug}`,
  publisher: "Patreon Help Center",
  checked: "2026-10-23",
  watch: `https://support.patreon.com/api/v2/help_center/en-us/articles/${id}.json`,
});

const sources: Source[] = [
  { ...hc("11111747095181", "Creator-fees-overview", "Creator fees overview"), id: S.overview },
  {
    ...hc("36426991446797", "A-standard-platform-fee-for-new-creators-effective-after-August-4-2025", "A standard platform fee for new creators — effective after August 4, 2025"),
    id: S.standard,
  },
  { ...hc("22581195376909", "Creator-fees-FAQ", "Creator fees FAQ"), id: S.faq },
  { ...hc("9943809610253", "What-is-the-Founders-plan", "What is the Founders plan?"), id: S.founders },
  { id: S.pricing, title: "Patreon Pricing Plans", url: "https://www.patreon.com/pricing", publisher: "Patreon", checked: "2026-10-23" },
  { ...hc("27991664769677", "How-iOS-in-app-purchases-work-on-Patreon", "How iOS in-app purchases work on Patreon"), id: S.ios },
  { ...hc("27992151772813", "iOS-in-app-purchases-FAQ", "iOS in-app purchases FAQ"), id: S.iosFaq },
  { ...hc("20009513905933", "How-iOS-in-app-payment-works-for-one-time-purchases", "How iOS in-app payment works for one-time purchases"), id: S.iosShop },
  { ...hc("16477355698957", "Taxes-on-creator-fees", "Taxes on creator fees"), id: S.taxFees },
  { ...hc("360044469871", "How-tiers-are-converted-into-other-currencies", "How tiers are converted into other currencies"), id: S.fx },
  { ...hc("39694936541965", "Payouts-guide-for-creators-outside-of-the-US", "Payouts guide for creators outside of the US"), id: S.payoutsIntl },
  { ...hc("16303719836813", "Selling-one-time-purchases-on-Patreon", "Selling one-time purchases on Patreon"), id: S.shop },
  {
    id: S.announce,
    title: "We’re increasing our prices for new creators. Existing creators will not see any increase.",
    url: "https://www.patreon.com/PatreonforCreators/posts/were-increasing-130695366",
    publisher: "Patreon for Creators (official announcement)",
    checked: "2026-10-23",
    watch: "https://www.patreon.com/api/posts/130695366",
  },
  {
    id: S.epic,
    title: "U.S. court rules that you no longer have to give Apple 30% of your iOS earnings",
    url: "https://www.patreon.com/PatreonforCreators/posts/u-s-court-rules-128009451",
    publisher: "Patreon for Creators (official announcement)",
    checked: "2026-10-23",
    watch: "https://www.patreon.com/api/posts/128009451",
  },
  {
    id: S.billing,
    title: "Reminder: All creators must be on subscription billing by November 1",
    url: "https://www.patreon.com/PatreonforCreators/posts/reminder-all-be-170931602",
    publisher: "Patreon for Creators (official announcement)",
    checked: "2026-10-23",
    watch: "https://www.patreon.com/api/posts/170931602",
  },
];

const changes: FeeChange[] = [
  {
    date: "2026-11-01",
    text: "Creators still on first-of-the-month or per-creation billing must be on subscription billing (Apple’s requirement); accounts not switched are moved automatically in November, and per-creation accounts have billing paused until the creator reviews the new monthly prices. Fee rates don’t change.",
    source: S.billing,
    upcoming: true,
  },
  {
    date: "2026-04",
    text: "Members in China who join through Apple’s in-app purchase: Apple’s fee is 25% in the first year and 12% after a year (Apple changed it in March 2026; Patreon applies it to new memberships from April 2026).",
    source: S.ios,
  },
  {
    date: "2025-08-04",
    text: "New creator pages pay a standard 10% platform fee (Pro 8% and Premium 12% merged into one plan) and standard processing rates with no micropayment rate. Pages published on or before August 4, 2025 keep their plan unless they are unpublished.",
    source: S.announce,
  },
  {
    date: "2025-05-22",
    text: "One-time purchases: creators who start selling digital products after this date pay their plan’s platform fee (5%–12%) instead of a flat 5%.",
    source: S.overview,
  },
  {
    date: "2025-05-02",
    text: "After the Epic v. Apple ruling of April 30, 2025, Patreon added a web checkout option for US fans in the iOS app, which avoids Apple’s 30% fee.",
    source: S.epic,
  },
  {
    date: "2024-11-04",
    text: "New memberships bought in the Patreon iOS app go through Apple’s in-app purchase, with Apple’s 30% fee (one-time purchases in the app already did since January 2024). Patreon charges no processing fee on them.",
    source: S.iosFaq,
  },
];

/* ---------- Rates ---------- */

interface Rate {
  pct: number;
  /** Fixed fee per payment, cents of the payout currency. */
  fixed: number;
}

interface CurrencyRates {
  /** Standard plan (any amount) and legacy plans above the threshold. */
  std: Rate;
  /** Legacy plans, tier price at or below `threshold`. */
  micro: Rate;
  /** Micropayment threshold, cents. */
  threshold: number;
  /** USD only: PayPal / Venmo payments from members outside the US. */
  stdPaypalIntl?: Rate;
  microPaypalIntl?: Rate;
}

const USD_RATES: CurrencyRates = {
  std: { pct: 2.9, fixed: 30 },
  micro: { pct: 5, fixed: 10 },
  threshold: 300,
  stdPaypalIntl: { pct: 3.9, fixed: 30 },
  microPaypalIntl: { pct: 6, fixed: 10 },
};

/** Creator fees overview, "Processing rates — non-USD payout currency" (standard and legacy tables). */
const RATES: Record<string, CurrencyRates> = {
  us: USD_RATES,
  usd: USD_RATES,
  uk: { std: { pct: 3.4, fixed: 35 }, micro: { pct: 5, fixed: 15 }, threshold: 300 },
  eu: { std: { pct: 3.4, fixed: 35 }, micro: { pct: 5, fixed: 15 }, threshold: 300 },
  ca: { std: { pct: 3.2, fixed: 35 }, micro: { pct: 5, fixed: 10 }, threshold: 300 },
  au: { std: { pct: 3, fixed: 30 }, micro: { pct: 5, fixed: 10 }, threshold: 300 },
  nz: { std: { pct: 3.9, fixed: 45 }, micro: { pct: 5, fixed: 25 }, threshold: 400 },
  se: { std: { pct: 3.4, fixed: 325 }, micro: { pct: 5, fixed: 150 }, threshold: 3000 },
  dk: { std: { pct: 3.4, fixed: 260 }, micro: { pct: 5, fixed: 110 }, threshold: 2500 },
  no: { std: { pct: 3.4, fixed: 280 }, micro: { pct: 5, fixed: 150 }, threshold: 3000 },
  pl: { std: { pct: 3.4, fixed: 175 }, micro: { pct: 5, fixed: 70 }, threshold: 1500 },
};

/** Founders plan processing, US-dollar payouts only. */
const FOUNDERS = { card: { pct: 1.6, fixed: 30 }, paypal: { pct: 2.65, fixed: 28 } };

/** Currency conversion fee, percent of the full payment including tax. */
const FX_RATE = 2.5;

type PlanId = "standard" | "pro" | "proMerch" | "founders";
const PLANS: Record<PlanId, { rate: number; name: string }> = {
  standard: { rate: 10, name: "Standard" },
  pro: { rate: 8, name: "Pro" },
  proMerch: { rate: 11, name: "Pro + Merch" },
  founders: { rate: 5, name: "Founders" },
};

const APPLE_RATES = ["30", "15", "25", "12"] as const;

/* ---------- Payout methods ---------- */

interface PayoutMethod {
  id: string;
  label: string;
  hint: string;
  fixed?: number;
  pct?: number;
  min?: number;
  max?: number;
  /** Smallest withdrawal allowed, cents. */
  minPayout?: number;
  explain: string;
  source: string;
}

const PAYPAL_USD: PayoutMethod = {
  id: "paypal",
  label: "PayPal",
  hint: "1%, min $0.25, max $20",
  pct: 1,
  min: 25,
  max: 2000,
  minPayout: 1000,
  explain: "1% of each withdrawal, at least $0.25 and never more than $20. You need at least $10 to withdraw. PayPal may charge its own fees to move the money on to your bank.",
  source: S.overview,
};

/** Local-currency payout fees per withdrawal: bank transfer, Payoneer, PayPal (cents). */
const LOCAL_PAYOUT: Record<string, [number, number, number]> = {
  uk: [50, 75, 100],
  eu: [50, 75, 100],
  ca: [75, 200, 100],
  au: [75, 100, 150],
  nz: [100, 150, 300],
  se: [500, 700, 900],
  dk: [400, 500, 700],
  no: [500, 700, 900],
  pl: [200, 300, 500],
};

function payoutMethods(market: Market): PayoutMethod[] {
  const money = moneyFor(market);
  if (market.id === "us") {
    return [
      {
        id: "stripe",
        label: "Direct deposit",
        hint: "$0.25",
        fixed: 25,
        explain: "$0.25 per withdrawal to a US bank account (processed by Stripe). Not available in US territories other than Puerto Rico.",
        source: S.overview,
      },
      PAYPAL_USD,
    ];
  }
  if (market.id === "usd") {
    return [
      PAYPAL_USD,
      {
        id: "bankLocal",
        label: "Bank transfer to a local-currency account",
        hint: "1.55% + $0.25",
        pct: 1.55,
        fixed: 25,
        minPayout: 1000,
        explain: "Your US dollars are converted and sent to your bank in your own currency through Payoneer: 1.55% of the withdrawal plus $0.25, with no other conversion fee. Minimum $10.",
        source: S.payoutsIntl,
      },
      {
        id: "bankUsd",
        label: "Bank transfer to a US-dollar account",
        hint: "$0.50",
        fixed: 50,
        explain: "$0.50 per withdrawal to a US-dollar bank account (pick the United States as your bank country, for example with a Wise USD account).",
        source: S.payoutsIntl,
      },
      {
        id: "payoneer",
        label: "Payoneer Wallet",
        hint: "$1.00",
        fixed: 100,
        minPayout: 2500,
        explain: "$1.00 per withdrawal to your Payoneer account; at least $25 per withdrawal. Payoneer charges its own fees to move the money to your bank.",
        source: S.payoutsIntl,
      },
    ];
  }
  const [bank, payoneer, paypal] = LOCAL_PAYOUT[market.id] ?? LOCAL_PAYOUT.uk;
  return [
    {
      id: "bank",
      label: "Bank transfer",
      hint: money(bank),
      fixed: bank,
      explain: `A flat ${money(bank)} per withdrawal sent to your bank in ${market.currency} (processed by Payoneer). Minimum $10 or the local equivalent.`,
      source: S.overview,
    },
    {
      id: "payoneer",
      label: "Payoneer",
      hint: money(payoneer),
      fixed: payoneer,
      explain: `A flat ${money(payoneer)} per withdrawal to Payoneer. Payoneer may charge its own fees to move the money on.`,
      source: S.overview,
    },
    {
      id: "paypal",
      label: "PayPal",
      hint: money(paypal),
      fixed: paypal,
      explain: `A flat ${money(paypal)} per withdrawal to PayPal. PayPal may charge its own fees to move the money to your bank.`,
      source: S.overview,
    },
  ];
}

const DEFAULT_PAYOUT: Record<string, string> = { us: "stripe", usd: "paypal" };

/* ---------- Helpers ---------- */

function planOf(inputs: Inputs): PlanId {
  const p = str(inputs, "plan", "standard");
  return p in PLANS ? (p as PlanId) : "standard";
}

const isShop = (inputs: Inputs) => str(inputs, "sellType", "membership") === "shop";
const isUsd = (market: Market) => market.currency === "USD";
const share = (inputs: Inputs, id: string) => Math.min(100, Math.max(0, num(inputs, id)));
/** Founders processing rates apply to Founders memberships paid out in US dollars. */
const foundersRates = (inputs: Inputs, market: Market) => planOf(inputs) === "founders" && isUsd(market) && !isShop(inputs);

function rateText(r: Rate, money: (c: number) => string): string {
  return `${formatRate(r.pct)} + ${money(r.fixed)}`;
}

/** Split `total` cents across `part` of `whole` payments, proportionally. */
function portion(total: number, part: number, whole: number): number {
  if (part <= 0 || whole <= 0) return 0;
  return part >= whole ? total : Math.round((total * part) / whole);
}

const plural = (n: number, w: string) => `${n.toLocaleString("en-US")} ${w}${n === 1 ? "" : "s"}`;

/* ---------- Calculation ---------- */

function calculate(inputs: Inputs, market: Market) {
  const money = moneyFor(market);
  const usd = isUsd(market);
  const shop = isShop(inputs);
  const plan = planOf(inputs);
  const legacy = plan !== "standard";
  const rates = RATES[market.id] ?? USD_RATES;

  const income = toCents(num(inputs, "earnings"));
  const payments = Math.max(1, Math.round(num(inputs, "members", 1)));
  const avg = income / payments;

  // Who paid through Apple's in-app purchase in the iOS app.
  const iosCount = Math.round((payments * share(inputs, "iosShare")) / 100);
  const iosList = portion(income, iosCount, payments);
  const raise = str(inputs, "iosPricing", "raise") !== "absorb";
  let iosSale = iosList;
  if (iosCount > 0 && raise) {
    // List price ÷ (1 − 30%); one-time purchases are then rounded to the nearest 50 cents.
    iosSale = shop ? Math.round(iosList / iosCount / 0.7 / 50) * 50 * iosCount : roundCents(iosList / 0.7);
  }
  const webCount = payments - iosCount;
  const webIncome = income - iosList;
  const taxRate = Math.max(0, num(inputs, "taxRate"));
  const webTax = pct(webIncome, taxRate);
  const webGross = webIncome + webTax;
  const sale = webIncome + iosSale;

  const fees: Line[] = [];
  const notes: string[] = [];
  const warnings: string[] = [];

  // Platform fee.
  const early = shop && plan !== "founders" && bool(inputs, "earlySeller");
  const platformRate = early ? 5 : PLANS[plan].rate;
  const platform = pct(sale, platformRate);
  const iosBit = iosCount > 0 && raise ? " On in-app iPhone purchases it’s charged on the higher app price." : "";
  fees.push({
    id: "platform",
    label: `Platform fee (${formatRate(platformRate)})`,
    amount: platform,
    kind: "platform",
    detail: `${formatRate(platformRate)} × ${money(sale)}`,
    explain: early
      ? `Creators who started selling digital products before May 22, 2025 may still pay 5% on one-time purchases (your earnings report shows which rate you have). Charged on the sale price, not sales tax.${iosBit}`
      : plan === "standard"
        ? `10% of what members pay, excluding sales tax or VAT. Every page published after August 4, 2025 is on this plan, and so is any older page that was unpublished and republished.${iosBit}`
        : `${PLANS[plan].name} legacy plan: ${formatRate(platformRate)} of what members pay, excluding sales tax or VAT. You keep it only while your page stays published; unpublishing it, even briefly, moves you to 10%.${iosBit}`,
    source: S.overview,
  });

  // Payment processing on web/Android payments (Apple's fee replaces it on in-app purchases).
  if (webCount > 0) {
    const founders = foundersRates(inputs, market);
    const micro = !shop && legacy && !founders && avg <= rates.threshold;
    const base: Rate = founders ? FOUNDERS.card : micro ? rates.micro : rates.std;
    let special: Rate | undefined;
    let specialShare = 0;
    if (founders) {
      special = FOUNDERS.paypal;
      specialShare = share(inputs, "paypalShare");
    } else if (usd) {
      special = micro ? rates.microPaypalIntl : rates.stdPaypalIntl;
      specialShare = share(inputs, "paypalIntl");
    }
    const specialCount = special ? Math.round((webCount * specialShare) / 100) : 0;
    const specialGross = portion(webGross, specialCount, webCount);
    const mainCount = webCount - specialCount;
    const mainGross = webGross - specialGross;
    const taxBit = webTax ? " (tax included)" : ", including any sales tax or VAT,";

    let why: string;
    if (founders) why = "Founders processing rate for US-dollar payouts: 1.6% + $0.30 for cards and Apple Pay, 2.65% + $0.28 for PayPal and Venmo.";
    else if (shop) why = `One-time purchases pay the standard rate, ${rateText(rates.std, money)} per sale.`;
    else if (!legacy) why = `On the standard plan the rate is the same for every amount, so the fixed ${money(rates.std.fixed)} weighs most on small pledges.`;
    else if (micro)
      why = `Legacy plans pay the micropayment rate, ${rateText(rates.micro, money)}, when the tier price is ${money(rates.threshold)} or less (your average pledge is ${money(Math.round(avg))}). Above that it’s ${rateText(rates.std, money)}.`;
    else why = `Legacy plans pay ${rateText(rates.std, money)} on tiers above ${money(rates.threshold)}, and the micropayment rate, ${rateText(rates.micro, money)}, at or below it.`;
    const iosNote = iosCount > 0 ? " Payments made through Apple’s in-app purchase don’t pay it." : "";

    if (mainCount > 0) {
      fees.push({
        id: "processing",
        label: specialCount > 0 ? (founders ? "Payment processing: cards" : "Payment processing: cards & US PayPal") : "Payment processing",
        amount: pct(mainGross, base.pct) + base.fixed * mainCount,
        kind: "payment",
        detail: `${formatRate(base.pct)} × ${money(mainGross)} + ${money(base.fixed)} × ${plural(mainCount, "payment")}`,
        explain: `Charged on each payment${taxBit} plus a fixed fee per payment. ${why}${iosNote}`,
        source: S.overview,
      });
    }
    if (special && specialCount > 0) {
      fees.push({
        id: "processing-paypal",
        label: founders ? "Payment processing: PayPal / Venmo" : "Payment processing: PayPal / Venmo outside the US",
        amount: pct(specialGross, special.pct) + special.fixed * specialCount,
        kind: "payment",
        detail: `${formatRate(special.pct)} × ${money(specialGross)} + ${money(special.fixed)} × ${plural(specialCount, "payment")}`,
        explain: founders
          ? "Founders pay 2.65% + $0.28 on PayPal and Venmo payments, on the full payment including tax."
          : `Members outside the US who pay with PayPal or Venmo cost ${rateText(special, money)} per payment instead of ${rateText(base, money)}, on the full payment including tax.`,
        source: S.overview,
      });
    }
  }

  // Currency conversion.
  const fxShare = share(inputs, "fxShare");
  if (fxShare > 0) {
    const fxBase = Math.round(((webGross + iosSale) * fxShare) / 100);
    fees.push({
      id: "fx",
      label: "Currency conversion (2.5%)",
      amount: pct(fxBase, FX_RATE),
      kind: "payment",
      detail: `2.5% × ${money(fxBase)} (${formatRate(fxShare)} of payments)`,
      explain: `Patreon charges 2.5% on payments made in a different currency from your payout currency (${market.currency}), on the full amount including tax. It’s refunded if the payment is.`,
      source: S.overview,
    });
  }

  // Apple's App Store fee on in-app purchases.
  if (iosCount > 0) {
    const appleRaw = str(inputs, "appleRate", "30");
    const appleRate = shop ? 30 : (APPLE_RATES as readonly string[]).includes(appleRaw) ? Number(appleRaw) : 30;
    fees.push({
      id: "apple",
      label: `Apple App Store fee (${appleRate}%)`,
      amount: pct(iosSale, appleRate),
      // Apple's fee replaces Patreon's payment processing on these payments.
      kind: "payment",
      detail:
        raise && iosSale !== iosList
          ? `${appleRate}% × ${money(iosSale)} (app price for ${money(iosList)} of web prices${shop ? ", rounded to 50¢" : " ÷ 0.7"})`
          : `${appleRate}% × ${money(iosSale)}`,
      explain: shop
        ? "Apple takes 30% of the in-app price of one-time purchases made in the Patreon iOS app; Patreon charges no processing fee on them. By default the app price is about 43% higher than on the web, rounded to the nearest 50 cents."
        : "Apple takes 30% of the in-app price of memberships bought in the Patreon iOS app (15% after a member’s first year; 25% / 12% for members in China), and Patreon charges no processing fee on them. By default your app prices are about 43% higher to cover it. US fans can choose web checkout and avoid it.",
      source: shop ? S.iosShop : S.ios,
    });
  }

  // Tax on the platform fee.
  const feeTax = Math.max(0, num(inputs, "feeTax"));
  if (feeTax > 0) {
    fees.push({
      id: "feeTax",
      label: `Tax on platform fee (${formatRate(feeTax)})`,
      amount: pct(platform, feeTax),
      kind: "tax",
      detail: `${formatRate(feeTax)} × ${money(platform)}`,
      explain:
        "VAT, GST or US sales tax that Patreon adds on top of its platform fee where the law requires it, shown as its own line. Outside the US it’s usually waived once you give Patreon a valid VAT ID (not in South Africa, Switzerland, Indonesia or Malaysia).",
      source: S.taxFees,
    });
  }

  // Payout fee(s).
  const methods = payoutMethods(market);
  const method = methods.find((m) => m.id === str(inputs, "payout")) ?? methods.find((m) => m.id === (DEFAULT_PAYOUT[market.id] ?? "bank")) ?? methods[0];
  const withdrawals = Math.max(0, Math.round(num(inputs, "payoutsPerMonth", 1)));
  const balance = sale - fees.reduce((s, l) => s + l.amount, 0);
  if (withdrawals > 0 && balance > 0) {
    const each = balance / withdrawals;
    let fee = method.fixed ?? 0;
    if (method.pct) {
      let p = pct(Math.round(each), method.pct);
      if (method.min !== undefined) p = Math.max(method.min, p);
      if (method.max !== undefined) p = Math.min(method.max, p);
      fee += p;
    }
    const rule = method.pct
      ? `${formatRate(method.pct)} × ${money(Math.round(each))}${method.min !== undefined ? ` (min ${money(method.min)}, max ${money(method.max!)})` : ""}${method.fixed ? ` + ${money(method.fixed)}` : ""}`
      : money(fee);
    fees.push({
      id: "payout",
      label: `Payout fee: ${method.label}`,
      amount: fee * withdrawals,
      kind: "payout",
      detail: withdrawals > 1 ? `${rule} × ${withdrawals} withdrawals` : rule,
      explain: `${method.explain} Charged on every withdrawal and not shown in your Earnings dashboard’s fee breakdown.`,
      source: method.source,
    });
    if (method.minPayout && each < method.minPayout) {
      warnings.push(`${method.label} withdrawals must be at least ${money(method.minPayout)}; at ${money(Math.round(each))} each you’d have to wait for more earnings.`);
    }
  }

  if (shop && usd && avg < 300) warnings.push("Patreon’s minimum price for one-time purchases is $3.");
  if (shop && usd && avg > 500000) warnings.push("Patreon’s maximum price for one-time purchases is $5,000.");

  // Notes: at most three, most decision-changing first.
  if (!shop && legacy && !foundersRates(inputs, market) && payments > 1)
    notes.push(`We test the ${money(rates.threshold)} micropayment cut-off on your average pledge (${money(Math.round(avg))}). If some tiers are above it and some below, run each tier separately.`);
  if (foundersRates(inputs, market) && avg <= USD_RATES.threshold)
    notes.push("Patreon mentions micropayment rates for Founders tiers of $3 or less but publishes no Founders micropayment rate, so we use 1.6% + $0.30 (cards) at every price.");
  if (foundersRates(inputs, market)) notes.push("When one payment covers several Founders creators, they share the processing fee, so yours can be lower.");
  if (!usd && fxShare === 0) notes.push("Members paying in another currency (often US dollars) cost 2.5% more each. Set their share under More options.");
  if (!taxRate && webCount > 0) notes.push("Processing is also charged on sales tax or VAT your members pay. Add their rate under More options for the exact figure.");
  if (iosCount === 0 && notes.length < 3) notes.push("Members who join in the iPhone app pay through Apple, which takes 30%. Set their share under More options.");

  const buyerFees: Line[] = webTax
    ? [
        {
          id: "tax",
          label: `Sales tax / VAT (${formatRate(taxRate)})`,
          amount: webTax,
          kind: "tax",
          detail: `${formatRate(taxRate)} × ${money(webIncome)}`,
          explain: "Added on top of your price and passed on to the tax authorities by Patreon. It doesn’t reduce your earnings, but processing and currency conversion are charged on it.",
          source: S.overview,
        },
      ]
    : [];

  const costs: Line[] = [];
  const reward = toCents(num(inputs, "rewardCost"));
  const other = toCents(num(inputs, "otherCost"));
  if (reward) costs.push({ id: "rewardCost", label: "Rewards & merch you send", amount: reward, kind: "cost" });
  if (other) costs.push({ id: "otherCost", label: "Other monthly costs", amount: other, kind: "cost" });

  return assemble({
    market,
    buyerPays: webGross + iosSale,
    saleAmount: sale,
    fees,
    buyerFees,
    costs,
    notes: notes.slice(0, 3),
    warnings,
  });
}

/* ---------- Fee schedule ---------- */

function schedule(market: Market): ScheduleRow[] {
  const money = moneyFor(market);
  const rates = RATES[market.id] ?? USD_RATES;
  const usd = isUsd(market);
  const rows: ScheduleRow[] = [
    { fee: "Platform fee: standard plan", amount: "10%", appliesTo: "Membership and one-time payments, excluding sales tax/VAT", when: "Pages published after Aug 4, 2025", source: S.overview },
    { fee: "Platform fee: legacy plans", amount: "Pro 8% · Pro + Merch 11% · Founders 5%", appliesTo: "Same as above", when: "Published by Aug 4, 2025 and never unpublished", source: S.overview },
    {
      fee: "Payment processing: standard plan",
      amount: usd ? `${rateText(rates.std, money)} (PayPal/Venmo outside the US: ${rateText(rates.stdPaypalIntl!, money)})` : rateText(rates.std, money),
      appliesTo: "Each payment, including sales tax/VAT",
      when: "Any amount",
      source: S.overview,
    },
    {
      fee: "Payment processing: legacy plans",
      amount: usd
        ? `${rateText(rates.micro, money)} up to ${money(rates.threshold)} · ${rateText(rates.std, money)} above (PayPal/Venmo outside the US: ${rateText(rates.microPaypalIntl!, money)} · ${rateText(rates.stdPaypalIntl!, money)})`
        : `${rateText(rates.micro, money)} up to ${money(rates.threshold)} · ${rateText(rates.std, money)} above`,
      appliesTo: "Each payment, including sales tax/VAT; threshold on the tier price",
      when: usd ? "Pro, Pro + Merch" : "Pro, Pro + Merch, Founders",
      source: S.overview,
    },
  ];
  if (usd) rows.push({ fee: "Payment processing: Founders", amount: "1.6% + $0.30 card · 2.65% + $0.28 PayPal/Venmo", appliesTo: "Each payment, including sales tax", when: "Founders paid out in US dollars", source: S.overview });
  rows.push(
    { fee: "Currency conversion", amount: "2.5%", appliesTo: "The full payment, including tax", when: `Member pays in a currency other than ${market.currency}`, source: S.overview },
    { fee: "Apple App Store fee", amount: "30% (15% after a year; China 25% / 12%)", appliesTo: "The in-app price (no Patreon processing)", when: "Purchases through Apple in the iOS app", source: S.ios },
    { fee: "Tax on platform fee", amount: "Your local VAT/GST or sales tax", appliesTo: "The platform fee", when: "Where the law requires it", source: S.taxFees },
  );
  for (const m of payoutMethods(market)) rows.push({ fee: `Payout: ${m.label}`, amount: m.hint, appliesTo: "Each withdrawal", when: m.minPayout ? `Minimum ${money(m.minPayout)}` : "Per payout", source: m.source });
  return rows;
}

/* ---------- Definition ---------- */

const PLAN_OPTIONS: SelectOption[] = [
  { value: "standard", label: "Standard · 10%", hint: "Pages published after Aug 4, 2025" },
  { value: "pro", label: "Pro · 8% (legacy)", hint: "Published by Aug 4, 2025, never unpublished" },
  { value: "proMerch", label: "Pro + Merch · 11% (legacy)", hint: "Legacy plan with Merch fulfillment" },
  { value: "founders", label: "Founders · 5% (legacy)", hint: "Joined before May 7, 2019" },
];

const DEFAULTS: Record<string, { earnings: number; members: number }> = {
  se: { earnings: 5000, members: 100 },
  no: { earnings: 5000, members: 100 },
  dk: { earnings: 3500, members: 100 },
  pl: { earnings: 2000, members: 100 },
};

export const patreon: CalculatorDef = {
  slug: "patreon",
  name: "Patreon",
  path: "/patreon-fee-calculator",
  category: "creators",
  priceNoun: "monthly income",
  sellerNoun: "creator",
  saleNoun: "month of income",
  buyerNoun: "audience",
  costsHint: "Rewards, merch, software. Optional.",
  reverseHead: "Monthly income you need",
  blurb: "10% platform fee + 2.9% + $0.30 per payment + payout fee (US, standard plan)",
  markets: MARKETS,
  defaultMarket: "us",
  priceField: "earnings",
  fields: [
    {
      id: "earnings",
      kind: "money",
      label: "Monthly membership income",
      section: "sale",
      help: (i) =>
        isShop(i)
          ? "Your one-time sales this month, before sales tax or VAT, at the prices fans see on the web."
          : "Your tier prices × members for one month, before sales tax or VAT, at the prices fans see on the web.",
    },
    {
      id: "members",
      kind: "number",
      label: "Paid members",
      section: "sale",
      integer: true,
      min: 1,
      max: 1000000,
      unit: "members",
      help: (i) =>
        isShop(i)
          ? "Enter the number of sales: each one pays its own fixed processing fee."
          : "Each payment pays its own fixed processing fee, so 100 members at $5 cost more than 10 at $50. Selling one-time purchases? Enter the number of sales.",
    },
    {
      id: "plan",
      kind: "select",
      label: "Your Patreon plan",
      section: "sale",
      options: PLAN_OPTIONS,
      help: "Pages published after August 4, 2025 pay 10%. Unpublishing a legacy page, even briefly, moves it to 10%. Check Settings if unsure.",
    },
    {
      id: "sellType",
      kind: "segmented",
      label: "What is this income from?",
      section: "sale",
      advanced: true,
      options: [
        { value: "membership", label: "Memberships" },
        { value: "shop", label: "One-time purchases" },
      ],
      help: "Digital products, paid posts and collections pay the same platform fee, at the standard processing rate.",
    },
    {
      id: "earlySeller",
      kind: "toggle",
      label: "I started selling digital products before May 22, 2025",
      section: "sale",
      advanced: true,
      help: "Some early sellers kept a 5% fee on one-time purchases.",
      showIf: (i) => isShop(i) && planOf(i) !== "founders",
    },
    {
      id: "taxRate",
      kind: "percent",
      label: "Sales tax or VAT your members pay",
      section: "sale",
      advanced: true,
      max: 30,
      help: "Patreon adds it on top of your price. It isn’t taken from you, but processing is charged on it.",
    },
    {
      id: "payout",
      kind: "select",
      label: "How you withdraw",
      section: "options",
      options: (_i, m) => payoutMethods(m).map((p) => ({ value: p.id, label: p.label, hint: p.hint })),
      help: "Patreon charges a fee on each withdrawal from your balance.",
    },
    {
      id: "payoutsPerMonth",
      kind: "number",
      label: "Withdrawals this month",
      section: "options",
      advanced: true,
      integer: true,
      min: 0,
      max: 31,
      unit: "withdrawals",
      help: "Every withdrawal, partial ones included, pays its own fee. Enter 0 to leave the money in your balance.",
    },
    {
      id: "iosShare",
      kind: "percent",
      label: "Members who paid in the iPhone app",
      section: "options",
      advanced: true,
      max: 100,
      help: "Apple’s in-app purchase takes 30% instead of Patreon’s processing fee. US fans can choose web checkout and skip it.",
    },
    {
      id: "iosPricing",
      kind: "segmented",
      label: "Your prices in the iPhone app",
      section: "options",
      advanced: true,
      options: [
        { value: "raise", label: "Higher (default)" },
        { value: "absorb", label: "Same as web" },
      ],
      help: "By default Patreon raises app prices about 43% so you earn at least the same; “Same as web” means you absorb Apple’s fee.",
      showIf: (i) => share(i, "iosShare") > 0,
    },
    {
      id: "appleRate",
      kind: "select",
      label: "Apple’s cut",
      section: "options",
      advanced: true,
      options: [
        { value: "30", label: "30% · first year" },
        { value: "15", label: "15% · subscribed through Apple over a year" },
        { value: "25", label: "25% · members in China, first year" },
        { value: "12", label: "12% · members in China, after a year" },
      ],
      showIf: (i) => share(i, "iosShare") > 0 && !isShop(i),
    },
    {
      id: "fxShare",
      kind: "percent",
      label: "Members paying in another currency",
      section: "options",
      advanced: true,
      max: 100,
      help: "Patreon takes 2.5% of payments made in a currency other than your payout currency, tax included.",
    },
    {
      id: "paypalIntl",
      kind: "percent",
      label: "Members outside the US paying by PayPal or Venmo",
      section: "options",
      advanced: true,
      max: 100,
      help: "They cost 3.9% + $0.30 per payment instead of 2.9% + $0.30 (legacy micropayments: 6% + $0.10).",
      showIf: (i, m) => isUsd(m) && !foundersRates(i, m),
    },
    {
      id: "paypalShare",
      kind: "percent",
      label: "Members paying by PayPal or Venmo",
      section: "options",
      advanced: true,
      max: 100,
      help: "Founders rate: 2.65% + $0.28 per PayPal or Venmo payment, 1.6% + $0.30 for cards.",
      showIf: (i, m) => foundersRates(i, m),
    },
    {
      id: "feeTax",
      kind: "percent",
      label: "Tax Patreon adds to its fee",
      section: "options",
      advanced: true,
      max: 30,
      help: "VAT/GST or sales tax on the platform fee where the law requires it (e.g. 10% GST in Australia without a GST number).",
    },
    { id: "rewardCost", kind: "money", label: "Rewards & merch you send", section: "costs", help: "What your physical rewards and their postage cost you this month." },
    { id: "otherCost", kind: "money", label: "Other monthly costs", section: "costs", help: "Software, production, contractors." },
  ],
  defaults: (market) => ({
    earnings: DEFAULTS[market.id]?.earnings ?? 500,
    members: DEFAULTS[market.id]?.members ?? 100,
    plan: "standard",
    sellType: "membership",
    earlySeller: false,
    taxRate: 0,
    payout: DEFAULT_PAYOUT[market.id] ?? "bank",
    payoutsPerMonth: 1,
    iosShare: 0,
    iosPricing: "raise",
    appleRate: "30",
    fxShare: 0,
    paypalIntl: 0,
    paypalShare: 0,
    feeTax: 0,
    rewardCost: 0,
    otherCost: 0,
  }),
  calculate,
  breakpoints: (inputs, market) => {
    // Legacy memberships switch from the micropayment rate to the standard rate (a higher fixed fee)
    // once the average pledge passes the threshold: the take can drop there.
    if (isShop(inputs) || planOf(inputs) === "standard" || foundersRates(inputs, market)) return [];
    const rates = RATES[market.id] ?? USD_RATES;
    const payments = Math.max(1, Math.round(num(inputs, "members", 1)));
    return [rates.threshold * payments + 1];
  },
  verifiedAt: "2026-10-23",
  sources,
  changes,
  schedule,
};

export default patreon;
