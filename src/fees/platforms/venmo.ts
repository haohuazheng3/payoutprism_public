/*
 * Venmo fees (US only). Every number is from Venmo's own pages (see `sources`), re-read on the live
 * pages on 2026-10-23. Research notes with verbatim quotes: research/fees/venmo.md.
 *
 * How a Venmo fee is computed (what this module reproduces):
 *  - Personal payments from friends: free to receive. If the sender pays with a credit card, Venmo
 *    charges the SENDER 3% of the amount (shown as a buyer-side line; it doesn't reduce what you
 *    receive). Payments to business and charity profiles are exempt from that 3%.
 *  - Goods & services (the sender tags a payment to a personal profile as a purchase): the seller
 *    pays 2.99% of the payment, no fixed fee (fee schedule). Help-center examples that show $98 from
 *    $100 are the old 1.9% + $0.10 rate.
 *  - Business profile, payment from the Venmo app or a QR code: 1.9% + $0.10 of the payment total,
 *    only on payments of $1.00 or more. Tap to Pay: 2.29% + $0.09 of the payment total (fee
 *    schedule + both Tap to Pay FAQs; Venmo's marketing pages say 2.9% + 9¢, see the line's note).
 *    "Payment total" includes tips and any tax the customer pays.
 *  - Charity profile: 1.9% + $0.10 per donation of $1.00 or more.
 *  - Moving money out: standard transfer free; Instant Transfer 1.75% of the amount moved, at least
 *    $0.25 and at most $25, deducted from the transfer. Shown as a payout line on what this payment
 *    leaves in the balance. A verified personal profile can move at most $5,000.00 per transfer, so a
 *    larger balance takes several Instant Transfers, each with its own fee (computed as full $5,000
 *    transfers plus one for the remainder, the cheapest way to split it). A verified business profile
 *    can send up to $50,000 per Instant Transfer to a bank (vhel236), so it is treated as one transfer.
 *  - Seller fees are not returned when you refund (all three profile types).
 *  - Rounding: Venmo publishes no rule. Each fee is rounded to the cent, half up (pct()), which
 *    reproduces Venmo's own examples ($100 → $2.00 business, $2.00 charity).
 */
import { M } from "../markets";
import { assemble, costLines, formatRate, moneyFor, num, pct, str, toCents } from "../money";
import type { CalculatorDef, FeeChange, Inputs, Line, Market, ScheduleRow, SelectOption, Source } from "../types";

const S = {
  fees: "venmo-fees",
  bizFees: "venmo-business-fees",
  tapIphone: "venmo-tap-iphone",
  tapAndroid: "venmo-tap-android",
  bizPage: "venmo-business-profiles",
  bizStart: "venmo-business-start",
  charity: "venmo-charity",
  selling: "venmo-selling",
  bizRefunds: "venmo-business-refunds",
  creditCard: "venmo-credit-card",
  instant: "venmo-instant",
  limits: "venmo-limits",
  bizLimits: "venmo-business-limits",
  check: "venmo-check",
  cardholder: "venmo-cardholder",
  agreement: "venmo-user-agreement",
  intlNews: "venmo-intl-launch",
} as const;

const CHECKED = "2026-10-23";

