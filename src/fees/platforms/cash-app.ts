/*
 * Cash App fees (US). Every number is from Cash App's own pages (see `sources`), re-read verbatim
 * on 2026-10-23; the Cash App Pay merchant rates are from Square's and Stripe's pricing pages.
 * Research notes: research/fees/cash-app.md.
 *
 * What this module reproduces:
 *  - Cash App Business: 2.6% + $0.15 on each payment received from a customer's Cash App account,
 *    deducted before the money reaches the balance (help 6521). Charged on the whole amount the
 *    customer sends: Cash App doesn't itemise orders, so any shipping or tax the seller asks for is
 *    part of the payment. Tap to Pay: a flat 3% per payment (help 90134).
 *  - Personal accounts: receiving is free. Sending from a credit card costs the sender 3% (TOS fee
 *    tables "Send from Credit Card: 3.00%"), shown as a sender-side line that doesn't reduce what
 *    the recipient gets. Earn in P2P (pilot announced 2026-09-10): no fee for now (TOS §VII.7).
 *  - Cashing out: standard deposits are free (1–3 business days); Instant transfers cost
 *    0.5%–2.5% with a $0.25–$1 minimum and a $75 maximum, the exact figure shown in the app. We
 *    use the rate and minimum the person enters (default: the top of the range) on what this
 *    payment leaves in the balance, deducted from the amount moved (the app shows the arrival
 *    amount before you confirm).
 *  - Paper money deposits: $1 per deposit, taken from the cash deposited ($10 → $9 credited, TOS
 *    §XVIII.4); $5 to $500 per deposit.
 *  - Cash App Pay at a Square or Stripe checkout: the processor's rate (Square: same as its card
 *    rates; legacy plans list "Cash App Pay (Card-Present Transactions): 2.6% + 15¢" and
 *    "(Card-Non-Present Transactions): 3.3% + 30¢"; Stripe: 2.9% + 30¢ per successful charge).
 *
 * Rounding: Cash App documents banker's rounding (half to even) for its percentage fees: the TOS
 * footnote for the credit-card and Instant Transfer fees, and Business Terms §6 for business
 * fees ("To the extent that the Fees are calculated as a percentage of the transaction amount,
 * then we will use banker's rounding"). So the percentage part is rounded half-to-even and the
 * $0.15 added afterwards. Square and Stripe publish no rule: pct() (half away from zero).
 */
import { M } from "../markets";
import { assemble, bool, costLines, formatRate, moneyFor, num, pct, str, toCents } from "../money";
import type { CalculatorDef, FeeChange, Inputs, Line, Market, ScheduleRow, SelectOption, Source } from "../types";

const MARKETS: Market[] = [M.us];

/** rate% × base cents, rounded to the cent half-to-even ("banker's rounding", as Cash App documents). */
export function bankers(baseCents: number, rate: number): number {
  const milli = Math.round(rate * 1000); // thousandths of a percent, so the division below is exact
  const numer = Math.round(baseCents) * milli;
  const den = 100_000;
  const q = Math.floor(numer / den);
  const r = numer - q * den;
  if (2 * r > den) return q + 1;
  if (2 * r < den) return q;
  return q % 2 === 0 ? q : q + 1;
}

/* Cash App's own rates (cents / percent). */
const BIZ_PCT = 2.6;
const BIZ_FIXED = 15;
const TAP_PCT = 3;
const CREDIT_CARD_PCT = 3;
const INSTANT_LOW = { rate: 0.5, min: 25 };
const INSTANT_HIGH = { rate: 2.5, min: 100 };
const INSTANT_MAX = 7500;
const PAPER_FEE = 100;
const PAPER_MIN = 500;
const PAPER_MAX = 50_000;

/* Cash App Pay through a processor (Square's plan rates apply to Cash App Pay like card payments). */
type SquarePlan = "free" | "plus" | "premium";
const SQ_IN_PERSON: Record<SquarePlan, { pct: number; fixed: number }> = { free: { pct: 2.6, fixed: 15 }, plus: { pct: 2.5, fixed: 15 }, premium: { pct: 2.4, fixed: 15 } };
const SQ_ONLINE: Record<SquarePlan, { pct: number; fixed: number }> = { free: { pct: 3.3, fixed: 30 }, plus: { pct: 2.9, fixed: 30 }, premium: { pct: 2.9, fixed: 30 } };
const STRIPE = { pct: 2.9, fixed: 30 };

