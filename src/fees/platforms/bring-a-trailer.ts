/* Bring a Trailer. "How BaT Works", checked 2026-10-24: sellers pay a $99 listing fee (+$330 Plus photography optional), no other seller fees; buyers pay 5% or 10% on top of the final price by category, minimum $250, capped at $7,500 (5% auctions) or $4,000 (10% auctions). */
import { M } from "../markets";
import { assemble, bool, moneyFor, num, pct, str, toCents } from "../money";
import type { CalculatorDef, Inputs, Line, Market } from "../types";
import { CHECKED, src } from "./_kit";

const sources = [src("bat-how", "How BaT Works", "https://bringatrailer.com/how-bat-works/", "Bring a Trailer")];
const TYPES: Record<string, { label: string; rate: number; max: number }> = { r5: { label: "5% buyer fee (most auctions)", rate: 5, max: 750000 }, r10: { label: "10% buyer fee category", rate: 10, max: 400000 } };

function calculate(inputs: Inputs, market: Market) {
  const money = moneyFor(market);
  const price = toCents(num(inputs, "price"));
  const t = TYPES[str(inputs, "type", "r5")] ?? TYPES.r5;
  const buyer = price ? Math.max(25000, Math.min(t.max, pct(price, t.rate))) : 0;
  const fees: Line[] = [{ id: "listing", label: "Listing fee", amount: 9900, kind: "platform", detail: "$99, Classic service", explain: "Sellers pay $99 for a custom-written listing and a 7-day auction. There are no other seller fees on BaT.", source: "bat-how" }];
  if (bool(inputs, "plus")) fees.push({ id: "plus", label: "Plus photography", amount: 33000, kind: "ads", detail: "$330 add-on", explain: "Optional professional photos and video.", source: "bat-how" });
  return assemble({
    market,
    buyerPays: price + buyer,
    saleAmount: price,
    fees,
    buyerFees: [{ id: "buyer", label: `Buyer’s fee (${t.rate}%)`, amount: buyer, kind: "platform", detail: `${t.rate}% × ${money(price)}, min $250, max ${money(t.max)}`, explain: `The winning bidder pays BaT ${t.rate}% on top of the final price, at least $250 and at most ${money(t.max)}. It doesn’t come out of your sale.`, source: "bat-how" }],
    notes: price > 0 ? [`The buyer’s all-in cost is ${money(price + buyer)}: bidders factor that in, so the fee still shapes your hammer price.`] : [],
  });
}

const def: CalculatorDef = {
  slug: "bring-a-trailer",
  name: "Bring a Trailer",
  path: "/bring-a-trailer-fee-calculator",
  category: "marketplaces",
  priceNoun: "winning bid",
  sellerNoun: "seller",
  saleNoun: "auction",
  buyerNoun: "buyer",
  blurb: "$99 to list; buyers pay 5% (max $7,500) or 10% (max $4,000), min $250",
  markets: [M.us],
  defaultMarket: "us",
  priceField: "price",
  fields: [
    { id: "price", kind: "money", label: "Winning bid (hammer price)", section: "sale" },
    { id: "type", kind: "segmented", label: "Auction category", section: "sale", options: Object.entries(TYPES).map(([value, t]) => ({ value, label: t.label })) },
    { id: "plus", kind: "toggle", label: "Plus photography (+$330)", section: "options" },
  ],
  defaults: () => ({ price: 40000, type: "r5", plus: false }),
  calculate,
  breakpoints: () => [5000, 150000],
  verifiedAt: CHECKED,
  sources,
  changes: [],
  schedule: () => [
    { fee: "Seller listing fee", amount: "$99", appliesTo: "Each listing", when: "Plus photography +$330 optional", source: "bat-how" },
    { fee: "Buyer’s fee (5% auctions)", amount: "5%, min $250, max $7,500", appliesTo: "Final price, on top", source: "bat-how" },
    { fee: "Buyer’s fee (10% auctions)", amount: "10%, min $250, max $4,000", appliesTo: "Final price, on top", source: "bat-how" },
  ],
};
export default def;
