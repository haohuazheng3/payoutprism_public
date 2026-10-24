/*
 * Generic card-processing cost: a per-sale percentage + fixed fee (any processor, or a preset
 * taken from the processor's own published rate, each checked 2026-10-24 and cited), scaled to a
 * month of sales, plus any monthly software or plan fee.
 */
import { M } from "../markets";
import { assemble, formatRate, moneyFor, num, pct, str, toCents } from "../money";
import type { CalculatorDef, Inputs, Line, Market } from "../types";
import { CHECKED, src } from "./_kit";

const sources = [
  src("square", "Understanding Our Fees | Square Payments", "https://squareup.com/us/en/payments/our-fees", "Square"),
  src("stripe", "Pricing & Fees", "https://stripe.com/pricing", "Stripe"),
  src("pp-us-merchant", "PayPal Merchant Fees", "https://www.paypal.com/us/business/paypal-business-fees", "PayPal US"),
  src("clover", "Clover Flex pricing", "https://www.clover.com/pricing/flex", "Clover"),
  src("qb", "QuickBooks Payments rates", "https://quickbooks.intuit.com/payments/payment-rates/", "Intuit QuickBooks"),
];
export const PRESETS: Record<string, { label: string; rate: number; fixed: number; source?: string; note: string }> = {
  "square-in": { label: "Square · in person", rate: 2.6, fixed: 15, source: "square", note: "Square Free plan, tap, dip or swipe" },
  "square-online": { label: "Square · online", rate: 3.3, fixed: 30, source: "square", note: "Square Free plan, online checkout" },
  stripe: { label: "Stripe · online card", rate: 2.9, fixed: 30, source: "stripe", note: "Standard domestic card" },
  paypal: { label: "PayPal · checkout", rate: 3.49, fixed: 49, source: "pp-us-merchant", note: "PayPal Checkout" },
  "clover-in": { label: "Clover Starter · in person", rate: 2.6, fixed: 10, source: "clover", note: "Card tapped, swiped or inserted" },
  "qb-invoice": { label: "QuickBooks · invoice by card", rate: 2.99, fixed: 0, source: "qb", note: "Invoices, recurring payments, payment links" },
  "qb-in": { label: "QuickBooks · in person", rate: 2.5, fixed: 0, source: "qb", note: "Card reader or Tap to Pay" },
  custom: { label: "My own rate", rate: 2.9, fixed: 30, note: "Typed in" },
};

function rateOf(inputs: Inputs) {
  const key = str(inputs, "processor", "square-in");
  const p = PRESETS[key] ?? PRESETS["square-in"];
  if (key !== "custom") return { ...p, key };
  return { ...p, key, rate: Math.min(10, Math.max(0, num(inputs, "rate", 2.9))), fixed: toCents(num(inputs, "fixed", 0.3)) };
}

function calculate(inputs: Inputs, market: Market) {
  const money = moneyFor(market);
  const avg = toCents(num(inputs, "average"));
  const count = Math.max(1, Math.round(num(inputs, "count", 1)));
  const monthly = toCents(num(inputs, "monthly"));
  const p = rateOf(inputs);
  const volume = avg * count;
  const perSale = pct(avg, p.rate) + p.fixed;
  const fees: Line[] = [
    { id: "pct", label: `Percentage fee (${formatRate(p.rate)})`, amount: pct(avg, p.rate) * count, kind: "payment", detail: `${formatRate(p.rate)} × ${money(avg)} × ${count} sales`, explain: `${p.label}: ${formatRate(p.rate)} of each sale${p.source ? ", from the processor’s published rate" : ""}.`, source: p.source },
  ];
  if (p.fixed) fees.push({ id: "fixed", label: `Fixed fee (${money(p.fixed)} per sale)`, amount: p.fixed * count, kind: "payment", detail: `${money(p.fixed)} × ${count}`, explain: "A flat amount on every transaction, whatever its size: the reason small sales cost proportionally more.", source: p.source });
  if (monthly) fees.push({ id: "monthly", label: "Monthly plan or software", amount: monthly, kind: "subscription", detail: "per month", explain: "Any fixed monthly fee for the plan, terminal software or gateway, spread over the month’s sales." });
  const total = fees.reduce((s, l) => s + l.amount, 0);
  const notes: string[] = [];
  if (avg > 0) {
    notes.push(`Each ${money(avg)} sale costs ${money(perSale)} (${((perSale / avg) * 100).toFixed(2)}%); over ${count} sales that’s ${money(total)} a month, ${volume ? ((total / volume) * 100).toFixed(2) : "0"}% of your card volume.`);
    if (p.fixed && avg < 1500) notes.push(`The ${money(p.fixed)} fixed fee is ${((p.fixed / avg) * 100).toFixed(1)}% of a ${money(avg)} sale on its own: for small tickets, a lower fixed fee matters more than the percentage.`);
  }
  return assemble({ market, buyerPays: volume, saleAmount: volume, fees, notes });
}

const def: CalculatorDef = {
  slug: "credit-card-processing",
  name: "Credit Card Processing",
  path: "/credit-card-processing-fee-calculator",
  category: "payments",
  priceNoun: "average sale",
  sellerNoun: "business",
  saleNoun: "month of card sales",
  buyerNoun: "customers",
  blurb: "Per-sale and monthly card fees for Square, Stripe, PayPal, Clover, QuickBooks or any rate",
  keepHead: "You keep this month",
  modes: false,
  markets: [M.us],
  defaultMarket: "us",
  priceField: "average",
  fields: [
    { id: "average", kind: "money", label: "Average card sale", section: "sale" },
    { id: "count", kind: "number", label: "Card sales per month", section: "sale", min: 1, integer: true },
    { id: "processor", kind: "select", label: "Processor and rate", section: "sale", options: Object.entries(PRESETS).map(([value, p]) => ({ value, label: p.label, hint: value === "custom" ? undefined : `${formatRate(p.rate)}${p.fixed ? ` + ${p.fixed}¢` : ""}` })) },
    { id: "rate", kind: "percent", label: "Your percentage rate", section: "sale", max: 10, step: 0.01, showIf: (i) => str(i, "processor") === "custom" },
    { id: "fixed", kind: "money", label: "Your fixed fee per sale", section: "sale", showIf: (i) => str(i, "processor") === "custom" },
    { id: "monthly", kind: "money", label: "Monthly fees (plan, software)", section: "options", help: "Optional: any fixed monthly cost, to see your all-in effective rate." },
  ],
  defaults: () => ({ average: 40, count: 300, processor: "square-in", rate: 2.9, fixed: 0.3, monthly: 0 }),
  calculate,
  breakpoints: () => [],
  verifiedAt: CHECKED,
  sources,
  changes: [],
  schedule: () => Object.entries(PRESETS).filter(([k]) => k !== "custom").map(([, p]) => ({ fee: p.label, amount: `${formatRate(p.rate)}${p.fixed ? ` + ${p.fixed}¢` : ""}`, appliesTo: "Each card sale", when: p.note, source: p.source })),
};
export default def;