const S = {
  tos: "ca-tos",
  transfer: "ca-transfer-speed",
  notInstant: "ca-not-instant",
  bizFees: "ca-business-fees",
  bizTerms: "ca-business-terms",
  tap: "ca-tap-to-pay-fees",
  tapPress: "ca-tap-press",
  paper: "ca-paper-money",
  atm: "ca-atm-fees",
  intl: "ca-international",
  green: "ca-green",
  greenPress: "ca-green-press",
  tosUpdate: "ca-tos-update",
  earn: "ca-earn-in-p2p",
  noFees: "ca-no-fees",
  pools: "ca-pools",
  sqFees: "ca-square-fees",
  sqDev: "ca-square-dev",
  stripe: "ca-stripe",
} as const;

const sources: Source[] = [
  { id: S.tos, title: "Cash App Terms of Service", url: "https://cash.app/us/en/legal/tos", publisher: "Cash App", checked: "2026-10-23" },
  { id: S.transfer, title: "Withdrawal Transfer Speed Options", url: "https://cash.app/help/us/en-us/3073-cash-out-speed-options", publisher: "Cash App Help", checked: "2026-10-23" },
  { id: S.notInstant, title: "Withdrawal Transfer Wasn't Instant", url: "https://cash.app/help/us/en-us/3074-cash-out-not-instant", publisher: "Cash App Help", checked: "2026-10-23" },
  { id: S.bizFees, title: "Cash App Business Fees", url: "https://cash.app/help/us/en-us/6521-cash-for-business-fees", publisher: "Cash App Help", checked: "2026-10-23" },
  { id: S.bizTerms, title: "Cash App Business Terms", url: "https://cash.app/us/en/legal/cash-payment-terms", publisher: "Cash App", checked: "2026-10-23" },
  { id: S.tap, title: "Tap to Pay Fees", url: "https://cash.app/help/us/en-us/90134-tap-to-pay-fees", publisher: "Cash App Help", checked: "2026-10-23" },
  {
    id: S.tapPress,
    title: "Cash App Launches Tap to Pay on iPhone: Accept Contactless Payments Without Hardware",
    url: "https://cash.app/press/cash-for-business-tap-to-pay-on-iphone",
    publisher: "Cash App Press",
    checked: "2026-10-23",
  },
  { id: S.paper, title: "Paper Money Deposit", url: "https://cash.app/help/us/en-us/6488-paper-money-deposits", publisher: "Cash App Help", checked: "2026-10-23" },
  { id: S.atm, title: "ATM Fees on Cash App Card", url: "https://cash.app/help/us/en-us/3087-cash-card-atm-fees", publisher: "Cash App Help", checked: "2026-10-23" },
  { id: S.intl, title: "Does Cash App Work Internationally?", url: "https://cash.app/help/us/en-us/6553-does-cash-app-work-internationally", publisher: "Cash App Help", checked: "2026-10-23" },
  { id: S.green, title: "Cash App Green", url: "https://cash.app/help/us/en-us/123322-cash-app-green", publisher: "Cash App Help", checked: "2026-10-23" },
  { id: S.greenPress, title: "Introducing Cash App Releases: See What’s New", url: "https://cash.app/press/cash-releases-see-whats-new", publisher: "Cash App Press", checked: "2026-10-23" },
  { id: S.tosUpdate, title: "Upcoming updates to our Terms of Service", url: "https://cash.app/help/us/en-us/6542-upcoming-tos-update", publisher: "Cash App Help", checked: "2026-10-23" },
  {
    id: S.earn,
    title: "Introducing a Simpler Way to Sell Goods and Services Through Cash App",
    url: "https://cash.app/press/introducing-simpler-way-sell-goods-services-cash-app",
    publisher: "Cash App Press",
    checked: "2026-10-23",
  },
  { id: S.noFees, title: "Online Banking With No Monthly or Hidden Fees", url: "https://cash.app/bank/no-fees", publisher: "Cash App", checked: "2026-10-23" },
  { id: S.pools, title: "Pool Money with Friends | Pools on Cash App", url: "https://cash.app/send/pools", publisher: "Cash App", checked: "2026-10-23" },
  { id: S.sqFees, title: "Learn about Square fees", url: "https://squareup.com/help/us/en/article/5068-what-are-square-s-fees", publisher: "Square Support Center (US)", checked: "2026-10-23" },
  { id: S.sqDev, title: "Payments Pricing with Square APIs and SDKs", url: "https://developer.squareup.com/docs/payments-pricing", publisher: "Square Developer", checked: "2026-10-23" },
  { id: S.stripe, title: "Local payment methods pricing", url: "https://stripe.com/pricing/local-payment-methods", publisher: "Stripe", checked: "2026-10-23" },
];

