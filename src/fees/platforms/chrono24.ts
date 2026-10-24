/* Chrono24 private sellers. "Sell Watches on Chrono24", checked 2026-10-24: "The 6.5% commission fee is only due after you've completed a sale"; retained from the escrow payout. Dealers' rates are individual (brand, price, condition). */
import { M } from "../markets";
import { assemble, moneyFor, num, pct, str, toCents } from "../money";
import type { CalculatorDef, Inputs, Market } from "../types";
import { CHECKED, costs, src } from "./_kit";

const sources = [src("c24-sell", "Sell Watches on Chrono24", "https://www.chrono24.com/offer/index.htm", "Chrono24")];

function calculate(inputs: Inputs, market: Market) {
  const money = moneyFor(market);
  const price = toCents(num(inputs, "price"));
  const dealer = str(inputs, "seller", "private") === "dealer";
  const rate = dealer ? Math.max(0, Math.min(20, num(inputs, "rate", 6.5))) : 6.5;
  return assemble({
    market,
    buyerPays: price,
    saleAmount: price,
    fees: [{ id: "commission", label: `Chrono24 commission (${rate}%)`, amount: pct(price, rate), kind: "platform", detail: `${rate}% × ${money(price)}`, explain: dealer ? "Professional dealers get an individual rate based on brand, price and condition; enter yours." : "Private sellers pay 6.5% of the sale price, only once the watch has sold. It’s kept automatically when Chrono24 pays you out of escrow.", source: "c24-sell" }],
    costs: costs(inputs),
    notes: price > 0 ? ["Listing is free for private sellers, and you pay nothing if the watch doesn’t sell.", "Insured, tracked shipping for a watch is on you: add it under costs."] : [],
  });
}

const def: CalculatorDef = {
  slug: "chrono24",
  name: "Chrono24",
  path: "/chrono24-fee-calculator",
  category: "marketplaces",
  priceNoun: "sale price",
  sellerNoun: "seller",
  buyerNoun: "buyer",
  blurb: "6.5% commission for private sellers, only when the watch sells",
  markets: [M.us],
  defaultMarket: "us",
  priceField: "price",
  fields: [
    { id: "price", kind: "money", label: "Sale price", section: "sale" },
    { id: "seller", kind: "segmented", label: "You are a…", section: "sale", options: [{ value: "private", label: "Private seller · 6.5%" }, { value: "dealer", label: "Dealer (own rate)" }] },
    { id: "rate", kind: "percent", label: "Your dealer commission", section: "sale", max: 20, step: 0.1, showIf: (i) => str(i, "seller") === "dealer" },
    { id: "itemCost", kind: "money", label: "What the watch cost you", section: "costs" },
    { id: "otherCost", kind: "money", label: "Insured shipping & other", section: "costs" },
  ],
  defaults: () => ({ price: 5000, seller: "private", rate: 6.5, itemCost: 0, otherCost: 0 }),
  calculate,
  breakpoints: () => [],
  verifiedAt: CHECKED,
  sources,
  changes: [],
  schedule: () => [{ fee: "Commission (private seller)", amount: "6.5%", appliesTo: "Sale price", when: "Only after a completed sale", source: "c24-sell" }, { fee: "Listing", amount: "Free", appliesTo: "Each listing", source: "c24-sell" }],
};
export default def;
