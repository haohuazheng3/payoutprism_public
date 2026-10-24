/*
 * PayPal goods and services, seller side (US). PayPal Merchant Fees (last updated October 1, 2026),
 * checked 2026-10-24: "Send/Receive Money for Goods and Services 2.99%", no fixed fee, for personal and
 * business accounts; international transactions add 1.50%; PayPal converts at a rate including a
 * 3.00% spread when it converts money you receive. (Checkout buttons are 3.49% + $0.49: see paypal.ts.)
 */
import { M } from "../markets";
import { assemble, bool, moneyFor, num, pct, toCents } from "../money";
import type { CalculatorDef, Inputs, Line, Market } from "../types";
import { CHECKED, COSTS, costs, src } from "./_kit";

const sources = [
  src("pp-us-merchant", "PayPal Merchant Fees", "https://www.paypal.com/us/business/paypal-business-fees", "PayPal US"),
  src("pp-us-consumer", "PayPal Consumer Fees", "https://www.paypal.com/us/digital-wallet/paypal-consumer-fees", "PayPal US"),
];
const GS = { rate: 2.99, fixed: 0 };

function calculate(inputs: Inputs, market: Market) {
  const money = moneyFor(market);
  const price = toCents(num(inputs, "price"));
  const intl = bool(inputs, "intl");
  const fx = bool(inputs, "fx");
  const fees: Line[] = [
    { id: "gs", label: "Goods & services fee (2.99%)", amount: price ? pct(price, GS.rate) + GS.fixed : 0, kind: "payment", detail: `2.99% × ${money(price)}`, explain: "When a buyer sends you money marked as goods and services, PayPal charges you 2.99% of the payment, with no fixed fee. (Payments through PayPal Checkout buttons cost 3.49% + $0.49.)", source: "pp-us-merchant" },
  ];
  if (intl) fees.push({ id: "intl", label: "International fee (1.50%)", amount: pct(price, 1.5), kind: "payment", detail: `1.50% × ${money(price)}`, explain: "Payments from a buyer outside the US add 1.50% on top of the goods and services rate.", source: "pp-us-merchant" });
  if (fx) fees.push({ id: "fx", label: "Currency conversion spread (3%)", amount: pct(price, 3), kind: "payment", detail: `≈3% × ${money(price)}`, explain: "When PayPal converts money you receive into dollars, its exchange rate includes a 3.00% spread over the base rate.", source: "pp-us-merchant" });
  const total = fees.reduce((s, l) => s + l.amount, 0);
  const notes: string[] = [];
  if (price > 0) {
    let gross = Math.floor((price + GS.fixed) / (1 - GS.rate / 100));
    while (gross - pct(gross, GS.rate) - GS.fixed < price) gross++;
    notes.push(`To receive the full ${money(price)}, ask for ${money(gross)}: PayPal’s fee is charged on the larger amount too.`);
    notes.push(`Through a PayPal Checkout button the same payment would cost ${money(pct(price, 3.49) + 49)} (3.49% + $0.49): goods and services has no fixed fee.`);
  }
  void total;
  return assemble({ market, buyerPays: price, saleAmount: price, fees, costs: costs(inputs), notes });
}

const def: CalculatorDef = {
  slug: "paypal-goods-and-services",
  name: "PayPal Goods & Services",
  path: "/paypal-goods-and-services-fee-calculator",
  category: "payments",
  priceNoun: "payment",
  sellerNoun: "seller",
  buyerNoun: "buyer",
  blurb: "2.99% with no fixed fee per goods and services payment; +1.50% from abroad",
  markets: [M.us],
  defaultMarket: "us",
  priceField: "price",
  fields: [
    { id: "price", kind: "money", label: "Payment amount", section: "sale", help: "Everything the buyer sends, including any shipping you charge." },
    { id: "intl", kind: "toggle", label: "The buyer is outside the US (+1.50%)", section: "options" },
    { id: "fx", kind: "toggle", label: "They pay in another currency and PayPal converts it", section: "options", advanced: true },
    ...COSTS,
  ],
  defaults: () => ({ price: 100, intl: false, fx: false, itemCost: 0, otherCost: 0 }),
  calculate,
  breakpoints: () => [],
  verifiedAt: CHECKED,
  sources,
  changes: [],
  schedule: () => [
    { fee: "Goods and services (send/receive)", amount: "2.99%, no fixed fee", appliesTo: "Each payment", when: "Paid by the seller; personal and business accounts", source: "pp-us-merchant" },
    { fee: "PayPal Checkout button (for comparison)", amount: "3.49% + $0.49", appliesTo: "Each payment", when: "Buyer pays through a checkout button", source: "pp-us-merchant" },
    { fee: "International", amount: "+1.50%", appliesTo: "Each payment", when: "Buyer outside the US", source: "pp-us-merchant" },
    { fee: "Currency conversion", amount: "3.00% spread", appliesTo: "Converted amount", when: "PayPal converts what you receive", source: "pp-us-merchant" },
  ],
};
export default def;