const sources: Source[] = [
  { id: S.fees, title: "About Venmo Fees", url: "https://venmo.com/resources/our-fees/", publisher: "Venmo", checked: CHECKED },
  { id: S.bizFees, title: "Business Profile Transaction Fees", url: "https://help.venmo.com/cs/articles/business-profile-transaction-fees-vhel221", publisher: "Venmo Help", checked: CHECKED },
  { id: S.tapIphone, title: "Tap to Pay on iPhone FAQ", url: "https://help.venmo.com/cs/articles/tap-to-pay-on-iphone-faq-vhel116", publisher: "Venmo Help", checked: CHECKED },
  { id: S.tapAndroid, title: "Tap to Pay on Android FAQ", url: "https://help.venmo.com/cs/articles/tap-to-pay-on-android-faq-vhel198", publisher: "Venmo Help", checked: CHECKED },
  { id: S.bizPage, title: "Venmo for Business | Business Profiles", url: "https://venmo.com/business/profiles/", publisher: "Venmo", checked: CHECKED },
  { id: S.bizStart, title: "Venmo for Businesses | Payment App for Business", url: "https://venmo.com/business/start/", publisher: "Venmo", checked: CHECKED },
  { id: S.charity, title: "Charity Profile Donation Fees", url: "https://help.venmo.com/cs/articles/charity-profile-donation-fees-vhel159", publisher: "Venmo Help", checked: CHECKED },
  { id: S.selling, title: "Selling with Personal Profiles", url: "https://help.venmo.com/cs/articles/selling-with-personal-profiles--vhel183", publisher: "Venmo Help", checked: CHECKED },
  { id: S.bizRefunds, title: "Business Profiles Refunds", url: "https://help.venmo.com/cs/articles/business-profiles-refunds-vhel284", publisher: "Venmo Help", checked: CHECKED },
  { id: S.creditCard, title: "Credit Card Fees on Venmo Payments", url: "https://help.venmo.com/cs/articles/credit-card-fees-on-venmo-payments-vhel257", publisher: "Venmo Help", checked: CHECKED },
  { id: S.instant, title: "Instant Bank Transfer FAQ", url: "https://help.venmo.com/cs/articles/instant-bank-transfer-faq-vhel302", publisher: "Venmo Help", checked: CHECKED },
  { id: S.limits, title: "Personal Profile Bank Transfer Limits", url: "https://help.venmo.com/cs/articles/personal-profile-bank-transfer-limits-vhel314", publisher: "Venmo Help", checked: CHECKED },
  { id: S.bizLimits, title: "Business Profiles Payment and Bank Transfer Limits", url: "https://help.venmo.com/cs/articles/business-profiles-payment-and-bank-transfer-limits-vhel236", publisher: "Venmo Help", checked: CHECKED },
  { id: S.check, title: "Cash a Check FAQ", url: "https://help.venmo.com/cs/articles/cash-a-check-faq-vhel330", publisher: "Venmo Help", checked: CHECKED },
  { id: S.cardholder, title: "Venmo Cardholder Agreement (Last Updated November 4, 2026)", url: "https://venmo.com/legal/bancorp-cardholder-agreement/10052026", publisher: "Venmo", checked: CHECKED },
  { id: S.agreement, title: "User Agreement", url: "https://venmo.com/legal/us-user-agreement/", publisher: "Venmo", checked: CHECKED },
  {
    id: S.intlNews,
    title: "200 Million More Friends on Venmo -- Send Money to PayPal Users Around the World",
    url: "https://newsroom.paypal-corp.com/2026-03-23-200-Million-More-Friends-on-Venmo-Send-Money-to-PayPal-Users-Around-the-World",
    publisher: "PayPal Newsroom",
    checked: CHECKED,
  },
];

/* ------------------------------------------------------------------------------ the rates */

/** Goods & services payment to a personal profile: seller pays 2.99%, no fixed fee. */
const GS_RATE = 2.99;
/** Business profile (Venmo app / QR code) and charity profile: 1.9% + $0.10 on payments of $1.00 or more. */
const PROFILE = { rate: 1.9, fixed: 10, minPayment: 100 };
/** Business profile Tap to Pay: 2.29% + $0.09 (fee schedule). Marketing pages say 2.9% + 9¢. */
const TAP = { rate: 2.29, fixed: 9 };
const TAP_MARKETING = { rate: 2.9, fixed: 9 };
/** Sender's fee for paying a personal profile with a credit card. */
const CREDIT_RATE = 3;
/** Instant Transfer: 1.75%, min $0.25, max $25, deducted from the amount moved. */
const INSTANT = { rate: 1.75, min: 25, max: 2500 };
/** Smallest Instant Transfer Venmo allows; a verified personal profile's per-transfer and weekly bank transfer limits. */
const INSTANT_MIN_AMOUNT = 26;
const PERSONAL_TRANSFER_MAX = 500_000;
const PERSONAL_WEEKLY_MAX = 1_999_999;
/** A verified business profile's weekly limit for transfers to a bank or debit card (vhel236). */
const BUSINESS_WEEKLY_MAX = 4_999_999;

/** Venmo Debit Card international transaction fee: none before November 4, 2026, then 2.5%. */
export const DEBIT_INTL_START = Date.UTC(2026, 10, 4, 5, 0); // 00:00 ET (EST) on Nov 4, 2026
export function debitIntlRate(at: number = Date.now()): number {
  return at >= DEBIT_INTL_START ? 2.5 : 0;
}

type PayTypeId = "gs" | "friends" | "business" | "tap" | "charity" | "balance";

