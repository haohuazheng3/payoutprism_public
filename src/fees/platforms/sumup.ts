/* SumUp UK. sumup.com/en-gb/pricing, checked 2026-10-24: pay-as-you-go 1.69% in person (all cards, incl. Amex and premium), 2.5% online (payment links, bookings, digital products); Payments Plus £19/month: 0.99% for domestic debit and credit cards in person (Amex/premium 1.69%); 0% when the customer pays with a SumUp personal card. */
import { M } from "../markets";
import { assemble, formatRate, moneyFor, num, pct, str, toCents } from "../money";
import type { CalculatorDef, Inputs, Market } from "../types";
import { CHECKED, src } from "./_kit";

const sources = [src("sumup-pricing", "SumUp pricing", "https://www.sumup.com/en-gb/pricing/", "SumUp UK")];
const TYPES: Record<string, { label: string; payg: number; plus: number }> = {
  domestic: { label: "In person · UK debit or credit card", payg: 1.69, plus: 0.99 },
  premium: { label: "In person · Amex, premium or international card", payg: 1.69, plus: 1.69 },
  online: { label: "Online · payment link, booking, digital", payg: 2.5, plus: 2.5 },
  sumupcard: { label: "In person · customer’s SumUp card", payg: 0, plus: 0 },
};

function calculate(inputs: Inputs, market: Market) {
  const money = moneyFor(market);
  const amount = toCents(num(inputs, "amount"));
  const t = TYPES[str(inputs, "type", "domestic")] ?? TYPES.domestic;
  const plus = str(inputs, "plan", "payg") === "plus";
  const rate = plus ? t.plus : t.payg;
  const monthly = toCents(num(inputs, "monthly"));
  const notes: string[] = [];
  if (amount > 0) notes.push(plus ? `Pay-as-you-go would charge ${money(pct(amount, t.payg))} on this payment.` : t.plus < t.payg ? `On Payments Plus (£19 a month) this payment would cost ${money(pct(amount, t.plus))}.` : "This payment type costs the same on both plans.");
  if (monthly > 0) notes.push(`Payments Plus pays for itself above about ${money(Math.round(1900 / ((1.69 - 0.99) / 100)))} a month of UK card sales in person: at ${money(monthly)} you’d ${monthly * 0.007 > 1900 ? "save" : "lose"} ${money(Math.abs(Math.round(monthly * 0.007) - 1900))} a month on Plus.`);
  return assemble({ market, buyerPays: amount, saleAmount: amount, fees: [{ id: "sumup", label: `SumUp fee (${formatRate(rate)})`, amount: pct(amount, rate), kind: "payment", detail: `${formatRate(rate)} × ${money(amount)}`, explain: `${t.label} on ${plus ? "Payments Plus" : "pay-as-you-go"}: ${formatRate(rate)} per transaction, no fixed fee.`, source: "sumup-pricing" }], notes });
}

const def: CalculatorDef = {
  slug: "sumup",
  name: "SumUp",
  path: "/sumup-fee-calculator",
  category: "payments",
  priceNoun: "payment",
  sellerNoun: "business",
  buyerNoun: "customer",
  blurb: "1.69% in person, 2.5% online; 0.99% on UK cards with Payments Plus (£19/mo)",
  markets: [M.uk],
  defaultMarket: "uk",
  priceField: "amount",
  fields: [
    { id: "amount", kind: "money", label: "Payment amount", section: "sale" },
    { id: "type", kind: "select", label: "How the customer pays", section: "sale", options: Object.entries(TYPES).map(([value, t]) => ({ value, label: t.label })) },
    { id: "plan", kind: "segmented", label: "SumUp plan", section: "sale", options: [{ value: "payg", label: "Pay-as-you-go" }, { value: "plus", label: "Payments Plus · £19/mo" }] },
    { id: "monthly", kind: "money", label: "Your monthly in-person card sales", section: "options", help: "To see whether Payments Plus is worth it." },
  ],
  defaults: () => ({ amount: 25, type: "domestic", plan: "payg", monthly: 0 }),
  calculate,
  breakpoints: () => [],
  verifiedAt: CHECKED,
  sources,
  changes: [],
  schedule: () => Object.values(TYPES).map((t) => ({ fee: t.label, amount: `${formatRate(t.payg)} · Plus ${formatRate(t.plus)}`, appliesTo: "Each payment", source: "sumup-pricing" })),
};
export default def;
