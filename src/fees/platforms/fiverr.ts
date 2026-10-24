/*
 * Fiverr fees for sellers (Fiverr calls them freelancers). Every number is from Fiverr's own pages
 * (see `sources`), re-read on 2026-10-23: the Payment Terms (page dated "Last update: October
 * 2026"), the Terms of Service, and help-center articles through their Zendesk JSON twins. Older
 * values in `changes` come from Internet Archive copies of the Payment Terms. Research notes with
 * verbatim quotes: research/fees/fiverr.md.
 *
 * How one order is computed (what this module reproduces):
 *  - Purchase amount = package price × quantity + extras (or the custom offer), after any coupon or
 *    promotion the seller funds. Hourly contracts: hourly rate × hours on the weekly report.
 *  - Fiverr keeps 20% of every purchase (orders, extras, custom offers, milestones, tips, hourly
 *    weekly reports); the seller is credited 80%. No tiers, caps or level discounts. A seller's
 *    coupon or promotion comes out of the seller's side: the 20% is charged on the discounted price.
 *  - Extras bought mid-order and tips are separate payments: each gets its own 20% line here, the
 *    way the earnings page lists them, and each carries its own buyer service fee.
 *  - Early Payout (optional, Top Rated / Seller Plus Premium, not hourly): 1% of the seller's
 *    earnings on the order, not of the order total.
 *  - India: GST TCS 0.5% and Section 194-O TDS (0.1% with a PAN on file, 5% without), both on the
 *    total transaction price (100% of the Gig amount, not the 80% the seller receives).
 *  - Withdrawal: a flat US-dollar fee per withdrawal, charged by the payment provider (PayPal $0,
 *    Payoneer $1 or $3, Revenue Card $1 or $3), at most US$5,000 per withdrawal, shown as a payout
 *    line. Larger balances take several withdrawals, each paying the fee.
 *  - The buyer's side (5.5% service fee on every payment, plus US$3.50 on purchases under US$200;
 *    hourly: 5.5% weekly plus a one-time US$5 order initiation fee) is shown in `buyerFees`. It
 *    never reduces the seller's earnings. VAT/GST/US sales tax on the buyer's side is not modelled.
 * Fiverr doesn't publish a rounding rule; each line is rounded to the cent separately (half away
 * from zero), and the checkout / earnings page is the final word.
 * Every Fiverr amount is in US dollars, whatever the seller's country, so every market here is a
 * USD market; the market only changes the withdrawal options and India's withholding taxes.
 */
import { M } from "../markets";
import { assemble, bool, formatRate, moneyFor, num, pct, roundCents, str, toCents } from "../money";
import type { CalculatorDef, FeeChange, Inputs, Line, Market, ScheduleRow, Source } from "../types";

const USD = { currency: "USD", locale: "en-US" } as const;
const INDIA: Market = { ...M.in, ...USD };
const OTHER: Market = { id: "intl", label: "Other countries", currency: "USD", locale: "en-US", flag: "🌍" };
const MARKETS: Market[] = [M.us, INDIA, OTHER];

/** Fiverr's commission, percent of each purchase (seller keeps 80%). */
export const COMMISSION = 20;
/** Buyer service fee, percent of each payment. */
export const SERVICE_FEE = 5.5;
/** Small order fee (cents) on purchases strictly under SMALL_ORDER_LIMIT, since September 2025. */
export const SMALL_ORDER_FEE = 350;
export const SMALL_ORDER_LIMIT = 20000;
/** One-time fee (cents) the client pays to start an hourly contract. */
const HOURLY_INITIATION = 500;
/** Early Payout, percent of the seller's earnings on the order. */
const EARLY_PAYOUT = 1;
/** Largest single withdrawal, cents. */
const MAX_WITHDRAWAL = 500000;
const MIN_GIG = 500;
const MIN_HOURLY = 725;
const MIN_TIP = 500;
const MAX_COUPON = 30;
const MIN_COUPON_ORDER = 1500;
const TCS_RATE = 0.5;

