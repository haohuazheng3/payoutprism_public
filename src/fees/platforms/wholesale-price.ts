/*
 * Wholesale and retail pricing for makers and small brands: unit cost → wholesale price (your
 * margin) → suggested retail price (the stockist's margin). Pure arithmetic; the optional payment
 * fee is the processor rate you pay when the stockist pays your invoice.
 */
import { M } from "../markets";
import { assemble, formatRate, moneyFor, num, pct, toCents } from "../money";
import type { CalculatorDef, Inputs, Market } from "../types";
import { CHECKED } from "./_kit";

function calculate(inputs: Inputs, market: Market) {
  const money = moneyFor(market);
  const wholesale = toCents(num(inputs, "price"));
  const unit = toCents(num(inputs, "unitCost"));
  const mult = Math.max(1, Math.min(5, num(inputs, "retailMultiple", 2)));
  const feeRate = Math.max(0, Math.min(5, num(inputs, "feeRate")));
  const retail = Math.round(wholesale * mult);
  const fees = feeRate ? [{ id: "payment", label: `Invoice payment fee (${formatRate(feeRate)})`, amount: pct(wholesale, feeRate), kind: "payment" as const, detail: `${formatRate(feeRate)} × ${money(wholesale)}`, explain: "What your processor charges when the stockist pays your invoice by card." }] : [];
  const notes: string[] = [];
  if (wholesale > 0) {
    notes.push(`Suggested retail at ${mult}×: ${money(retail)}. The stockist’s margin is ${money(retail - wholesale)} (${(((retail - wholesale) / retail) * 100).toFixed(0)}% of retail).`);
    if (unit) notes.push(`Your markup on cost is ${(((wholesale - unit) / unit) * 100).toFixed(0)}%; selling direct at ${money(retail)} you’d make ${money(retail - unit)} before platform fees.`);
  }
  return assemble({ market, buyerPays: wholesale, saleAmount: wholesale, fees, costs: unit ? [{ id: "unitCost", label: "Unit cost (materials + labor)", amount: unit, kind: "cost" }] : [], notes });
}

const def: CalculatorDef = {
  slug: "wholesale-price",
  name: "Wholesale Price",
  path: "/wholesale-price-calculator",
  category: "marketplaces",
  priceNoun: "wholesale price",
  sellerNoun: "maker",
  saleNoun: "unit",
  buyerNoun: "stockist",
  blurb: "Unit cost to wholesale and retail prices, with your margin and the retailer’s",
  reverseHead: "Set this wholesale price",
  markets: [M.us],
  defaultMarket: "us",
  priceField: "price",
  fields: [
    { id: "price", kind: "money", label: "Wholesale price per unit", section: "sale" },
    { id: "unitCost", kind: "money", label: "Your unit cost", section: "costs", help: "Materials, labor and packaging for one unit." },
    { id: "retailMultiple", kind: "number", label: "Retail multiple", section: "options", min: 1, max: 5, step: 0.1, help: "Most stockists price at about 2× wholesale (keystone); some use 2.2–2.5×." },
    { id: "feeRate", kind: "percent", label: "Payment fee on your invoice", section: "options", max: 5, step: 0.01 },
  ],
  defaults: () => ({ price: 20, unitCost: 8, retailMultiple: 2, feeRate: 0 }),
  calculate,
  breakpoints: () => [],
  verifiedAt: CHECKED,
  sources: [],
  changes: [],
  schedule: () => [{ fee: "Keystone retail", amount: "2× wholesale", appliesTo: "Suggested retail price", when: "Common stockist convention" }, { fee: "Payment fee", amount: "Your processor’s rate", appliesTo: "Wholesale invoice" }],
};
export default def;
