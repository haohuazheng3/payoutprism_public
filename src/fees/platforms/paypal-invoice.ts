/*
 * PayPal invoicing (US). PayPal Merchant Fees, checked 2026-10-24: invoice paid with PayPal or
 * Venmo 3.49% + $0.49; by card or Apple Pay 2.99% + $0.49; with Pay Later 4.99% + $0.49; by bank
 * (ACH) 1%, at most $10. Payments from outside the US add 1.50%.
 */
import { M } from "../markets";
import { assemble, bool, moneyFor, num, pct, str, toCents } from "../money";
import type { CalculatorDef, Inputs, Line, Market } from "../types";
import { CHECKED, COSTS, capped, costs, src } from "./_kit";

const sources = [src("pp-us-merchant", "PayPal Merchant Fees", "https://www.paypal.com/us/business/paypal-business-fees", "PayPal US")];
const METHODS: Record<string, { label: string; rate: number; fixed: number; cap?: number; text: string }> = {
  paypal: { label: "PayPal or Venmo", rate: 3.49, fixed: 49, text: "3.49% + $0.49" },
  card: { label: "Card or Apple Pay", rate: 2.99, fixed: 49, text: "2.99% + $0.49" },
  paylater: { label: "Pay Later", rate: 4.99, fixed: 49, text: "4.99% + $0.49" },
  bank: { label: "Bank (ACH)", rate: 1, fixed: 0, cap: 1000, text: "1%, at most $10" },
};

function calculate(inputs: Inputs, market: Market) {
  const money = moneyFor(market);
  const amount = toCents(num(inputs, "amount"));
  const key = str(inputs, "method", "paypal");
  const m = METHODS[key] ?? METHODS.paypal;
  const fee = !amount ? 0 : m.cap ? capped(amount, m.rate, undefined, m.cap) : pct(amount, m.rate) + m.fixed;
  const fees: Line[] = [{ id: "invoice", label: `Invoice fee · ${m.label}`, amount: fee, kind: "payment", detail: m.cap ? `1% × ${money(amount)}${fee === m.cap ? " → capped at $10.00" : ""}` : `${m.rate}% × ${money(amount)} + $0.49`, explain: `A PayPal invoice paid with ${m.label.toLowerCase()} costs ${m.text}. You choose which payment methods the invoice accepts.`, source: "pp-us-merchant" }];
  if (bool(inputs, "intl") && key !== "bank") fees.push({ id: "intl", label: "International fee (1.50%)", amount: pct(amount, 1.5), kind: "payment", detail: `1.50% × ${money(amount)}`, explain: "A client paying from outside the US adds 1.50%.", source: "pp-us-merchant" });
  const notes: string[] = [];
  if (amount > 0) {
    const others = Object.entries(METHODS).filter(([k]) => k !== key).map(([, x]) => `${x.label} ${money(x.cap ? capped(amount, x.rate, undefined, x.cap) : pct(amount, x.rate) + x.fixed)}`);
    notes.push(`The same invoice paid another way: ${others.join(" · ")}.`);
    if (key !== "bank" && amount >= 50000) notes.push(`On an invoice this size, accepting bank (ACH) payment caps the fee at $10.00 instead of ${money(fee)}.`);
  }
  return assemble({ market, buyerPays: amount, saleAmount: amount, fees, costs: costs(inputs), notes });
}

const def: CalculatorDef = {
  slug: "paypal-invoice",
  name: "PayPal Invoice",
  path: "/paypal-invoice-fee-calculator",
  category: "payments",
  priceNoun: "invoice amount",
  sellerNoun: "freelancer",
  buyerNoun: "client",
  blurb: "3.49% + $0.49 via PayPal, 2.99% + $0.49 by card, 1% (max $10) by bank",
  markets: [M.us],
  defaultMarket: "us",
  priceField: "amount",
  fields: [
    { id: "amount", kind: "money", label: "Invoice amount", section: "sale" },
    { id: "method", kind: "segmented", label: "How does the client pay?", section: "sale", options: Object.entries(METHODS).map(([value, x]) => ({ value, label: x.label })) },
    { id: "intl", kind: "toggle", label: "The client is outside the US (+1.50%)", section: "options" },
    ...COSTS,
  ],
  defaults: () => ({ amount: 500, method: "paypal", intl: false, itemCost: 0, otherCost: 0 }),
  calculate,
  breakpoints: (i) => (str(i, "method", "paypal") === "bank" ? [1000] : []),
  verifiedAt: CHECKED,
  sources,
  changes: [],
  schedule: () => Object.values(METHODS).map((x) => ({ fee: `Invoice paid with ${x.label}`, amount: x.text, appliesTo: "Invoice amount", source: "pp-us-merchant" })),
};
export default def;