const changes: FeeChange[] = [
  {
    date: "2026-09-10",
    text: "Earn in P2P pilot: eligible sole proprietors can take payments for goods and services in a personal account with no fee, instead of 2.6% + $0.15 in a Business account. Cash App can add fees later with advance notice.",
    source: S.earn,
  },
  {
    date: "2026-02-23",
    text: "Cash App’s updated terms for Instant Transfer fees take effect: 0.5%–2.5% of the amount, with a $0.25–$1 minimum and a $75 maximum. Its Send page still quotes the earlier 0.5%–1.75% with a $0.25 minimum.",
    source: S.tosUpdate,
  },
  {
    date: "2025-11-13",
    text: "Cash App Green launches: spending $500 a month with the Cash App Card or Cash App Pay now also earns free in-network ATM withdrawals (normally $2.50), not only $300 a month in qualifying deposits.",
    source: S.greenPress,
  },
  {
    date: "2025-11-05",
    text: "Cash App stops reimbursing fees at out-of-network ATMs: there you now pay its $2.50 plus any operator fee. In-network withdrawals stay free for customers who qualify (now through Cash App Green).",
    source: S.atm,
  },
  {
    date: "2025-07-15",
    text: "Tap to Pay on iPhone comes to Cash App Business: sellers take contactless cards and digital wallets in person on their iPhone, with no extra hardware. Cash App’s help center lists the fee as a flat 3% per payment.",
    source: S.tapPress,
  },
];

/* ---------------- payment types ---------------- */

type PayType = "business" | "personal" | "tap" | "earn" | "transfer" | "paper" | "capSquareCp" | "capSquareOnline" | "capStripe";

interface TypeDef {
  id: PayType;
  option: string;
  group: string;
  hint: string;
  /** A sale (business-style): shipping, tax and the seller's own costs make sense. */
  selling: boolean;
  /** Shipping can be part of the payment (not for in-person payments). */
  shipping: boolean;
  /** The money lands in a Cash App balance, so Cash App's cash-out options apply. */
  cashApp: boolean;
}

const TYPES: TypeDef[] = [
  { id: "business", option: "Customer pays my Business account ($cashtag, QR code or link)", group: "Getting paid", hint: "2.6% + 15¢", selling: true, shipping: true, cashApp: true },
  { id: "personal", option: "Friend or family pays my personal account", group: "Getting paid", hint: "Free", selling: false, shipping: false, cashApp: true },
  { id: "tap", option: "Tap to Pay: customer taps a card or phone on my phone", group: "Getting paid", hint: "3%", selling: true, shipping: false, cashApp: true },
  { id: "earn", option: "Sale paid to my personal account (Earn in P2P pilot)", group: "Getting paid", hint: "Free for now", selling: true, shipping: true, cashApp: true },
  { id: "transfer", option: "Moving my Cash App balance to my bank or card", group: "Cashing out & adding cash", hint: "Instant 0.5–2.5%", selling: false, shipping: false, cashApp: true },
  { id: "paper", option: "Adding paper cash at a store", group: "Cashing out & adding cash", hint: "$1 per deposit", selling: false, shipping: false, cashApp: true },
  { id: "capSquareCp", option: "Cash App Pay at my Square checkout, in person", group: "Cash App Pay (merchants)", hint: "2.6% + 15¢", selling: true, shipping: false, cashApp: false },
  { id: "capSquareOnline", option: "Cash App Pay on my Square online store or link", group: "Cash App Pay (merchants)", hint: "3.3% + 30¢", selling: true, shipping: true, cashApp: false },
  { id: "capStripe", option: "Cash App Pay through Stripe", group: "Cash App Pay (merchants)", hint: "2.9% + 30¢", selling: true, shipping: true, cashApp: false },
];