const PAY_TYPES: (SelectOption & { value: PayTypeId })[] = [
  { value: "gs", label: "Goods & services (tagged as a purchase)", hint: "2.99%", group: "Personal profile" },
  { value: "friends", label: "Friends & family payment", hint: "Free to receive", group: "Personal profile" },
  { value: "business", label: "Business profile: Venmo app or QR code", hint: "1.9% + $0.10", group: "Business profile" },
  { value: "tap", label: "Business profile: Tap to Pay", hint: "2.29% + $0.09", group: "Business profile" },
  { value: "charity", label: "Charity profile donation", hint: "1.9% + $0.10", group: "Other" },
  { value: "balance", label: "Cashing out money already in Venmo", hint: "Transfer fee only", group: "Other" },
];

function payType(inputs: Inputs): PayTypeId {
  const v = str(inputs, "payType", "gs");
  return (PAY_TYPES.find((t) => t.value === v)?.value ?? "gs") as PayTypeId;
}

const SELLING: PayTypeId[] = ["gs", "business", "tap"];
const PERSONAL: PayTypeId[] = ["gs", "friends", "balance"];
const hasTip = (t: PayTypeId) => t === "business" || t === "tap";
const senderPicks = (t: PayTypeId) => t === "gs" || t === "friends";

/** Instant Transfer fee on an amount (cents), with what the min/max did. */
export function instantFee(amount: number): { fee: number; raw: number; hit: "min" | "max" | null } {
  const raw = pct(Math.max(0, amount), INSTANT.rate);
  if (raw < INSTANT.min) return { fee: INSTANT.min, raw, hit: "min" };
  if (raw > INSTANT.max) return { fee: INSTANT.max, raw, hit: "max" };
  return { fee: raw, raw, hit: null };
}

/**
 * Instant Transfer fees to move `balance` (cents) when one transfer can carry at most `perTransfer`:
 * as many full transfers as fit plus one for the remainder. Each transfer pays its own fee; with the
 * $25 cap reached on every full $5,000 transfer, this is the cheapest way to split the balance.
 */
export function instantFees(balance: number, perTransfer: number = Infinity) {
  const amount = Math.max(0, balance);
  const full = Number.isFinite(perTransfer) && amount > perTransfer ? Math.floor(amount / perTransfer) : 0;
  const rem = full ? amount - full * perTransfer : amount;
  const fullFee = full ? instantFee(perTransfer).fee : 0;
  const last = rem > 0 ? instantFee(rem) : null;
  return { fee: full * fullFee + (last?.fee ?? 0), transfers: full + (last ? 1 : 0), full, fullFee, rem, last };
}

/** Venmo's fee on a payment total (cents), before any transfer fee. */
function paymentFee(t: PayTypeId, total: number): number {
  if (t === "gs") return pct(total, GS_RATE);
  if (t === "business" || t === "charity") return total >= PROFILE.minPayment ? pct(total, PROFILE.rate) + PROFILE.fixed : 0;
  if (t === "tap") return pct(total, TAP.rate) + TAP.fixed;
  return 0;
}

/* --------------------------------------------------------------------------- the calculation */

interface Figures {
  /** Payment total the fee is charged on (amount + tip/tax), cents. */
  total: number;
  /** What this payment leaves in the Venmo balance (the base for an Instant Transfer). */
  balance: number;
  result: ReturnType<typeof assemble>;
}

