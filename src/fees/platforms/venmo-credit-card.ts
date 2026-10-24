/* Venmo: paying a person with a credit card (US). "Credit Card Fees on Venmo Payments" + About Venmo Fees, checked 2026-10-24: 3% of the amount, charged to the sender; debit card, bank or balance free. */
import { M } from "../markets";
import { assemble, moneyFor, num, pct, str, toCents } from "../money";
import type { CalculatorDef, Inputs, Market } from "../types";
import { CHECKED, src } from "./_kit";

const sources = [
  src("venmo-cc", "Credit Card Fees on Venmo Payments", "https://help.venmo.com/cs/articles/credit-card-fees-on-venmo-payments-vhel257", "Venmo Help"),
  src("venmo-fees", "About Venmo Fees", "https://venmo.com/resources/our-fees/", "Venmo"),
];

function calculate(inputs: Inputs, market: Market) {
  const money = moneyFor(market);
  const amount = toCents(num(inputs, "amount"));
  const credit = str(inputs, "funding", "credit") === "credit";
  const fee = credit ? pct(amount, 3) : 0;
  const notes = credit && amount > 0
    ? [`Paying from your Venmo balance, bank or a debit card instead would save ${money(fee)}.`, "Your card issuer may also treat a Venmo credit card payment as a cash advance, with its own fee and interest: check before you pay."]
    : amount > 0 ? ["No fee: Venmo doesn’t charge for payments to people funded by your balance, bank or debit card."] : [];
  return assemble({
    market,
    buyerPays: amount + fee,
    saleAmount: amount,
    fees: [],
    buyerFees: credit ? [{ id: "credit", label: "Credit card fee (3%)", amount: fee, kind: "payment", detail: `3% × ${money(amount)}`, explain: "Venmo charges the sender 3% of the payment when it’s funded by a credit card. The recipient still gets the full amount.", source: "venmo-cc" }] : [],
    notes,
  });
}

const def: CalculatorDef = {
  slug: "venmo-credit-card",
  name: "Venmo Credit Card Fee",
  path: "/venmo-credit-card-fee-calculator",
  category: "payments",
  priceNoun: "amount to send",
  sellerNoun: "recipient",
  saleNoun: "payment",
  buyerNoun: "you",
  blurb: "3% added when you pay someone with a credit card; debit, bank and balance free",
  keepHead: "You pay in total",
  headline: "buyerPays",
  receiveLabel: "They receive",
  buyerHead: "Fee you pay on top",
  buyerTotal: "Charged to your card",
  modes: false,
  markets: [M.us],
  defaultMarket: "us",
  priceField: "amount",
  fields: [
    { id: "amount", kind: "money", label: "Amount to send", section: "sale" },
    { id: "funding", kind: "segmented", label: "Paying with", section: "sale", options: [{ value: "credit", label: "Credit card · 3%" }, { value: "free", label: "Debit, bank or balance" }] },
  ],
  defaults: () => ({ amount: 100, funding: "credit" }),
  calculate,
  breakpoints: () => [],
  verifiedAt: CHECKED,
  sources,
  changes: [],
  schedule: () => [
    { fee: "Credit card", amount: "3%", appliesTo: "Amount sent", when: "Paid by the sender", source: "venmo-cc" },
    { fee: "Debit card, bank or balance", amount: "Free", appliesTo: "Amount sent", source: "venmo-fees" },
  ],
};
export default def;