const S = {
  terms: "fiverr-payment-terms",
  tos: "fiverr-tos",
  paying: "fiverr-paying",
  earnings: "fiverr-earnings",
  tips: "fiverr-tips",
  withdraw: "fiverr-withdraw",
  paypal: "fiverr-paypal",
  payoneer: "fiverr-payoneer",
  early: "fiverr-early-payout",
  orders: "fiverr-orders",
  sellerPlus: "fiverr-seller-plus",
  kickstart: "fiverr-kickstart",
  growth: "fiverr-growth-tools",
  hourly: "fiverr-hourly-freelancers",
  hourlyClients: "fiverr-hourly-clients",
  pro: "fiverr-pro-freelancer",
  india: "fiverr-india-tax",
  tax: "fiverr-buyer-taxes",
  archive2024: "fiverr-terms-2024-04",
  archive2025a: "fiverr-terms-2025-04",
  archive2025b: "fiverr-terms-2025-08",
} as const;

const help = (id: string, title: string, sourceId: string): Source => ({
  id: sourceId,
  title,
  url: `https://help.fiverr.com/hc/en-us/articles/${id}`,
  publisher: "Fiverr Help Center",
  checked: "2026-10-23",
  watch: `https://help.fiverr.com/api/v2/help_center/en-us/articles/${id}.json`,
});

const TERMS_URL = "https://www.fiverr.com/legal-portal/legal-terms/payment-terms-of-service";
const archived = (stamp: string, label: string, sourceId: string): Source => ({
  id: sourceId,
  title: `Payment Terms (as archived ${label})`,
  url: `https://web.archive.org/web/${stamp}/${TERMS_URL}`,
  publisher: "Fiverr (Internet Archive copy)",
  checked: "2026-10-23",
});

const sources: Source[] = [
  { id: S.terms, title: "Payment Terms", url: TERMS_URL, publisher: "Fiverr", checked: "2026-10-23" },
  { id: S.tos, title: "Fiverr's Terms of Service", url: "https://www.fiverr.com/legal-portal/legal-terms/terms-of-service", publisher: "Fiverr", checked: "2026-10-23" },
  help("360050216133", "Paying for orders, extras, or custom offers", S.paying),
  help("9234443621137", "Your earnings page", S.earnings),
  help("360049982453", "Tipping your freelancer", S.tips),
  help("360010530058", "Withdrawing your earnings & managing payout methods", S.withdraw),
  help("360011149477", "Setting up PayPal as a payout method", S.paypal),
  help("14257019400465", "Setting up Payoneer as a payout method", S.payoneer),
  help("4402267122449", "Early Payout", S.early),
  help("360010639617", "Managing your orders: A freelancer's guide to the Fiverr order process", S.orders),
  help("360017140717", "Seller Plus Standard and Premium: Advanced tools for business growth", S.sellerPlus),
  help("27291415082257", "Seller Plus Kickstart: Start your freelance journey strong", S.kickstart),
  help("5244747923985", "Growth Tools for Seller Plus", S.growth),
  help("27516246556945", "Hourly work for freelancers", S.hourly),
  help("41442865361809", "Hourly orders for clients", S.hourlyClients),
  help("29453184449169", "Fiverr Pro freelancer: Badge and benefits", S.pro),
  help("360015233918", "India Sellers Tax", S.india),
  help("360010453457", "Taxes on purchases", S.tax),
  archived("20240401085036", "April 1, 2024", S.archive2024),
  archived("20250426095619", "April 26, 2025", S.archive2025a),
  archived("20250806000405", "August 6, 2025", S.archive2025b),
];

const changes: FeeChange[] = [
  {
    date: "2025-09-01",
    text: "The US$3.50 small order fee now applies to purchases under US$200 (it was under US$100). The buyer’s 5.5% service fee and the seller’s 20% commission didn’t change.",
    source: S.terms,
  },
  {
    date: "2025-07-01",
    text: "Small order fee raised from US$3 to US$3.50 on purchases under US$100 (Payment Terms updated July 2025).",
    source: S.archive2025b,
  },
  {
    date: "2024-07-01",
    text: "Hourly contracts arrive with their own fees: clients pay a one-time US$5 order initiation fee and 5.5% on each weekly charge; freelancers keep 80% of the hourly rate × hours.",
    source: S.archive2025a,
  },
  {
    date: "2024-06-01",
    text: "Small order fee changed from US$2.50 on purchases under US$75 to US$3 on purchases under US$100. The service fee stayed at 5.5%.",
    source: S.archive2025a,
  },
  {
    date: "2024-02-14",
    text: "Early Payout (1% to skip the clearance wait) limited to Top Rated freelancers and Seller Plus Premium members. Sellers who already had it keep it while they meet the criteria.",
    source: S.early,
  },
  {
    date: "2023-06-01",
    text: "Buyer service fee set at 5.5% of the purchase amount, plus US$2.50 on purchases under US$75.",
    source: S.archive2024,
  },
];

