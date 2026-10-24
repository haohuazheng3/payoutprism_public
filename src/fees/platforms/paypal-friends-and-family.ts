/*
 * PayPal friends & family, sender side (US). PayPal Consumer Fees, checked 2026-10-24:
 *  - Domestic, from a PayPal balance or bank account: free.
 *  - Domestic, funded by a credit or debit card: 2.90% + $0.30 fixed fee, paid by the sender.
 *  - International: 5% of the amount (at least $0.99, at most $4.99), plus 2.90% + $0.30 if paid by card.
 *  - Currency conversion when the recipient's currency differs: PayPal's exchange-rate spread (see the exchange rate calculator).
 */
import { M } from "../markets";
import { assemble, moneyFor, num, pct, str, toCents } from "../money";
import type { CalculatorDef, Inputs, Line, Market } from "../types";
import { CHECKED, capped, src } from "./_kit";

const sources = [src("pp-us-consumer", "PayPal Consumer Fees", "https://www.paypal.com/us/digital-wallet/paypal-consumer-fees", "PayPal US"), src("pp-us-ua", "PayPal User Agreement", "https://www.paypal.com/us/legalhub/paypal/useragreement-full", "PayPal US")];
const CARD = { rate: 2.9, fixed: 30 };
const INTL = { rate: 5, min: 99, max: 499 };

function calculate(inputs: Inputs, market: Market) {
  const money = moneyFor(market);
  const amount = toCents(num(inputs, "amount"));
  const card = str(inputs, "funding", "bank") === "card";
  const abroad = str(inputs, "where", "us") === "abroad";
  const lines: Line[] = [];
  if (abroad) {
    const f = capped(amount, INTL.rate, INTL.min, INTL.max);
    lines.push({ id: "intl", label: "International transfer fee", amount: amount ? f : 0, kind: "payment", detail: `5% × ${money(amount)}, min $0.99, max $4.99`, explain: "Sending to friends and family in another country costs 5% of the amount, at least $0.99 and at most $4.99, paid by you.", source: "pp-us-consumer" });
  }
  if (card) {
    lines.push({ id: "card", label: "Card funding fee (2.90% + $0.30)", amount: amount ? pct(amount, CARD.rate) + CARD.fixed : 0, kind: "payment", detail: `2.90% × ${money(amount)} + $0.30`, explain: "Paying a friend with a credit or debit card instead of your PayPal balance or bank adds 2.90% + $0.30, paid by you.", source: "pp-us-consumer" });
  }
  const fee = lines.reduce((s, l) => s + l.amount, 0);
  const notes: string[] = [];
  if (fee === 0 && amount > 0) notes.push("Free: a domestic friends-and-family payment from your PayPal balance or bank costs nothing for either of you.");
  if (card && amount > 0) notes.push(`Paying from your bank or PayPal balance instead would save ${money(pct(amount, CARD.rate) + CARD.fixed)}.`);
  if (abroad) notes.push("If your friend’s account uses another currency, PayPal also converts it at its own exchange rate, which includes a spread.");
  notes.push("Friends and family payments aren’t covered by PayPal Purchase Protection: use goods and services when you’re paying for something.");
  return assemble({ market, buyerPays: amount + fee, saleAmount: amount, fees: [], buyerFees: lines, notes: notes.slice(0, 3) });
}

const def: CalculatorDef = {
  slug: "paypal-friends-and-family",
  name: "PayPal Friends & Family",
  path: "/paypal-friends-and-family-fee-calculator",
  category: "payments",
  priceNoun: "amount to send",
  sellerNoun: "recipient",
  saleNoun: "payment",
  buyerNoun: "you",
  blurb: "Free from balance or bank; card 2.90% + $0.30; abroad 5% ($0.99–$4.99)",
  keepHead: "You pay in total",
  headline: "buyerPays",
  receiveLabel: "Your friend receives",
  buyerHead: "Fees you pay on top",
  buyerTotal: "Charged to you",
  modes: false,
  markets: [M.us],
  defaultMarket: "us",
  priceField: "amount",
  fields: [
    { id: "amount", kind: "money", label: "Amount to send", section: "sale", help: "What you want your friend or family member to receive." },
    { id: "funding", kind: "segmented", label: "How will you pay?", section: "sale", options: [{ value: "bank", label: "Balance or bank" }, { value: "card", label: "Credit or debit card" }] },
    { id: "where", kind: "segmented", label: "Where are they?", section: "sale", options: [{ value: "us", label: "In the US" }, { value: "abroad", label: "Another country" }] },
  ],
  defaults: () => ({ amount: 100, funding: "card", where: "us" }),
  calculate,
  breakpoints: () => [19.8, 99.8],
  verifiedAt: CHECKED,
  sources,
  changes: [],
  schedule: () => [
    { fee: "Domestic, balance or bank", amount: "Free", appliesTo: "Amount sent", source: "pp-us-consumer" },
    { fee: "Domestic, card", amount: "2.90% + $0.30", appliesTo: "Amount sent", when: "Paid by the sender", source: "pp-us-consumer" },
    { fee: "International", amount: "5% (min $0.99, max $4.99)", appliesTo: "Amount sent", when: "Plus 2.90% + $0.30 if paid by card", source: "pp-us-consumer" },
    { fee: "Receiving", amount: "Free", appliesTo: "—", when: "Friends and family payments", source: "pp-us-consumer" },
  ],
};
export default def;