function compute(inputs: Inputs, market: Market): Figures {
  const money = moneyFor(market);
  const t = payType(inputs);
  const amount = toCents(num(inputs, "amount"));
  const tip = hasTip(t) ? toCents(num(inputs, "tip")) : 0;
  const total = amount + tip;
  const credit = senderPicks(t) && str(inputs, "senderFunding", "bank") === "credit";

  const fees: Line[] = [];
  const buyerFees: Line[] = [];
  const notes: string[] = [];
  const warnings: string[] = [];
  const venmoFee = paymentFee(t, total);

  if (t === "gs") {
    fees.push({
      id: "seller",
      label: "Seller transaction fee (goods & services)",
      amount: venmoFee,
      kind: "payment",
      detail: `${formatRate(GS_RATE)} × ${money(total)}`,
      explain:
        "Charged to you when the sender tags the payment as a purchase: 2.99% of everything they send, shipping included, with no fixed fee. It comes out before the money reaches your balance and pays for Purchase Protection.",
      source: S.fees,
    });
  } else if (t === "business" || t === "charity") {
    const charged = total >= PROFILE.minPayment;
    const isBiz = t === "business";
    fees.push({
      id: isBiz ? "business" : "charity",
      label: isBiz ? "Business profile transaction fee" : "Charity transaction fee",
      amount: venmoFee,
      kind: "payment",
      detail: charged ? `${formatRate(PROFILE.rate)} × ${money(total)} + ${money(PROFILE.fixed)}` : "Under $1.00: no fee",
      explain: isBiz
        ? `1.9% + $0.10 of the payment total${tip ? " (tip and tax included)" : ""} on every payment of $1.00 or more sent from the Venmo app or by QR code. Your customer pays nothing extra, even with a credit card.`
        : "1.9% + $0.10 of each donation of $1.00 or more. The donor pays nothing extra, even with a credit card.",
      source: isBiz ? S.bizFees : S.charity,
    });
  } else if (t === "tap") {
    fees.push({
      id: "tap",
      label: "Tap to Pay transaction fee",
      amount: venmoFee,
      kind: "payment",
      detail: `${formatRate(TAP.rate)} × ${money(total)} + ${money(TAP.fixed)}`,
      explain: `2.29% + $0.09 of the payment total${tip ? " (tip and tax included)" : ""} for an in-person card or phone tap accepted on your phone. That is Venmo's fee schedule and its Tap to Pay FAQs; its business marketing pages quote 2.9% + 9¢ instead.`,
      source: S.fees,
    });
  } else if (t === "friends") {
    fees.push({
      id: "receive",
      label: "Receiving a personal payment",
      amount: 0,
      kind: "payment",
      detail: "Free",
      explain: "Venmo charges nothing to receive a payment from a friend, however they paid for it, as long as it isn't tagged as a purchase.",
      source: S.fees,
    });
  }

  if (credit) {
    buyerFees.push({
      id: "sender-card",
      label: "Sender's credit card fee",
      amount: pct(amount, CREDIT_RATE),
      kind: "payment",
      detail: `${formatRate(CREDIT_RATE)} × ${money(amount)}`,
      explain:
        "Venmo charges the sender 3% for paying a personal profile with a credit card. It doesn't come out of what you receive. Their card issuer may also treat it as a cash advance, with its own fee and interest.",
      source: S.fees,
    });
  }

  // Moving the money out.
  const balance = total - venmoFee;
  const instant = str(inputs, "withdraw", "standard") === "instant";
  const personal = PERSONAL.includes(t);
  let instantAmt = 0;
  let instantHit: "min" | "max" | null = null;
  if (instant && balance > 0) {
    const f = instantFees(balance, personal ? PERSONAL_TRANSFER_MAX : Infinity);
    instantAmt = f.fee;
    instantHit = f.full ? "max" : (f.last?.hit ?? null);
    const one = f.last;
    let detail: string;
    if (f.transfers > 1) {
      detail = `${f.transfers} transfers of up to ${money(PERSONAL_TRANSFER_MAX)}: ${f.full} × ${money(f.fullFee)}${one ? ` + ${formatRate(INSTANT.rate)} × ${money(f.rem)}${one.hit === "min" ? `, minimum ${money(INSTANT.min)}` : one.hit === "max" ? `, capped at ${money(INSTANT.max)}` : ""}` : ""}`;
    } else if (one?.hit === "min") detail = `${formatRate(INSTANT.rate)} × ${money(balance)} = ${money(one.raw)}, minimum ${money(INSTANT.min)}`;
    else if (one?.hit === "max") detail = `${formatRate(INSTANT.rate)} × ${money(balance)} = ${money(one.raw)}, capped at ${money(INSTANT.max)}`;
    else detail = `${formatRate(INSTANT.rate)} × ${money(balance)}`;
    fees.push({
      id: "instant",
      label: f.transfers > 1 ? `Instant Transfer fees (${f.transfers} transfers)` : "Instant Transfer fee",
      amount: f.fee,
      kind: "payout",
      detail,
      explain:
        "1.75% of the amount you move to your bank or debit card, at least $0.25 and at most $25 per transfer, taken out of the transfer itself. It usually arrives within 30 minutes; a standard transfer is free." +
        (f.transfers > 1 ? ` A personal profile can move at most $5,000 per transfer, so this takes ${f.transfers} transfers, each with its own fee.` : ""),
      source: S.instant,
    });
    if (balance < INSTANT_MIN_AMOUNT) warnings.push(`Venmo's smallest Instant Transfer is ${money(INSTANT_MIN_AMOUNT)}.`);
    if (f.transfers > 1)
      warnings.push(`A personal profile can move up to ${money(PERSONAL_TRANSFER_MAX)} per transfer, so this takes ${f.transfers} Instant Transfers, each with its own fee: ${money(f.fee)} in all.`);
  } else if (balance > 0) {
    fees.push({
      id: "standard",
      label: "Standard transfer to your bank",
      amount: 0,
      kind: "payout",
      detail: "Free",
      explain: "Standard transfers are free: usually 1–3 business days to a bank account, about 48 hours to an eligible debit card.",
      source: S.fees,
    });
  }
  if (personal && balance > PERSONAL_WEEKLY_MAX)
    warnings.push(`A verified personal profile can move up to ${money(PERSONAL_WEEKLY_MAX)} a week to a bank or card, so moving all of this takes more than a week.`);
  if ((t === "business" || t === "tap") && balance > BUSINESS_WEEKLY_MAX)
    warnings.push(`A verified business profile can move up to ${money(BUSINESS_WEEKLY_MAX)} a week to a bank or card, so moving all of this takes more than a week.`);

  // Notes: at most three, the ones that change a decision.
  if (t === "gs") {
    const biz = pct(total, PROFILE.rate) + PROFILE.fixed;
    if (total >= PROFILE.minPayment && biz < venmoFee) notes.push(`A business profile would pay 1.9% + $0.10 here: ${money(biz)}, ${money(venmoFee - biz)} less. Business profiles have no setup or monthly fee.`);
    if (venmoFee) notes.push(`If you refund the buyer, Venmo keeps the ${money(venmoFee)} fee: sending back the full ${money(total)} costs you ${money(venmoFee)} of your own money.`);
  } else if (t === "business") {
    if (venmoFee) notes.push(`Venmo keeps the ${money(venmoFee)} fee if you refund. A full refund needs ${money(total)} in your business balance: the ${money(balance)} you received plus the fee.`);
  } else if (t === "tap") {
    const alt = pct(total, TAP_MARKETING.rate) + TAP_MARKETING.fixed;
    notes.push(`Venmo's business pages quote 2.9% + 9¢ for Tap to Pay, which would be ${money(alt)} here. Its fee schedule and Tap to Pay FAQs say 2.29% + $0.09, which we use. Check your first Tap to Pay statement.`);
  } else if (t === "charity") {
    if (venmoFee) notes.push(`If you refund a donation, Venmo keeps the ${money(venmoFee)} fee.`);
  } else if (t === "friends") {
    notes.push(`Personal payments are for friends and family. Venmo's terms only allow a sale on a personal profile when the sender tags it as a purchase, which costs you 2.99% (${money(pct(amount, GS_RATE))} here) and adds Purchase Protection.`);
  }
  if (balance > 0) {
    if (instant) {
      if (instantHit === "max") notes.push("Instant Transfer fees stop at $25 per transfer (1.75% of about $1,429), so larger transfers cost less than 1.75%. A standard transfer is free.");
      else if (instantHit === "min") notes.push("Under $14 the $0.25 minimum applies, so small Instant Transfers cost more than 1.75%. A standard transfer is free.");
      else notes.push(`A standard transfer would save the ${money(instantAmt)}: it's free but takes 1–3 business days.`);
    } else {
      notes.push(`Need it today? Instant Transfer would cost ${money(instantFees(balance, personal ? PERSONAL_TRANSFER_MAX : Infinity).fee)} (1.75%, at least $0.25, at most $25 per transfer).`);
    }
  }

  const result = assemble({
    market,
    buyerPays: total + buyerFees.reduce((s, l) => s + l.amount, 0),
    saleAmount: total,
    fees,
    buyerFees,
    costs: SELLING.includes(t) ? costLines(inputs, market) : [],
    notes: notes.slice(0, 3),
    warnings,
  });
  return { total, balance, result };
}

