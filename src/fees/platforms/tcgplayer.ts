/*
 * TCGplayer marketplace seller fees (US). "TCGplayer Fees" + "Fee Calculation Examples", checked 2026-10-24:
 *  - Marketplace Commission: Level 1–4 10.75%, Pro/Sync 9.25%, on items (capped at $75 per product)
 *    and on shipping (no cap), each its own line.
 *  - Pro Fee (Pro sellers): 2.5% on items (cap $75 per product) and on shipping.
 *  - Transaction fee: 2.5% × order total (items + shipping + sales tax) + $0.30; international 3.5% + $0.30.
 * Official example reproduced in tests: $65.31 item + $0.99 shipping, 7% tax → $7.02 + $0.11 + $2.07 = $9.20.
 */
import { M } from "../markets";
import { assemble, bool, moneyFor, num, pct, str, toCents } from "../money";
import type { CalculatorDef, Inputs, Line, Market } from "../types";
import { CHECKED, COSTS, costs, src } from "./_kit";

const sources = [
  src("tcg-fees", "TCGplayer Fees", "https://help.tcgplayer.com/hc/en-us/articles/201357836-TCGplayer-Fees", "TCGplayer Help"),
  src("tcg-examples", "Fee Calculation Examples", "https://help.tcgplayer.com/hc/en-us/articles/360047732673-Fee-Calculation-Examples", "TCGplayer Help"),
];
const CAP = 7500;
const LEVELS: Record<string, { label: string; commission: number; pro: number }> = {
  level: { label: "Level 1–4 seller", commission: 10.75, pro: 0 },
  pro: { label: "Pro seller", commission: 9.25, pro: 2.5 },
};

function calculate(inputs: Inputs, market: Market) {
  const money = moneyFor(market);
  const items = toCents(num(inputs, "price"));
  const ship = toCents(num(inputs, "shipping"));
  const tax = Math.max(0, Math.min(15, num(inputs, "tax")));
  const lv = LEVELS[str(inputs, "level", "level")] ?? LEVELS.level;
  const intl = bool(inputs, "intl");
  const orderTotal = items + ship + pct(items + ship, tax);
  const fees: Line[] = [
    { id: "commission", label: `Marketplace commission on items (${lv.commission}%)`, amount: Math.min(CAP, pct(items, lv.commission)), kind: "platform", detail: `${lv.commission}% × ${money(items)}${pct(items, lv.commission) > CAP ? " → capped at $75" : ""}`, explain: `${lv.label}s pay ${lv.commission}% of the item price, capped at $75 per product sold.`, source: "tcg-fees" },
    { id: "commissionShip", label: `Commission on shipping (${lv.commission}%)`, amount: pct(ship, lv.commission), kind: "platform", detail: `${lv.commission}% × ${money(ship)}`, explain: "The same commission is charged on the shipping the buyer pays, with no cap.", source: "tcg-examples" },
  ];
  if (lv.pro) {
    fees.push({ id: "pro", label: "Pro fee (2.5%)", amount: Math.min(CAP, pct(items, 2.5)) + pct(ship, 2.5), kind: "subscription", detail: `2.5% × (${money(items)} + ${money(ship)})`, explain: "Pro sellers pay 2.5% on online sales shipped to customers, for the Pro tools.", source: "tcg-fees" });
  }
  fees.push({ id: "transaction", label: `Transaction fee (${intl ? "3.5" : "2.5"}% + $0.30)`, amount: items ? pct(orderTotal, intl ? 3.5 : 2.5) + 30 : 0, kind: "payment", detail: `${intl ? "3.5" : "2.5"}% × ${money(orderTotal)} + $0.30`, explain: `Payment processing on the whole order: items, shipping and sales tax. ${intl ? "International orders cost 3.5% + $0.30." : "International orders cost 3.5% + $0.30."}`, source: "tcg-fees" });
  const sale = items + ship;
  const notes: string[] = [];
  if (items > 0 && items < 300) notes.push(`On a ${money(items)} card the fixed $0.30 alone is ${((30 / items) * 100).toFixed(0)}% of the price: bundle cheap singles into one order where you can.`);
  if (pct(items, lv.commission) > CAP) notes.push("You’ve hit the $75 commission cap for this product: everything above it pays only the transaction fee.");
  if (tax === 0 && items > 0) notes.push("Buyers in most states pay sales tax, and the transaction fee is charged on it: add the rate under Options for an exact payout.");
  return assemble({ market, buyerPays: orderTotal, saleAmount: sale, fees, buyerFees: tax ? [{ id: "tax", label: "Sales tax (paid by the buyer)", amount: orderTotal - sale, kind: "tax", explain: "Collected by TCGplayer; it raises the order total the transaction fee is charged on." }] : [], costs: costs(inputs), notes });
}

const def: CalculatorDef = {
  slug: "tcgplayer",
  name: "TCGplayer",
  path: "/tcgplayer-fee-calculator",
  category: "marketplaces",
  priceNoun: "item price",
  sellerNoun: "seller",
  buyerNoun: "buyer",
  blurb: "10.75% commission (cap $75) + 2.5% + $0.30 transaction fee on the order total",
  markets: [M.us],
  defaultMarket: "us",
  priceField: "price",
  fields: [
    { id: "price", kind: "money", label: "Item price", section: "sale", help: "What the card or product sells for (all items in the order)." },
    { id: "shipping", kind: "money", label: "Shipping the buyer pays", section: "shipping" },
    { id: "level", kind: "segmented", label: "Seller account", section: "sale", options: [{ value: "level", label: "Level 1–4 · 10.75%" }, { value: "pro", label: "Pro · 9.25% + 2.5%" }] },
    { id: "tax", kind: "percent", label: "Buyer’s sales tax", section: "options", max: 15, step: 0.01, help: "The transaction fee is charged on the order total including tax." },
    { id: "intl", kind: "toggle", label: "International order (3.5% + $0.30)", section: "options", advanced: true },
    ...COSTS,
  ],
  defaults: () => ({ price: 20, shipping: 1.49, level: "level", tax: 0, intl: false, itemCost: 0, otherCost: 0 }),
  calculate,
  breakpoints: (i) => [Math.round((CAP / (LEVELS[str(i, "level", "level")] ?? LEVELS.level).commission) * 100) / 100],
  verifiedAt: CHECKED,
  sources,
  changes: [],
  schedule: () => [
    { fee: "Marketplace commission (Level 1–4)", amount: "10.75%", appliesTo: "Items (cap $75 per product) and shipping", source: "tcg-fees" },
    { fee: "Marketplace commission (Pro / Sync)", amount: "9.25%", appliesTo: "Items (cap $75 per product) and shipping", source: "tcg-fees" },
    { fee: "Pro fee", amount: "2.5%", appliesTo: "Items (cap $75) and shipping", when: "Pro sellers, shipped online sales", source: "tcg-fees" },
    { fee: "Transaction fee", amount: "2.5% + $0.30", appliesTo: "Order total: items + shipping + tax", source: "tcg-fees" },
    { fee: "International transaction fee", amount: "3.5% + $0.30", appliesTo: "Order total", source: "tcg-fees" },
  ],
  compare: { group: "sell", map: (c) => ({ price: c.price, shipping: c.shipping, itemCost: c.itemCost }), note: "Level 1–4 seller, no sales tax" },
};
export default def;
