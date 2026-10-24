/*
 * Craft pricing: materials + your time at an hourly wage + overhead, then a retail list price run
 * through Etsy's own engine (US defaults) so the result is what you keep after selling it there.
 */
import { M } from "../markets";
import { assemble, moneyFor, num, pct, toCents } from "../money";
import type { CalculatorDef, Inputs, Market } from "../types";
import { CHECKED } from "./_kit";
import etsy from "./etsy";

function calculate(inputs: Inputs, market: Market) {
  const money = moneyFor(market);
  const price = num(inputs, "price");
  const materials = toCents(num(inputs, "materials"));
  const hours = Math.max(0, num(inputs, "hours"));
  const wage = toCents(num(inputs, "wage"));
  const overheadPct = Math.max(0, Math.min(100, num(inputs, "overhead")));
  const labor = Math.round(hours * wage);
  const overhead = pct(materials + labor, overheadPct);
  const cost = materials + labor + overhead;
  const m = etsy.markets.find((x) => x.id === "us") ?? etsy.markets[0];
  const r = etsy.calculate({ ...etsy.defaults(m), price, shippingCharged: 0, itemCost: 0, shippingCost: 0, otherCost: 0 }, m);
  const formulaWholesale = cost * 2;
  const formulaRetail = formulaWholesale * 2;
  return assemble({
    market,
    buyerPays: r.buyerPays,
    saleAmount: r.saleAmount,
    fees: r.fees,
    buyerFees: r.buyerFees,
    payout: r.payout,
    costs: [
      ...(materials ? [{ id: "materials", label: "Materials", amount: materials, kind: "cost" as const }] : []),
      ...(labor ? [{ id: "labor", label: `Your time (${hours} h × ${money(wage)})`, amount: labor, kind: "cost" as const }] : []),
      ...(overhead ? [{ id: "overhead", label: `Overhead (${overheadPct}%)`, amount: overhead, kind: "cost" as const }] : []),
    ],
    notes: cost > 0 ? [`The classic formula: cost ${money(cost)} × 2 = wholesale ${money(formulaWholesale)}, × 2 = retail ${money(formulaRetail)}.`, "Profit here is what’s left after paying yourself the hourly wage above, so even a small positive number means the price is fair."] : [],
  });
}

const def: CalculatorDef = {
  slug: "craft-pricing",
  name: "Craft Pricing",
  path: "/craft-pricing-calculator",
  category: "marketplaces",
  priceNoun: "retail price",
  sellerNoun: "maker",
  saleNoun: "piece",
  buyerNoun: "buyer",
  blurb: "Materials + time + overhead → a fair retail price, after Etsy fees",
  markets: [M.us],
  defaultMarket: "us",
  priceField: "price",
  fields: [
    { id: "price", kind: "money", label: "Retail price you’re considering", section: "sale" },
    { id: "materials", kind: "money", label: "Materials per piece", section: "costs" },
    { id: "hours", kind: "number", label: "Hours to make one", section: "costs", min: 0, step: 0.25 },
    { id: "wage", kind: "money", label: "Your hourly wage", section: "costs" },
    { id: "overhead", kind: "percent", label: "Overhead (tools, studio, packaging)", section: "costs", max: 100, step: 1 },
  ],
  defaults: () => ({ price: 45, materials: 6, hours: 1, wage: 20, overhead: 10 }),
  calculate,
  breakpoints: () => [],
  verifiedAt: CHECKED,
  sources: etsy.sources,
  changes: [],
  schedule: () => [{ fee: "Formula", amount: "(materials + labor + overhead) × 2 × 2", appliesTo: "Wholesale, then retail" }, ...etsy.schedule(etsy.markets[0])],
};
export default def;
