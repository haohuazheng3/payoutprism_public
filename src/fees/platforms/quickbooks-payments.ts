/* QuickBooks Payments (US). Rates page "accurate as of 09/18/2026", checked 2026-10-24: invoice/recurring/payment-link card or wallet 2.99%; ACH 1%; in-person 2.5%; keyed 3.5%; buy now pay later 2.99%; instant deposit 1.75%. No fixed per-transaction fee is listed. */
import { M } from "../markets";
import { assemble, bool, formatRate, moneyFor, num, pct, str, toCents } from "../money";
import type { CalculatorDef, Inputs, Line, Market } from "../types";
import { CHECKED, COSTS, costs, src } from "./_kit";

const sources = [src("qb-rates", "QuickBooks Payments processing fees and rates", "https://quickbooks.intuit.com/payments/payment-rates/", "Intuit QuickBooks")];
const METHODS: Record<string, { label: string; rate: number; when: string }> = {
  invoice: { label: "Invoice paid by card or wallet", rate: 2.99, when: "Invoices, recurring payments or payment links paid with Visa, Mastercard, Discover, Amex, Apple Pay, PayPal or Venmo" },
  ach: { label: "Bank transfer (ACH)", rate: 1, when: "Invoices or requests paid from the customer’s bank account" },
  inperson: { label: "In person (card reader / Tap to Pay)", rate: 2.5, when: "Card present" },
  keyed: { label: "Keyed-in card", rate: 3.5, when: "You type the card number in" },
  bnpl: { label: "Buy now, pay later", rate: 2.99, when: "Customer pays over time through Affirm" },
};

function calculate(inputs: Inputs, market: Market) {
  const money = moneyFor(market);
  const amount = toCents(num(inputs, "amount"));
  const m = METHODS[str(inputs, "method", "invoice")] ?? METHODS.invoice;
  const fees: Line[] = [{ id: "processing", label: `${m.label} (${formatRate(m.rate)})`, amount: pct(amount, m.rate), kind: "payment", detail: `${formatRate(m.rate)} × ${money(amount)}`, explain: `QuickBooks Payments charges ${formatRate(m.rate)} for this payment type: ${m.when.toLowerCase()}.`, source: "qb-rates" }];
  if (bool(inputs, "instant")) fees.push({ id: "instant", label: "Instant deposit (1.75%)", amount: pct(amount, 1.75), kind: "payment", detail: `1.75% × ${money(amount)}`, explain: "Optional: get the money in minutes, nights and weekends included, for 1.75% of the deposit. Standard deposits cost nothing extra.", source: "qb-rates" });
  const notes = amount > 0 ? [`Paid by ACH the same invoice would cost ${money(pct(amount, 1))}, versus ${money(pct(amount, 2.99))} by card.`, "QuickBooks says businesses processing over $2,500 a month may qualify for lower rates on request."] : [];
  return assemble({ market, buyerPays: amount, saleAmount: amount, fees, costs: costs(inputs), notes });
}

const def: CalculatorDef = {
  slug: "quickbooks-payments",
  name: "QuickBooks Payments",
  path: "/quickbooks-payments-fee-calculator",
  category: "payments",
  priceNoun: "invoice amount",
  sellerNoun: "business",
  buyerNoun: "customer",
  blurb: "2.99% invoice cards, 1% ACH, 2.5% in person, 3.5% keyed; instant deposit 1.75%",
  markets: [M.us],
  defaultMarket: "us",
  priceField: "amount",
  fields: [
    { id: "amount", kind: "money", label: "Payment amount", section: "sale" },
    { id: "method", kind: "select", label: "How the customer pays", section: "sale", options: Object.entries(METHODS).map(([value, x]) => ({ value, label: x.label, hint: formatRate(x.rate) })) },
    { id: "instant", kind: "toggle", label: "Instant deposit (+1.75%)", section: "options" },
    ...COSTS,
  ],
  defaults: () => ({ amount: 1000, method: "invoice", instant: false, itemCost: 0, otherCost: 0 }),
  calculate,
  breakpoints: () => [],
  verifiedAt: CHECKED,
  sources,
  changes: [],
  schedule: () => [...Object.values(METHODS).map((x) => ({ fee: x.label, amount: formatRate(x.rate), appliesTo: "Payment amount", when: x.when, source: "qb-rates" })), { fee: "Instant deposit", amount: "1.75%", appliesTo: "Deposit", when: "Optional", source: "qb-rates" }],
};
export default def;