function typeOf(inputs: Inputs): TypeDef {
  return TYPES.find((t) => t.id === str(inputs, "payType", "business")) ?? TYPES[0];
}

function planOf(inputs: Inputs): SquarePlan {
  const p = str(inputs, "squarePlan", "free");
  return p === "plus" || p === "premium" ? p : "free";
}

const isInstant = (inputs: Inputs) => typeOf(inputs).cashApp && typeOf(inputs).id !== "paper" && str(inputs, "cashOut", "standard") === "instant";

/** The instant rate and minimum the person entered, held inside Cash App's published range. */
function instantTerms(inputs: Inputs): { rate: number; min: number } {
  const rate = Math.min(INSTANT_HIGH.rate, Math.max(INSTANT_LOW.rate, num(inputs, "instantRate", INSTANT_HIGH.rate)));
  const min = Math.min(INSTANT_HIGH.min, Math.max(INSTANT_LOW.min, toCents(num(inputs, "instantMin", INSTANT_HIGH.min / 100))));
  return { rate, min };
}

/** Cash App's instant fee on `base` cents: rate (banker's rounding), at least `min`, at most $75. */
export function instantFee(base: number, rate: number, min: number): number {
  if (base <= 0) return 0;
  return Math.min(INSTANT_MAX, Math.max(min, bankers(base, rate)));
}

/* ---------------- the calculation ---------------- */

interface Receipt {
  t: TypeDef;
  /** Payment amount + shipping (what the seller earns, before tax they pass on). */
  sale: number;
  tax: number;
  /** Everything the customer / sender pays (before a sender-side card fee). */
  total: number;
  fees: Line[];
  /** What this payment leaves in the Cash App balance: the base for a cash-out fee. */
  balance: number;
  halfCent: boolean;
}