/* ------------------------------------------------------------------ withdrawals */

interface Withdrawal {
  value: string;
  label: string;
  hint: string;
  /** Fee per withdrawal, cents. */
  fee: number;
  /** Smallest withdrawal the method allows, cents. */
  min: number;
  explain: string;
  source?: string;
}

const W_PAYPAL: Withdrawal = {
  value: "paypal",
  label: "PayPal",
  hint: "free",
  fee: 0,
  min: 100,
  explain: "Free to withdraw to PayPal, usually instantly and within 24 hours at most (US$1 minimum). PayPal may charge its own currency conversion and fees.",
  source: S.paypal,
};
const W_PAYONEER: Withdrawal = {
  value: "payoneer",
  label: "Payoneer account",
  hint: "$3 per withdrawal",
  fee: 300,
  min: 1000,
  explain: "US$3 per withdrawal to your Payoneer balance, within 2 business days (US$10 minimum). Payoneer charges its own fees to move the money on from there.",
  source: S.payoneer,
};
const W_CARD2D: Withdrawal = {
  value: "card2d",
  label: "Fiverr Revenue Card, within 2 days",
  hint: "$1, existing cards only",
  fee: 100,
  min: 3000,
  explain: "US$1 per withdrawal to the Fiverr Revenue Card (operated by Payoneer), arriving within 2 days; US$30 minimum. The card was discontinued for new users in December 2022, so only existing cardholders can use it.",
  source: S.terms,
};
const W_CARD2H: Withdrawal = {
  value: "card2h",
  label: "Fiverr Revenue Card, within 2 hours",
  hint: "$3, existing cards only",
  fee: 300,
  min: 3000,
  explain: "US$3 per withdrawal to the Fiverr Revenue Card for delivery within 2 hours; US$30 minimum. Existing cardholders only (the card was discontinued for new users in December 2022).",
  source: S.terms,
};
const W_NONE: Withdrawal = { value: "none", label: "Not withdrawing yet", hint: "no fee", fee: 0, min: 0, explain: "" };

const WITHDRAW_US: Withdrawal[] = [
  W_PAYPAL,
  {
    value: "ach",
    label: "US bank via Payoneer (direct deposit)",
    hint: "$1 per withdrawal",
    fee: 100,
    min: 2000,
    explain: "US$1 per withdrawal by direct deposit (ACH) to a US bank account, operated by Payoneer. US$20 minimum; US-dollar bank transfers take 5–7 business days.",
    source: S.terms,
  },
  W_PAYONEER,
  W_CARD2D,
  W_CARD2H,
  W_NONE,
];

const W_LOCAL: Withdrawal = {
  value: "lbt",
  label: "Bank transfer via Payoneer, local currency",
  hint: "$3 per withdrawal",
  fee: 300,
  min: 2000,
  explain: "US$3 per withdrawal to your bank in your own currency, in 1–3 business days (US$20 minimum). Payoneer converts at its own exchange rate, so the amount that lands can be a little less.",
  source: S.payoneer,
};
const W_USDBANK: Withdrawal = {
  value: "usdbank",
  label: "Bank transfer via Payoneer, US dollars",
  hint: "$1 per withdrawal",
  fee: 100,
  min: 2000,
  explain: "US$1 per withdrawal as a US-dollar transfer to your bank, in 5–7 business days (US$20 minimum). Your bank may charge to receive it or to convert it.",
  source: S.payoneer,
};

function withdrawals(market: Market): Withdrawal[] {
  if (market.id === "us") return WITHDRAW_US;
  // The Revenue Card is "available worldwide, except for India and Russia".
  if (market.id === INDIA.id) return [W_LOCAL, W_USDBANK, W_PAYPAL, W_PAYONEER, W_NONE];
  return [W_LOCAL, W_USDBANK, W_PAYPAL, W_PAYONEER, W_CARD2D, W_CARD2H, W_NONE];
}

function withdrawal(inputs: Inputs, market: Market): Withdrawal {
  const list = withdrawals(market);
  return list.find((w) => w.value === str(inputs, "withdraw")) ?? list[0];
}