function calculate(inputs: Inputs, market: Market) {
  return compute(inputs, market).result;
}

/** Smallest amount (cents) up to $1,000,000 for which `test` holds, assuming it is monotonic in the amount. */
function firstAmount(test: (amount: number) => boolean): number | null {
  let lo = 0;
  let hi = 100_000_000;
  if (!test(hi)) return null;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (test(mid)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

function breakpoints(inputs: Inputs): number[] {
  const t = payType(inputs);
  const tip = hasTip(t) ? toCents(num(inputs, "tip")) : 0;
  // What a payment of `amount` cents leaves in the balance (non-decreasing apart from the $1.00 drop).
  const balanceAt = (amount: number) => amount + tip - paymentFee(t, amount + tip);
  const out: (number | null)[] = [];
  // Business and charity fees start at a $1.00 payment total: what you keep drops there.
  if (t === "business" || t === "charity") out.push(firstAmount((a) => a + tip >= PROFILE.minPayment));
  if (str(inputs, "withdraw", "standard") === "instant") {
    out.push(firstAmount((a) => pct(balanceAt(a), INSTANT.rate) >= INSTANT.min));
    out.push(firstAmount((a) => pct(balanceAt(a), INSTANT.rate) >= INSTANT.max));
    // Personal profile: each $5,000 of balance past the first adds another transfer and its fee,
    // so what reaches the bank drops just past every multiple of $5,000.
    if (PERSONAL.includes(t)) {
      const top = balanceAt(100_000_000);
      for (let k = 1; k * PERSONAL_TRANSFER_MAX < top; k++) out.push(firstAmount((a) => balanceAt(a) > k * PERSONAL_TRANSFER_MAX));
    }
  }
  return out.filter((x): x is number => x !== null && x > 0);
}

/* ---------------------------------------------------------------------------- the schedule */

function schedule(): ScheduleRow[] {
  const intl = debitIntlRate();
  return [
    { fee: "Goods & services payment to a personal profile", amount: "2.99%", appliesTo: "The payment you receive", when: "The sender tags it as a purchase (you pay)", source: S.fees },
    { fee: "Business profile: Venmo app or QR code", amount: "1.9% + $0.10", appliesTo: "The payment total, tips included", when: "Payments of $1.00 or more", source: S.bizFees },
    { fee: "Business profile: Tap to Pay", amount: "2.29% + $0.09", appliesTo: "The payment total", when: "In-person contactless payments", source: S.fees },
    { fee: "Charity profile donation", amount: "1.9% + $0.10", appliesTo: "Each donation", when: "Donations of $1.00 or more", source: S.charity },
    { fee: "Receiving a personal payment", amount: "Free", appliesTo: "—", when: "Not tagged as a purchase", source: S.fees },
    { fee: "Sending with a credit card", amount: "3%", appliesTo: "The amount sent", when: "Sender pays; not on payments to business or charity profiles", source: S.fees },
    { fee: "Sending from balance, bank or debit card", amount: "Free", appliesTo: "—", when: "To a Venmo or U.S. PayPal account", source: S.fees },
    { fee: "Sending to a PayPal account outside the U.S.", amount: "5% (min $0.99, max $4.99)", appliesTo: "The amount sent", when: "Sender pays; +3% by credit card, plus up to 4% in the exchange rate", source: S.fees },
    { fee: "Instant Transfer", amount: "1.75% (min $0.25, max $25)", appliesTo: "The amount moved, deducted from it", when: "Only if you choose Instant", source: S.instant },
    { fee: "Standard transfer", amount: "Free", appliesTo: "The amount moved", when: "1–3 business days to a bank, ~48 hours to a debit card", source: S.fees },
    { fee: "Cash a Check in minutes", amount: "2% payroll/government, 5% other (min $6)", appliesTo: "The check amount", when: "Free if you wait 10 days", source: S.check },
    { fee: "Add cash at stores", amount: "$3.74", appliesTo: "Each cash load", when: "With your Venmo Debit Card at participating stores", source: S.fees },
    { fee: "Debit card ATM withdrawal", amount: "$2.50", appliesTo: "Each withdrawal", when: "Outside the MoneyPass network, or outside the U.S. (MoneyPass ATMs in the U.S. are free)", source: S.fees },
    {
      fee: "Debit card use outside the U.S.",
      amount: intl ? "2.5%" : "None until Nov 4, 2026, then 2.5%",
      appliesTo: "The purchase or ATM amount",
      when: "Stores and ATMs outside the U.S., even with no currency conversion",
      source: S.fees,
    },
    { fee: "Buying or selling crypto", amount: "2.20% down to 1.50% by amount", appliesTo: "The purchase or sale amount", when: "Plus a spread in the exchange rate; PYUSD is free", source: S.fees },
  ];
}

const changes: FeeChange[] = [
  {
    date: "2026-11-04",
    text: "Venmo Debit Card: a new 2.5% international transaction fee on purchases and ATM use outside the U.S., even with no currency conversion (none before). Non-U.S. ATM withdrawals also keep the $2.50 fee.",
    source: S.cardholder,
    upcoming: true,
  },
  {
    date: "2026-08-25",
    text: "Sending money to a PayPal account outside the U.S. now costs the sender 5% (min $0.99, max $4.99), plus 3% with a credit card. Venmo had waived this international fee through August 24, 2026.",
    source: S.fees,
  },
  {
    date: "2026-03-23",
    text: "Venmo users can now pay PayPal accounts in other countries. Venmo waived the international fee at launch; currency conversion carries a spread of up to 4%.",
    source: S.intlNews,
  },
];

/* ------------------------------------------------------------------------------- the module */

export const venmo: CalculatorDef = {
  slug: "venmo",
  name: "Venmo",
  path: "/venmo-fee-calculator",
  category: "payments",
  priceNoun: "payment amount",
  sellerNoun: "seller",
  buyerNoun: "sender",
  reverseHead: "Request this amount",
  blurb: "2.99% goods & services, 1.9% + $0.10 business, 1.75% Instant Transfer (min $0.25, max $25)",
  markets: [M.us],
  defaultMarket: "us",
  priceField: "amount",
  fields: [
    {
      id: "amount",
      kind: "money",
      label: "Payment amount",
      section: "sale",
      help: (i) => {
        const t = payType(i);
        if (t === "balance") return "The amount you want to move from Venmo to your bank or debit card.";
        if (t === "charity") return "The donation. Venmo's fee comes out of it.";
        if (hasTip(t)) return "What your customer pays before any tip. Venmo's fee comes out of it.";
        return "What the buyer or friend sends you. Any Venmo fee comes out of it.";
      },
    },
    {
      id: "payType",
      kind: "select",
      label: "What kind of payment is it?",
      section: "sale",
      options: PAY_TYPES,
      help: "You only pay Venmo when a payment is tagged as a purchase or goes to a business or charity profile.",
    },
    {
      id: "senderFunding",
      kind: "segmented",
      label: "How does the sender pay?",
      section: "sale",
      options: [
        { value: "bank", label: "Bank, debit or balance" },
        { value: "credit", label: "Credit card" },
      ],
      help: "A credit card costs the sender 3% on top. It never comes out of what you receive.",
      advanced: true,
      showIf: (i) => senderPicks(payType(i)),
    },
    {
      id: "tip",
      kind: "money",
      label: "Tip or sales tax on top",
      section: "sale",
      advanced: true,
      help: "Venmo charges its fee on the payment total, so tips and tax count too.",
      showIf: (i) => hasTip(payType(i)),
    },
    {
      id: "withdraw",
      kind: "segmented",
      label: "How will you move it to your bank?",
      section: "options",
      options: [
        { value: "standard", label: "Standard · free" },
        { value: "instant", label: "Instant · 1.75%" },
      ],
      help: "Instant arrives in minutes for 1.75% (min $0.25, max $25). Standard is free and takes 1–3 business days.",
    },
    { id: "itemCost", kind: "money", label: "What the item cost you", section: "costs", help: "Or your cost to deliver the service.", showIf: (i) => SELLING.includes(payType(i)) },
    { id: "shippingCost", kind: "money", label: "Postage / label you pay", section: "costs", showIf: (i) => SELLING.includes(payType(i)) },
    { id: "otherCost", kind: "money", label: "Packaging & other", section: "costs", showIf: (i) => SELLING.includes(payType(i)) },
  ],
  defaults: () => ({
    amount: 100,
    payType: "gs",
    senderFunding: "bank",
    tip: 0,
    withdraw: "standard",
    itemCost: 0,
    shippingCost: 0,
    otherCost: 0,
  }),
  calculate,
  breakpoints,
  verifiedAt: CHECKED,
  sources,
  changes,
  schedule,
  compare: {
    group: "pay",
    map: (c) => ({ amount: c.price + c.shipping, payType: "gs", senderFunding: "bank", withdraw: "standard", itemCost: c.itemCost, shippingCost: c.shippingCost }),
    note: "Goods & services payment to a personal profile, standard transfer",
  },
};

export default venmo;