function receive(inputs: Inputs, market: Market): Receipt {
  const money = moneyFor(market);
  const t = typeOf(inputs);
  const amount = toCents(num(inputs, "amount"));
  const shipping = t.shipping ? toCents(num(inputs, "shipping")) : 0;
  const taxRate = t.selling ? Math.min(30, Math.max(0, num(inputs, "salesTax"))) : 0;
  const sale = amount + shipping;
  const tax = pct(sale, taxRate);
  const total = sale + tax;
  const fees: Line[] = [];
  let halfCent = false;
  const what = shipping || tax ? `, including the ${[shipping ? "shipping" : "", tax ? "sales tax" : ""].filter(Boolean).join(" and ")} you asked for` : "";

  if (t.id === "business") {
    const pctPart = bankers(total, BIZ_PCT);
    halfCent = total > 0 && (total * Math.round(BIZ_PCT * 1000)) % 100_000 === 50_000;
    fees.push({
      id: "business",
      label: "Cash App Business processing fee",
      amount: total > 0 ? pctPart + BIZ_FIXED : 0,
      kind: "payment",
      detail: `2.6% × ${money(total)} + $0.15`,
      explain: `Cash App takes 2.6% of every payment into a Business account plus $0.15, before the money reaches your balance. It’s charged on the whole amount the customer sends${what}.`,
      source: S.bizFees,
    });
  } else if (t.id === "tap") {
    fees.push({
      id: "tap",
      label: "Tap to Pay processing fee",
      amount: bankers(total, TAP_PCT),
      kind: "payment",
      detail: `3% × ${money(total)}`,
      explain: `A flat 3% of each contactless card or phone payment you take with Tap to Pay${tax ? ", sales tax included" : ""}, with no fixed fee. It comes out before the money reaches your Business balance; your customer isn’t charged.`,
      source: S.tap,
    });
  } else if (t.id === "personal") {
    fees.push({
      id: "receive",
      label: "Receiving fee",
      amount: 0,
      kind: "payment",
      detail: "Free",
      explain: "Receiving money in a personal Cash App account is free, and so is sending it from a Cash balance or debit card. Personal accounts are for personal payments: Cash App can require you to switch to a Business account if you use one to sell.",
      source: S.tos,
    });
  } else if (t.id === "earn") {
    fees.push({
      id: "earn",
      label: "Earn in P2P fee",
      amount: 0,
      kind: "payment",
      detail: "Free during the pilot",
      explain: `Cash App’s Earn in P2P pilot lets eligible sole proprietors take payments for goods and services in a personal account and currently charges no fee for them. It needs your full Social Security number on file (otherwise 24% is withheld for the IRS), isn’t open to LLCs or corporations, and Cash App can add a fee with advance notice.`,
      source: S.tos,
    });
  } else if (t.id === "paper") {
    fees.push({
      id: "paper",
      label: "Paper money deposit fee",
      amount: amount > 0 ? PAPER_FEE : 0,
      kind: "payment",
      detail: "$1.00 per deposit",
      explain: "Cash App charges $1 on every paper money deposit at a store, Cash App Green customers included, and takes it out of the cash you hand over: deposit $10 and your balance gets $9.",
      source: S.paper,
    });
  } else if (t.id === "transfer") {
    // Only a cash-out line (added in calculate()).
  } else {
    const plan = planOf(inputs);
    const r = t.id === "capSquareCp" ? SQ_IN_PERSON[plan] : t.id === "capSquareOnline" ? SQ_ONLINE[plan] : STRIPE;
    const square = t.id !== "capStripe";
    const planText = plan === "free" ? "Square Free or a legacy plan" : `Square ${plan === "plus" ? "Plus" : "Premium"}`;
    fees.push({
      id: "processing",
      label: square ? `Square processing: Cash App Pay ${t.id === "capSquareCp" ? "in person" : "online"}` : "Stripe processing: Cash App Pay",
      amount: total > 0 ? pct(total, r.pct) + r.fixed : 0,
      kind: "payment",
      detail: `${formatRate(r.pct)} × ${money(total)} + ${money(r.fixed)}`,
      explain: square
        ? `Square charges Cash App Pay at the same rate as a card payment: ${formatRate(r.pct)} + ${money(r.fixed)} ${t.id === "capSquareCp" ? "in person" : "online"} on ${planText}, on the whole amount${what}. Your customer pays nothing extra, and Square’s 1.5% international card fee doesn’t apply.`
        : `Stripe charges 2.9% + 30¢ per successful Cash App Pay charge${what ? `, on the whole amount${what}` : ""}. Your customer pays nothing extra.`,
      source: square ? S.sqFees : S.stripe,
    });
  }
  const received = fees.reduce((s, l) => s + l.amount, 0);
  const balance = (t.id === "transfer" ? amount : total) - received;
  return { t, sale, tax, total, fees, balance, halfCent };
}