/* ------------------------------------------------------------------ calculation */

const isHourly = (inputs: Inputs) => str(inputs, "billing", "fixed") === "hourly";

/** Buyer's service fee on one payment: 5.5%, plus US$3.50 when the payment is under US$200. */
export function buyerFee(cents: number): { pct: number; small: number } {
  if (cents <= 0) return { pct: 0, small: 0 };
  return { pct: pct(cents, SERVICE_FEE), small: cents < SMALL_ORDER_LIMIT ? SMALL_ORDER_FEE : 0 };
}

interface Amounts {
  hourly: boolean;
  hours: number;
  /** What the seller typed: the Gig price (fixed) or the hourly rate, cents. */
  price: number;
  discountPct: number;
  /** Purchase amount of the order itself, after the seller's coupon (fixed) or rate × hours (hourly). */
  order: number;
  /** Extras bought during the order: a separate payment. */
  extras: number;
  tip: number;
  commission: number;
  extrasCommission: number;
  tipCommission: number;
  early: number;
  tcs: number;
  tds: number;
  tdsRate: number;
  /** What reaches the earnings balance from this order before withdrawal. */
  balance: number;
}

/** The arithmetic before the withdrawal step, without formatting (the breakpoint search runs it often). */
function amounts(inputs: Inputs, market: Market): Amounts {
  const hourly = isHourly(inputs);
  const price = toCents(num(inputs, "price"));
  const hours = Math.max(0, num(inputs, "hours", 10));
  const discountPct = hourly ? 0 : Math.min(100, Math.max(0, num(inputs, "discount")));
  // Hourly: rate × hours to the cent (hours entered to the hundredth).
  const order = hourly ? roundCents((price * Math.round(hours * 100)) / 100) : price - pct(price, discountPct);
  const extras = hourly ? 0 : toCents(num(inputs, "extras"));
  const tip = toCents(num(inputs, "tip"));
  const commission = pct(order, COMMISSION);
  const extrasCommission = pct(extras, COMMISSION);
  const tipCommission = pct(tip, COMMISSION);
  const orderEarnings = order - commission + extras - extrasCommission;
  const early = !hourly && bool(inputs, "earlyPayout") ? pct(orderEarnings, EARLY_PAYOUT) : 0;
  const india = market.id === INDIA.id;
  const gross = order + extras + tip;
  const tcs = india && bool(inputs, "tcs") ? pct(gross, TCS_RATE) : 0;
  const tdsRate = india ? (bool(inputs, "pan") ? 0.1 : 5) : 0;
  const tds = tdsRate ? pct(gross, tdsRate) : 0;
  const balance = gross - commission - extrasCommission - tipCommission - early - tcs - tds;
  return { hourly, hours, price, discountPct, order, extras, tip, commission, extrasCommission, tipCommission, early, tcs, tds, tdsRate, balance };
}

