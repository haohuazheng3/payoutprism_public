/* Cars & Bids FAQ, checked 2026-10-24: "buyers pay a 5% buyer’s fee to Cars & Bids. The buyer’s fee has a minimum of $250, and a maximum of $7,500." "Listing a car on Cars & Bids is completely free". */
import { M } from "../markets";
import { assemble, moneyFor, num, pct, toCents } from "../money";
import type { CalculatorDef, Inputs, Market } from "../types";
import { CHECKED, src } from "./_kit";

const sources = [src("cb-faq", "Frequently Asked Questions", "https://carsandbids.com/faq/", "Cars & Bids")];

function calculate(inputs: Inputs, market: Market) {
  const money = moneyFor(market);
  const price = toCents(num(inputs, "price"));
  const buyer = price ? Math.max(25000, Math.min(750000, pct(price, 5))) : 0;
  return assemble({
    market,
    buyerPays: price + buyer,
    saleAmount: price,
    fees: [{ id: "listing", label: "Listing fee", amount: 0, kind: "platform", detail: "free", explain: "Listing a car on Cars & Bids is free for sellers.", source: "cb-faq" }],
    buyerFees: [{ id: "buyer", label: "Buyer’s fee (5%)", amount: buyer, kind: "platform", detail: `5% × ${money(price)}, min $250, max $7,500`, explain: "The winning bidder pays Cars & Bids 5% on top of the price, at least $250 and at most $7,500. It’s not refundable.", source: "cb-faq" }],
    notes: price > 0 ? [`You receive the full ${money(price)} from the buyer; the buyer’s total is ${money(price + buyer)}.`] : [],
  });
}

const def: CalculatorDef = {
  slug: "cars-and-bids",
  name: "Cars & Bids",
  path: "/cars-and-bids-fee-calculator",
  category: "marketplaces",
  priceNoun: "winning bid",
  sellerNoun: "seller",
  saleNoun: "auction",
  buyerNoun: "buyer",
  blurb: "Free to list; buyers pay 5% on top, min $250, max $7,500",
  markets: [M.us],
  defaultMarket: "us",
  priceField: "price",
  fields: [{ id: "price", kind: "money", label: "Winning bid", section: "sale" }],
  defaults: () => ({ price: 40000 }),
  calculate,
  breakpoints: () => [5000, 150000],
  verifiedAt: CHECKED,
  sources,
  changes: [],
  schedule: () => [{ fee: "Seller listing", amount: "Free", appliesTo: "—", source: "cb-faq" }, { fee: "Buyer’s fee", amount: "5%, min $250, max $7,500", appliesTo: "Winning bid, on top", source: "cb-faq" }],
};
export default def;