function calculate(inputs: Inputs, market: Market) {
  const money = moneyFor(market);
  const rc = receive(inputs, market);
  const { t, tax, total, balance } = rc;
  const fees = [...rc.fees];
  const buyerFees: Line[] = [];
  const notes: string[] = [];
  const warnings: string[] = [];

  if (t.cashApp && t.id !== "paper") {
    if (isInstant(inputs)) {
      const { rate, min } = instantTerms(inputs);
      const raw = bankers(Math.max(0, balance), rate);
      const fee = instantFee(balance, rate, min);
      const detail =
        balance <= 0
          ? "Nothing left to move"
          : raw < min
            ? `${formatRate(rate)} × ${money(balance)} = ${money(raw)}, minimum ${money(min)}`
            : raw > INSTANT_MAX
              ? `${formatRate(rate)} × ${money(balance)} = ${money(raw)}, capped at $75.00`
              : `${formatRate(rate)} × ${money(balance)}`;
      fees.push({
        id: "instant",
        label: "Instant deposit fee",
        amount: fee,
        kind: "payout",
        detail,
        explain: `Cash App charges 0.5% to 2.5% to send money to your debit card in minutes, at least $0.25 to $1 and never more than $75, and shows the exact fee before you confirm. We use ${formatRate(rate)} with a ${money(min)} minimum on ${t.id === "transfer" ? "the amount you move" : "what this payment leaves in your balance"}; change them under “More options” to match your app. If your card can’t take an instant deposit, the fee is refunded.`,
        source: S.transfer,
      });
      if (balance > 0) {
        const lo = instantFee(balance, INSTANT_LOW.rate, INSTANT_LOW.min);
        const hi = instantFee(balance, INSTANT_HIGH.rate, INSTANT_HIGH.min);
        notes.push(`On ${money(balance)}, Cash App’s instant fee can be anywhere from ${money(lo)} to ${money(hi)}: the app shows yours before you confirm. A standard deposit is free and takes 1–3 business days.`);
      }
    } else {
      fees.push({
        id: "deposit",
        label: "Standard deposit to your bank",
        amount: 0,
        kind: "payout",
        detail: "Free · 1–3 business days",
        explain: "Moving money from Cash App to your bank with a standard transfer is free and usually takes 1–3 business days. Mastercard debit cards can’t receive standard transfers, so link a bank account to avoid the instant fee.",
        source: S.transfer,
      });
    }
  }

  if (t.id === "personal" && bool(inputs, "cardSender")) {
    const amount = toCents(num(inputs, "amount"));
    buyerFees.push({
      id: "sender-card",
      label: "Sender’s credit card fee (3%)",
      amount: bankers(amount, CREDIT_CARD_PCT),
      kind: "payment",
      detail: `3% × ${money(amount)}`,
      explain: "Cash App charges the person sending 3% to pay from a linked credit card. It’s added to what they pay; you still receive the full amount. (For pool contributions, Cash App’s Pools page says the 3% also applies to a credit card used through Apple Pay or Google Pay.)",
      source: S.tos,
    });
  }

  // Notes: at most three, the ones that change a decision.
  if (rc.halfCent)
    notes.push("2.6% of this payment comes to exactly half a cent. We round it to the even cent, as Cash App’s terms describe (banker’s rounding); if Cash App rounds after adding the 15¢, its fee is 1¢ different.");
  if (tax) notes.push(`Cash App deposits ${money(total - fees.reduce((s, l) => s + l.amount, 0))} for this payment, including the ${money(tax)} sales tax you owe. The fee is charged on the tax too.`);
  if (t.id === "business" && notes.length < 2) notes.push("Selling as a sole proprietor? Cash App’s Earn in P2P pilot takes sales in a personal account with no fee for now, if it’s offered to you.");
  if (t.id === "personal" && !bool(inputs, "cardSender")) notes.push("If you’re the one sending: paying from a balance or debit card is free, a credit card costs 3% on top.");
  if (t.id === "transfer" || t.id === "personal") notes.push("Taking cash out at an ATM instead costs $2.50 per withdrawal plus any ATM operator’s fee. In-network ATMs are free with Cash App Green.");
  if (t.id === "paper") {
    const amount = toCents(num(inputs, "amount"));
    if (amount > 0 && (amount < PAPER_MIN || amount > PAPER_MAX)) warnings.push("Paper money deposits must be between $5 and $500 each.");
    notes.push("Some stores require at least $20 when you swipe your Cash App Card, and Cash App limits deposits to $5,000 per 7 days and $10,000 per 30 days.");
  }
  if (!t.cashApp) notes.push(`This money lands in your ${t.id === "capStripe" ? "Stripe" : "Square"} balance, so ${t.id === "capStripe" ? "Stripe’s" : "Square’s"} payout options and fees apply, not Cash App’s.`);

  const paper = t.id === "paper";
  return assemble({
    market,
    buyerPays: (paper || t.id === "transfer" ? toCents(num(inputs, "amount")) : total) + buyerFees.reduce((s, l) => s + l.amount, 0),
    saleAmount: paper || t.id === "transfer" ? toCents(num(inputs, "amount")) : rc.sale,
    fees,
    buyerFees,
    costs: t.selling ? costLines(inputs, market) : [],
    notes: notes.slice(0, 3),
    warnings,
  });
}

