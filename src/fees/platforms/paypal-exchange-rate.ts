/*
 * PayPal currency conversion (US account). PayPal Merchant / Consumer Fees, checked 2026-10-24:
 * PayPal converts at a rate built from its base exchange rate plus a spread: 3.00% when converting
 * money you receive or a balance; 4.00% when you pay or send in another currency (US consumer).
 * The base rate isn't published, so the mid-market reference here is the ECB daily reference rate
 * (FX_DATE); PayPal's own base rate can differ slightly.
 */
import { M } from "../markets";
import { FX_DATE, FX_SOURCE, perUsd } from "../fx";
import { assemble, formatMoney, moneyFor, num, pct, str, toCents } from "../money";
import type { CalculatorDef, CurrencyCode, Inputs, Market } from "../types";
import { CHECKED, src } from "./_kit";

const sources = [
  src("pp-us-merchant", "PayPal Merchant Fees", "https://www.paypal.com/us/business/paypal-business-fees", "PayPal US"),
  src("pp-us-consumer", "PayPal Consumer Fees", "https://www.paypal.com/us/digital-wallet/paypal-consumer-fees", "PayPal US"),
  src("ecb", "Euro foreign exchange reference rates", FX_SOURCE, "European Central Bank", FX_DATE),
];
const TARGETS: { value: CurrencyCode; label: string; locale: string }[] = [
  { value: "EUR", label: "Euro (EUR)", locale: "de-DE" },
  { value: "GBP", label: "British pound (GBP)", locale: "en-GB" },
  { value: "CAD", label: "Canadian dollar (CAD)", locale: "en-CA" },
  { value: "AUD", label: "Australian dollar (AUD)", locale: "en-AU" },
  { value: "MXN", label: "Mexican peso (MXN)", locale: "es-MX" },
  { value: "JPY", label: "Japanese yen (JPY)", locale: "ja-JP" },
  { value: "INR", label: "Indian rupee (INR)", locale: "en-IN" },
  { value: "CHF", label: "Swiss franc (CHF)", locale: "de-CH" },
];
const SPREAD: Record<string, { rate: number; text: string; source: string }> = {
  receive: { rate: 3, text: "3.00% spread when PayPal converts money you receive or your balance", source: "pp-us-merchant" },
  send: { rate: 4, text: "4.00% spread when you pay or send money in another currency", source: "pp-us-consumer" },
};

function calculate(inputs: Inputs, market: Market) {
  const money = moneyFor(market);
  const amount = toCents(num(inputs, "amount"));
  const t = TARGETS.find((x) => x.value === str(inputs, "to", "EUR")) ?? TARGETS[0];
  const dir = SPREAD[str(inputs, "direction", "send")] ?? SPREAD.send;
  const mid = perUsd(t.value);
  const pp = mid * (1 - dir.rate / 100);
  const spreadCost = pct(amount, dir.rate);
  const fx = (usdCents: number, r: number) => formatMoney(Math.round(usdCents * r), t.value, t.locale);
  const notes = amount > 0
    ? [
        `At the ${FX_DATE} reference rate ${money(amount)} is ${fx(amount, mid)}; at PayPal’s rate (≈${pp.toFixed(4)} ${t.value} per $1) you get about ${fx(amount, pp)}.`,
        `The spread costs you about ${money(spreadCost)} on this amount. A bank or a specialist transfer service that converts at close to the mid-market rate keeps most of it.`,
        "PayPal shows its exact rate before you confirm: compare it with today’s mid-market rate to see the real spread.",
      ]
    : [];
  return assemble({
    market,
    buyerPays: amount,
    saleAmount: amount,
    fees: [{ id: "spread", label: `PayPal exchange-rate spread (${dir.rate}%)`, amount: spreadCost, kind: "payment", detail: `${dir.rate}% × ${money(amount)} (in dollar value)`, explain: `PayPal doesn’t charge a separate line for converting: its exchange rate includes a ${dir.text}. This is what that spread is worth compared with the mid-market rate.`, source: dir.source }],
    notes,
  });
}

const def: CalculatorDef = {
  slug: "paypal-exchange-rate",
  name: "PayPal Exchange Rate",
  path: "/paypal-exchange-rate-calculator",
  category: "payments",
  priceNoun: "amount in dollars",
  sellerNoun: "account holder",
  saleNoun: "conversion",
  blurb: "PayPal’s rate vs the mid-market rate: a 3% (receiving) or 4% (paying) spread",
  keepHead: "Value after PayPal converts",
  receiveLabel: "Value you get (in dollars)",
  modes: false,
  markets: [M.us],
  defaultMarket: "us",
  priceField: "amount",
  fields: [
    { id: "amount", kind: "money", label: "Amount in US dollars", section: "sale" },
    { id: "to", kind: "select", label: "Converting to", section: "sale", options: TARGETS.map((x) => ({ value: x.value, label: x.label })) },
    { id: "direction", kind: "segmented", label: "What are you doing?", section: "sale", options: [{ value: "send", label: "Paying or sending · 4%" }, { value: "receive", label: "Receiving or converting a balance · 3%" }] },
  ],
  defaults: () => ({ amount: 500, to: "EUR", direction: "send" }),
  calculate,
  breakpoints: () => [],
  verifiedAt: CHECKED,
  sources,
  changes: [],
  schedule: () => [
    { fee: "Paying or sending in another currency", amount: "4.00% spread", appliesTo: "Converted amount", source: "pp-us-consumer" },
    { fee: "Receiving or converting a balance", amount: "3.00% spread", appliesTo: "Converted amount", source: "pp-us-merchant" },
    { fee: "Reference rate used here", amount: `ECB, ${FX_DATE}`, appliesTo: "Mid-market comparison", source: "ecb" },
  ],
};
export default def;