function calculate(inputs: Inputs, market: Market) {
  const money = moneyFor(market);
  const a = amounts(inputs, market);
  const fees: Line[] = [];

  let commissionDetail = `${formatRate(COMMISSION)} × ${money(a.order)}`;
  if (a.hourly) commissionDetail += ` (${a.hours} h × ${money(a.price)})`;
  else if (a.discountPct) commissionDetail += ` (${money(a.price)} − ${formatRate(a.discountPct)} coupon)`;
  fees.push({
    id: "commission",
    label: `Fiverr commission (${formatRate(COMMISSION)})`,
    amount: a.commission,
    kind: "platform",
    detail: commissionDetail,
    explain: a.hourly
      ? "On hourly contracts Fiverr keeps 20% of the hourly rate × hours on each completed weekly report, and credits you with the other 80%."
      : `Fiverr keeps 20% of every order, Gig extras and custom offers included, and credits you with 80% once the order is complete. There are no tiers or caps: levels, Seller Plus and Pro don’t lower it.${a.discountPct ? " With a coupon or promotion it’s charged on the discounted price, so the whole discount comes out of your side." : ""}`,
    source: a.hourly ? S.terms : S.earnings,
  });
  if (a.extras) {
    fees.push({
      id: "extras-commission",
      label: `Commission on extras added later (${formatRate(COMMISSION)})`,
      amount: a.extrasCommission,
      kind: "platform",
      detail: `${formatRate(COMMISSION)} × ${money(a.extras)}`,
      explain: "Extras the buyer adds once the order has started are a separate payment, but Fiverr’s cut is the same 20%.",
      source: S.earnings,
    });
  }
  if (a.tip) {
    fees.push({
      id: "tip-commission",
      label: `Commission on the tip (${formatRate(COMMISSION)})`,
      amount: a.tipCommission,
      kind: "platform",
      detail: `${formatRate(COMMISSION)} × ${money(a.tip)}`,
      explain: "Fiverr takes 20% of tips too, so you get 80% of what the buyer tips. A tip is its own transaction and clears 14 days after it’s paid, separately from the order.",
      source: S.earnings,
    });
  }
  if (a.early) {
    fees.push({
      id: "early-payout",
      label: `Early Payout (${formatRate(EARLY_PAYOUT)})`,
      amount: a.early,
      kind: "payout",
      detail: `${formatRate(EARLY_PAYOUT)} × ${money(a.order - a.commission + a.extras - a.extrasCommission)} earned on the order`,
      explain:
        "Optional, for Top Rated freelancers and Seller Plus Premium members: 1% of what you earned on the order (not the order total) to make it available before the clearance period ends. Charged each time you use it; hourly orders can’t use it.",
      source: S.early,
    });
  }
  if (a.tcs) {
    fees.push({
      id: "tcs",
      label: `GST TCS (${formatRate(TCS_RATE)})`,
      amount: a.tcs,
      kind: "tax",
      detail: `${formatRate(TCS_RATE)} × ${money(a.order + a.extras + a.tip)}`,
      explain: "Fiverr collects tax at source under India’s GST: 0.5% of the total transaction price, the full amount before Fiverr’s 20%, reported to the Indian tax authorities in your name.",
      source: S.india,
    });
  }
  if (a.tdsRate) {
    fees.push({
      id: "tds",
      label: `TDS, Section 194-O (${formatRate(a.tdsRate)})`,
      amount: a.tds,
      kind: "tax",
      detail: `${formatRate(a.tdsRate)} × ${money(a.order + a.extras + a.tip)}`,
      explain:
        "Indian law makes Fiverr deduct TDS on the total transaction price (100% of the Gig amount, though you receive 80%): 0.1% with your PAN on your billing info, 5% without. Fiverr emails a TDS certificate each quarter, and you can claim it against your income tax.",
      source: S.india,
    });
  }

  const w = withdrawal(inputs, market);
  let transfers = 0;
  if (w.value !== "none") {
    transfers = a.balance > 0 ? Math.ceil(a.balance / MAX_WITHDRAWAL) : 0;
    const amount = w.fee * transfers;
    fees.push({
      id: "withdrawal",
      label: `Withdrawal: ${w.label}`,
      amount,
      kind: "payout",
      detail: w.fee === 0 ? "Free" : transfers > 1 ? `${transfers} withdrawals × ${money(w.fee)} (max ${money(MAX_WITHDRAWAL)} each)` : `${money(w.fee)} per withdrawal`,
      explain: `${w.explain} The fee is charged by the payment provider per withdrawal, not per order, so cashing out several orders at once pays it once. At most US$5,000 per withdrawal.`,
      source: w.source,
    });
  }

  // The buyer's side: added at checkout, never taken from the seller.
  const buyerFees: Line[] = [];
  if (a.hourly) {
    buyerFees.push({
      id: "service",
      label: `Service fee (${formatRate(SERVICE_FEE)})`,
      amount: pct(a.order, SERVICE_FEE),
      kind: "platform",
      detail: `${formatRate(SERVICE_FEE)} × ${money(a.order)}`,
      explain: "Clients pay 5.5% on top of each weekly charge (hourly rate × hours), every Monday. It doesn’t come out of your earnings. Hourly contracts don’t pay the small order fee.",
      source: S.terms,
    });
    if (a.order > 0) {
      buyerFees.push({
        id: "initiation",
        label: "Order initiation fee (once per contract)",
        amount: HOURLY_INITIATION,
        kind: "platform",
        detail: "US$5, first week only",
        explain: "A one-time US$5 fee (before tax) the client pays when accepting your hourly offer. Later weeks don’t pay it.",
        source: S.terms,
      });
    }
  } else {
    const f = buyerFee(a.order);
    buyerFees.push({
      id: "service",
      label: `Service fee (${formatRate(SERVICE_FEE)})`,
      amount: f.pct,
      kind: "platform",
      detail: `${formatRate(SERVICE_FEE)} × ${money(a.order)}`,
      explain:
        "Fiverr adds 5.5% to the buyer’s checkout. It never comes out of your earnings, and Fiverr’s 20% isn’t charged on it. Depending on where the buyer lives, VAT, GST or US sales tax may be added too (not included here).",
      source: S.terms,
    });
    buyerFees.push({
      id: "small-order",
      label: "Small order fee",
      amount: f.small,
      kind: "platform",
      detail: `${money(SMALL_ORDER_FEE)} on purchases under ${money(SMALL_ORDER_LIMIT)}`,
      explain: "US$3.50 on every purchase under US$200 since September 2025. An order of exactly US$200 doesn’t pay it.",
      source: S.terms,
    });
    if (a.extras) {
      const e = buyerFee(a.extras);
      buyerFees.push({
        id: "extras-service",
        label: "Service fee on the extras payment",
        amount: e.pct + e.small,
        kind: "platform",
        detail: `${formatRate(SERVICE_FEE)} × ${money(a.extras)}${e.small ? ` + ${money(e.small)}` : ""}`,
        explain: "Every payment carries its own service fee, so extras bought during the order are charged again: 5.5%, plus US$3.50 when that payment is under US$200.",
        source: S.paying,
      });
    }
  }
  if (a.tip) {
    const t = buyerFee(a.tip);
    buyerFees.push({
      id: "tip-service",
      label: "Service fee on the tip",
      amount: t.pct + t.small,
      kind: "platform",
      detail: `${formatRate(SERVICE_FEE)} × ${money(a.tip)}${t.small ? ` + ${money(t.small)}` : ""}`,
      explain: "Tips are charged Fiverr’s standard service fee as a separate payment: 5.5%, plus US$3.50 when the payment is under US$200. The checkout shows the exact amount.",
      source: S.tips,
    });
  }
  const buyerPays = a.order + a.extras + a.tip + buyerFees.reduce((s, l) => s + l.amount, 0);

  const notes: string[] = [];
  notes.push(
    a.hourly
      ? "Hourly earnings become available 7 days after each weekly report is completed, under Fiverr’s Payment Terms."
      : `You can withdraw this 14 days after the order is marked complete (7 days if you’re Top Rated, on Seller Plus or Fiverr Pro).${a.tip ? " The tip clears on its own 14-day clock." : ""}`,
  );
  if (!a.hourly && a.order >= 18000 && a.order < SMALL_ORDER_LIMIT) {
    const at200 = SMALL_ORDER_LIMIT + pct(SMALL_ORDER_LIMIT, SERVICE_FEE);
    const now = a.order + pct(a.order, SERVICE_FEE) + SMALL_ORDER_FEE;
    notes.push(`Orders under ${money(SMALL_ORDER_LIMIT)} add a ${money(SMALL_ORDER_FEE)} small order fee for the buyer: at ${money(SMALL_ORDER_LIMIT)} they’d pay ${money(at200)} in total, against ${money(now)} now.`);
  }
  if (w.value !== "none" && w.min && a.balance > 0 && a.balance < w.min) {
    notes.push(`Withdrawals to ${w.label} start at ${money(w.min)}, so this money waits in your earnings until your balance reaches that.`);
  }

  const warnings: string[] = [];
  if (!a.hourly && a.price > 0 && a.price < MIN_GIG) warnings.push("Fiverr’s lowest Gig price is US$5.");
  if (a.hourly && a.price > 0 && a.price < MIN_HOURLY) warnings.push("Fiverr’s minimum hourly rate is US$7.25.");
  if (a.tip > 0 && a.tip < MIN_TIP) warnings.push("The smallest tip a buyer can leave is US$5.");
  if (!a.hourly && a.tip > Math.max(2500, a.order)) warnings.push("Buyers can tip up to US$25 on orders under US$25, and up to 100% of the order on larger ones.");
  if (a.discountPct > MAX_COUPON) warnings.push("Seller coupons go up to 30% off; first-order promotions are 5% or 10%.");
  else if (a.discountPct > 0 && a.price < MIN_COUPON_ORDER) warnings.push("Coupons can’t be used on orders under US$15.");

  const costs: Line[] = [];
  const ads = toCents(num(inputs, "adsCost"));
  const other = toCents(num(inputs, "otherCost"));
  if (ads) costs.push({ id: "adsCost", label: "Fiverr Ads spend", amount: ads, kind: "cost" });
  if (other) costs.push({ id: "otherCost", label: "Other costs for this job", amount: other, kind: "cost" });

  return assemble({ market, buyerPays, saleAmount: a.order + a.extras + a.tip, fees, buyerFees, costs, notes, warnings });
}