/** Smallest payment amount (cents) whose balance reaches `target` cents (balance grows with the amount). */
function amountForBalance(inputs: Inputs, market: Market, target: number): number | null {
  const at = (c: number) => receive({ ...inputs, amount: c / 100 }, market).balance;
  let lo = 0;
  let hi = 100_000_000;
  if (at(hi) < target) return null;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (at(mid) >= target) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

function breakpoints(inputs: Inputs, market: Market): number[] {
  // The instant fee is flat at its minimum, then a percentage, then flat at $75. Payout stays
  // monotonic across both edges, but they are where the formula changes shape.
  if (!isInstant(inputs)) return [];
  const { rate, min } = instantTerms(inputs);
  const edges = [Math.ceil((min * 100) / rate), Math.ceil((INSTANT_MAX * 100) / rate)];
  return edges.map((b) => amountForBalance(inputs, market, b)).filter((p): p is number => p !== null && p > 0);
}

function schedule(): ScheduleRow[] {
  return [
    { fee: "Business account payment", amount: "2.6% + $0.15", appliesTo: "Each payment received, whole amount", when: "Customer pays your Business $cashtag, QR code or link", source: S.bizFees },
    { fee: "Tap to Pay", amount: "3%", appliesTo: "Each in-person contactless payment", when: "Business account; customer pays no fee", source: S.tap },
    { fee: "Personal payments", amount: "Free", appliesTo: "Sending from balance or debit card, receiving", when: "Personal, non-business payments", source: S.tos },
    { fee: "Earn in P2P", amount: "Free (pilot)", appliesTo: "Goods and services paid to a personal account", when: "Eligible sole proprietors enrolled in the pilot", source: S.earn },
    { fee: "Sending from a credit card", amount: "3%", appliesTo: "Amount sent, paid by the sender", when: "Balance or debit card: free", source: S.tos },
    { fee: "Standard deposit", amount: "Free", appliesTo: "Balance moved to your bank", when: "1–3 business days; not to Mastercard debit cards", source: S.transfer },
    { fee: "Instant deposit", amount: "0.5%–2.5%, min $0.25–$1, max $75", appliesTo: "Amount moved", when: "Arrives in minutes; exact fee shown before you confirm", source: S.transfer },
    { fee: "Paper money deposit", amount: "$1", appliesTo: "Each cash deposit at a store ($5–$500)", when: "Every customer, Cash App Green included", source: S.paper },
    { fee: "ATM withdrawal", amount: "$2.50", appliesTo: "Each withdrawal; most out-of-network ATMs add their own fee", when: "Free at in-network ATMs with Cash App Green", source: S.atm },
    { fee: "Foreign transaction", amount: "3%", appliesTo: "Cash App Card purchases abroad or from foreign online stores", when: "Waived in person with Cash App Green", source: S.intl },
    { fee: "Cash App Pay (merchant)", amount: "Square 2.6% + 15¢ in person, 3.3% + 30¢ online · Stripe 2.9% + 30¢", appliesTo: "Whole payment", when: "Free for the customer; Square Plus and Premium pay their lower card rates", source: S.sqFees },
  ];
}

function payOptions(): SelectOption[] {
  return TYPES.map((t) => ({ value: t.id, label: t.option, hint: t.hint, group: t.group }));
}

const SELLING = (i: Inputs) => typeOf(i).selling;

export const cashApp: CalculatorDef = {
  slug: "cash-app",
  name: "Cash App",
  path: "/cash-app-fee-calculator",
  category: "payments",
  priceNoun: "payment amount",
  sellerNoun: "seller",
  blurb: "2.6% + 15¢ business payments, 3% Tap to Pay and credit card sends, 0.5–2.5% instant deposits (US)",
  markets: MARKETS,
  defaultMarket: "us",
  priceField: "amount",
  fields: [
    {
      id: "amount",
      kind: "money",
      label: "Payment amount",
      section: "sale",
      help: "What the customer or friend sends you. Cashing out or adding cash at a store? Enter that amount.",
    },
    {
      id: "payType",
      kind: "select",
      label: "What kind of payment is it?",
      section: "sale",
      options: payOptions,
      help: "A Business account pays 2.6% + 15¢ per payment; personal payments are free.",
    },
    {
      id: "cardSender",
      kind: "toggle",
      label: "They’re paying with a credit card",
      section: "sale",
      help: "Cash App charges the sender 3% on top. You still get the full amount.",
      showIf: (i) => typeOf(i).id === "personal",
    },
    {
      id: "cashOut",
      kind: "segmented",
      label: "How will you move it to your bank?",
      section: "options",
      options: [
        { value: "standard", label: "Standard · free" },
        { value: "instant", label: "Instant · 0.5–2.5%" },
      ],
      help: "Standard takes 1–3 business days. Instant arrives in minutes for 0.5% to 2.5% (at least $0.25–$1, at most $75).",
      showIf: (i) => typeOf(i).cashApp && typeOf(i).id !== "paper",
    },
    {
      id: "instantRate",
      kind: "percent",
      label: "Instant fee rate your app shows",
      section: "options",
      advanced: true,
      min: 0.5,
      max: 2.5,
      step: 0.05,
      help: "Cash App shows the exact rate (0.5% to 2.5%) before you confirm. We use the highest unless you enter yours.",
      showIf: isInstant,
    },
    {
      id: "instantMin",
      kind: "money",
      label: "Minimum instant fee your app shows",
      section: "options",
      advanced: true,
      min: 0.25,
      max: 1,
      help: "Between $0.25 and $1. It only matters on small transfers (under $40 at 2.5%).",
      showIf: isInstant,
    },
    {
      id: "shipping",
      kind: "money",
      label: "Shipping you charge",
      // In "sale" with sales tax: on its own it would leave a "Shipping" heading over a lone "More options".
      section: "sale",
      advanced: true,
      help: "If the customer sends it in the same payment, the fee is charged on it too.",
      showIf: (i) => typeOf(i).shipping,
    },
    {
      id: "salesTax",
      kind: "percent",
      label: "Sales tax you add",
      section: "sale",
      advanced: true,
      max: 30,
      help: "Part of what the customer sends, so the percentage fee applies to it as well.",
      showIf: SELLING,
    },
    {
      id: "squarePlan",
      kind: "segmented",
      label: "Your Square plan",
      section: "options",
      advanced: true,
      options: [
        { value: "free", label: "Free or legacy" },
        { value: "plus", label: "Plus" },
        { value: "premium", label: "Premium" },
      ],
      help: "Square charges Cash App Pay at your card rate, which is lower on Plus and Premium.",
      showIf: (i) => typeOf(i).id === "capSquareCp" || typeOf(i).id === "capSquareOnline",
    },
    { id: "itemCost", kind: "money", label: "What the item or service cost you", section: "costs", help: "Stock, materials or your direct cost.", showIf: SELLING },
    { id: "shippingCost", kind: "money", label: "Postage / delivery you pay", section: "costs", showIf: SELLING },
    { id: "otherCost", kind: "money", label: "Packaging & other", section: "costs", showIf: SELLING },
  ],
  defaults: () => ({
    amount: 100,
    payType: "business",
    cardSender: false,
    cashOut: "standard",
    instantRate: INSTANT_HIGH.rate,
    instantMin: INSTANT_HIGH.min / 100,
    shipping: 0,
    salesTax: 0,
    squarePlan: "free",
    itemCost: 0,
    shippingCost: 0,
    otherCost: 0,
  }),
  calculate,
  breakpoints,
  verifiedAt: "2026-10-23",
  sources,
  changes,
  schedule,
  compare: {
    group: "pay",
    map: (c) => ({ amount: c.price, shipping: c.shipping, payType: "business", cashOut: "standard", itemCost: c.itemCost, shippingCost: c.shippingCost }),
    note: "Cash App Business account payment, standard (free) deposit",
  },
};

export default cashApp;
