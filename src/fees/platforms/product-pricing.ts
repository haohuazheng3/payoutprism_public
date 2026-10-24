/*
 * Product pricing: run a list price through a chosen marketplace's own calculator (same engine as
 * that platform's page) and subtract your costs. The reverse mode then solves for the price that
 * hits a target profit or margin after that platform's fees.
 */
import { M } from "../markets";
import { assemble, moneyFor, num, str, toCents } from "../money";
import type { CalculatorDef, Inputs, Market } from "../types";
import { CHECKED } from "./_kit";
import etsy from "./etsy";
import ebay from "./ebay";
import amazon from "./amazon";
import poshmark from "./poshmark";
import mercari from "./mercari";
import depop from "./depop";
import shopify from "./shopify";
import tiktokShop from "./tiktok-shop";
import walmart from "./walmart";

export const PLATFORMS: CalculatorDef[] = [etsy, ebay, amazon, shopify, poshmark, mercari, depop, tiktokShop, walmart];

function platform(inputs: Inputs) {
  return PLATFORMS.find((d) => d.slug === str(inputs, "platform", "etsy")) ?? etsy;
}

function run(def: CalculatorDef, price: number, ship: number) {
  const m = def.markets.find((x) => x.id === "us") ?? def.markets[0];
  const base = def.defaults(m);
  const inputs: Inputs = { ...base, [def.priceField]: price };
  for (const k of ["shipping", "shippingCharged"]) if (k in base) inputs[k] = ship;
  for (const k of ["itemCost", "shippingCost", "otherCost"]) if (k in base) inputs[k] = 0;
  return def.calculate(inputs, m);
}

function calculate(inputs: Inputs, market: Market) {
  const money = moneyFor(market);
  const def = platform(inputs);
  const price = num(inputs, "price");
  const r = run(def, price, num(inputs, "shipping"));
  const unit = toCents(num(inputs, "unitCost"));
  const label = toCents(num(inputs, "labelCost"));
  const other = toCents(num(inputs, "otherCost"));
  const costs = [
    ...(unit ? [{ id: "unitCost", label: "Product cost", amount: unit, kind: "cost" as const }] : []),
    ...(label ? [{ id: "labelCost", label: "Shipping label", amount: label, kind: "cost" as const }] : []),
    ...(other ? [{ id: "otherCost", label: "Packaging & other", amount: other, kind: "cost" as const }] : []),
  ];
  return assemble({
    market,
    buyerPays: r.buyerPays,
    saleAmount: r.saleAmount,
    fees: r.fees,
    buyerFees: r.buyerFees,
    costs,
    notes: [`Fees use ${def.name}’s standard settings from our ${def.name} calculator; open it to change category, ads or payment options.`, ...(unit && price ? [`Cost-plus pricing would say ${money(unit * 2)} (double your cost); after ${def.name}’s fees that leaves ${money(run(def, (unit * 2) / 100, num(inputs, "shipping")).payout - unit - label - other)}.`] : [])],
    payout: r.payout,
  });
}

const def: CalculatorDef = {
  slug: "product-pricing",
  name: "Product Pricing",
  path: "/product-pricing-calculator",
  category: "marketplaces",
  priceNoun: "list price",
  sellerNoun: "seller",
  buyerNoun: "buyer",
  blurb: "The price that leaves your target profit after Etsy, eBay, Amazon, Shopify and more",
  markets: [M.us],
  defaultMarket: "us",
  priceField: "price",
  fields: [
    { id: "platform", kind: "select", label: "Where you sell", section: "sale", options: PLATFORMS.map((d) => ({ value: d.slug, label: d.name })) },
    { id: "price", kind: "money", label: "List price", section: "sale" },
    { id: "shipping", kind: "money", label: "Shipping you charge", section: "shipping" },
    { id: "unitCost", kind: "money", label: "Product cost", section: "costs" },
    { id: "labelCost", kind: "money", label: "Shipping label", section: "costs" },
    { id: "otherCost", kind: "money", label: "Packaging & other", section: "costs" },
  ],
  defaults: () => ({ platform: "etsy", price: 40, shipping: 0, unitCost: 12, labelCost: 5, otherCost: 1 }),
  calculate,
  breakpoints: (i) => {
    const d = platform(i);
    const m = d.markets.find((x) => x.id === "us") ?? d.markets[0];
    return d.breakpoints?.({ ...d.defaults(m) }, m) ?? [];
  },
  verifiedAt: CHECKED,
  sources: [...new Map(PLATFORMS.flatMap((d) => d.sources).map((x) => [x.id, x])).values()],
  changes: [],
  schedule: () => PLATFORMS.map((d) => ({ fee: d.name, amount: d.blurb, appliesTo: "Each sale" })),
};
export default def;