/**
 * Prices (cents) where the formula changes shape: the US$200 small-order edge (buyer side only)
 * and, for withdrawal methods with a fee, every price where this order's balance crosses a
 * multiple of the US$5,000 withdrawal limit (one more withdrawal, one more fee).
 */
function breakpoints(inputs: Inputs, market: Market): number[] {
  const CEILING = 100_000_000; // the solver's search ceiling ($1,000,000)
  const at = (cents: number) => amounts({ ...inputs, price: cents / 100 }, market);
  const firstWhere = (test: (cents: number) => boolean, from = 0) => {
    let lo = from;
    let hi = CEILING;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (test(mid)) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  };
  const out: number[] = [];
  if (!isHourly(inputs) && at(CEILING).order >= SMALL_ORDER_LIMIT) out.push(firstWhere((c) => at(c).order >= SMALL_ORDER_LIMIT));
  if (withdrawal(inputs, market).fee > 0) {
    const top = at(CEILING).balance;
    let from = 0;
    for (let k = 1; k <= 400 && top > k * MAX_WITHDRAWAL; k++) {
      from = firstWhere((c) => at(c).balance > k * MAX_WITHDRAWAL, from);
      out.push(from);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ schedule */

function schedule(market: Market): ScheduleRow[] {
  const money = moneyFor(market);
  const rows: ScheduleRow[] = [
    { fee: "Fiverr commission", amount: "20%", appliesTo: "Each order: package, extras, custom offers, milestones, subscriptions", source: S.terms },
    { fee: "Commission on tips", amount: "20%", appliesTo: "Each tip", when: "When the buyer tips", source: S.earnings },
    { fee: "Hourly contracts", amount: "20%", appliesTo: "Hourly rate × hours on each weekly report", when: "Hourly contracts", source: S.terms },
    { fee: "Your coupons and promotions", amount: "20% of the discounted price", appliesTo: "You fund the whole discount", when: "Coupons up to 30% off; first-order promotions 5% or 10%", source: S.growth },
    { fee: "Early Payout", amount: "1%", appliesTo: "Your earnings on the order (not the order total)", when: "Optional; Top Rated and Seller Plus Premium", source: S.early },
  ];
  if (market.id === INDIA.id) {
    rows.push(
      { fee: "GST TCS", amount: "0.5%", appliesTo: "Total transaction price (100%, before Fiverr’s 20%)", when: "Freelancers in India", source: S.india },
      { fee: "TDS, Section 194-O", amount: "0.1% (5% without PAN)", appliesTo: "Total transaction price (100%)", when: "Freelancers in India", source: S.india },
    );
  }
  for (const w of withdrawals(market)) {
    if (w.value === "none") continue;
    rows.push({
      fee: `Withdrawal: ${w.label}`,
      amount: w.fee === 0 ? "Free" : money(w.fee),
      appliesTo: `Each withdrawal (min ${money(w.min)}, max ${money(MAX_WITHDRAWAL)})`,
      when: w.value.startsWith("card") ? "Existing cardholders only" : undefined,
      source: w.source,
    });
  }
  rows.push(
    { fee: "Seller Plus", amount: "$15, $25 or $49 a month", appliesTo: "Optional subscription (Kickstart, Standard, Premium); doesn’t lower the 20%", when: "Optional", source: S.sellerPlus },
    { fee: "Buyer service fee", amount: "5.5%", appliesTo: "Paid by the buyer on top of each payment (order, extras, tip)", when: "Every purchase", source: S.terms },
    { fee: "Small order fee", amount: "$3.50", appliesTo: "Paid by the buyer", when: "Purchases under $200", source: S.terms },
    { fee: "Hourly order initiation fee", amount: "$5", appliesTo: "Paid by the client, once per hourly contract", when: "Hourly contracts", source: S.terms },
  );
  return rows;
}

/* ------------------------------------------------------------------ definition */

export const fiverr: CalculatorDef = {
  slug: "fiverr",
  name: "Fiverr",
  path: "/fiverr-fee-calculator",
  category: "freelance",
  priceNoun: "Gig price",
  sellerNoun: "freelancer",
  saleNoun: "order",
  buyerNoun: "buyer",
  costsHint: "Fiverr Ads, software, subcontractors. Optional.",
  blurb: "20% of every order and tip + withdrawal fee; buyers add 5.5% (+$3.50 under $200)",
  markets: MARKETS,
  defaultMarket: "us",
  priceField: "price",
  fields: [
    {
      id: "price",
      kind: "money",
      label: "Your price",
      section: "sale",
      help: (i) =>
        isHourly(i)
          ? "Your hourly rate. Fiverr’s minimum is US$7.25 an hour."
          : "What the buyer pays for the order before Fiverr’s service fee: package × quantity plus extras, or your custom offer.",
    },
    {
      id: "billing",
      kind: "segmented",
      label: "How is the order priced?",
      section: "sale",
      options: [
        { value: "fixed", label: "Fixed price" },
        { value: "hourly", label: "Hourly" },
      ],
      help: "Hourly contracts are billed weekly: your rate × the hours on each weekly report.",
    },
    {
      id: "hours",
      kind: "number",
      label: "Hours this week",
      section: "sale",
      unit: "h",
      min: 0,
      max: 168,
      step: 0.5,
      help: "Clients are charged every Monday for the hours on last week’s report.",
      showIf: (i) => isHourly(i),
    },
    { id: "tip", kind: "money", label: "Tip from the buyer", section: "sale", help: "Fiverr takes 20% of tips too. Leave at 0 if there’s no tip." },
    {
      id: "withdraw",
      kind: "select",
      label: "How do you withdraw?",
      section: "options",
      options: (_i, m) => withdrawals(m).map((w) => ({ value: w.value, label: w.label, hint: w.hint })),
      help: "The fee is per withdrawal, so cashing out several orders at once pays it once.",
    },
    {
      id: "pan",
      kind: "toggle",
      label: "My PAN is on my Fiverr billing info",
      section: "options",
      help: "TDS under Section 194-O is 0.1% with a PAN on file, 5% without.",
      showIf: (_i, m) => m.id === INDIA.id,
    },
    {
      id: "tcs",
      kind: "toggle",
      label: "Fiverr deducts 0.5% GST TCS from my sales",
      section: "options",
      advanced: true,
      help: "Fiverr’s India tax page lists it for India-based freelancers. Turn it off if your statements show no TCS.",
      showIf: (_i, m) => m.id === INDIA.id,
    },
    {
      id: "discount",
      kind: "percent",
      label: "Coupon or promotion you offered",
      section: "options",
      advanced: true,
      max: MAX_COUPON,
      help: "You fund it: Fiverr’s 20% is charged on the discounted price.",
      showIf: (i) => !isHourly(i),
    },
    {
      id: "extras",
      kind: "money",
      label: "Extras the buyer added mid-order",
      section: "options",
      advanced: true,
      help: "A separate payment: you keep 80%, and the buyer pays a second service fee.",
      showIf: (i) => !isHourly(i),
    },
    {
      id: "earlyPayout",
      kind: "toggle",
      label: "I’ll use Early Payout on this order",
      section: "options",
      advanced: true,
      help: "Top Rated and Seller Plus Premium only: 1% of your earnings to skip the clearance wait.",
      showIf: (i) => !isHourly(i),
    },
    { id: "adsCost", kind: "money", label: "Fiverr Ads spend for this order", section: "costs", help: "What your promoted Gig clicks cost you to win this order, on average." },
    { id: "otherCost", kind: "money", label: "Other costs for this job", section: "costs", help: "Software, stock assets, subcontractors." },
  ],
  defaults: (market) => ({
    price: 100,
    billing: "fixed",
    hours: 10,
    tip: 0,
    withdraw: market.id === "us" ? "paypal" : "lbt",
    pan: true,
    tcs: true,
    discount: 0,
    extras: 0,
    earlyPayout: false,
    adsCost: 0,
    otherCost: 0,
  }),
  calculate,
  breakpoints,
  verifiedAt: "2026-10-23",
  sources,
  changes,
  schedule,
};

export default fiverr;
