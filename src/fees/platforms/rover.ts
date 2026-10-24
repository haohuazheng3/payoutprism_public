/* Rover (US). "What are the service fees?", checked 2026-10-24: providers pay a 20% service fee per booking (keep 80%; some US providers are in a pilot with different fees; California differs); owners pay an 11% booking fee at checkout. */
import { M } from "../markets";
import { assemble, moneyFor, num, pct, toCents } from "../money";
import type { CalculatorDef, Inputs, Market } from "../types";
import { CHECKED, src } from "./_kit";

const sources = [src("rover-fees", "What are the service fees?", "https://support.rover.com/hc/en-us/articles/205385304-What-are-the-service-fees", "Rover Help")];

function calculate(inputs: Inputs, market: Market) {
  const money = moneyFor(market);
  const price = toCents(num(inputs, "price"));
  const rate = Math.max(0, Math.min(40, num(inputs, "rate", 20)));
  const fee = pct(price, rate);
  const owner = pct(price, 11);
  return assemble({
    market,
    buyerPays: price + owner,
    saleAmount: price,
    fees: [{ id: "service", label: `Rover service fee (${rate}%)`, amount: fee, kind: "platform", detail: `${rate}% × ${money(price)}`, explain: "Rover keeps 20% of each booking from pet sitters and dog walkers, so you take home 80%. Some US providers are in a pilot with different fees, and California’s rules differ.", source: "rover-fees" }],
    buyerFees: [{ id: "owner", label: "Owner booking fee (11%)", amount: owner, kind: "platform", detail: `11% × ${money(price)}`, explain: "Pet owners pay Rover a separate 11% booking fee at checkout; it doesn’t come out of your earnings.", source: "rover-fees" }],
    notes: price > 0 ? [`To take home ${money(price)} you’d need to charge ${money(Math.ceil(price / (1 - rate / 100)))}.`] : [],
  });
}

const def: CalculatorDef = {
  slug: "rover",
  name: "Rover",
  path: "/rover-fee-calculator",
  category: "freelance",
  priceNoun: "booking price",
  sellerNoun: "sitter",
  saleNoun: "booking",
  buyerNoun: "pet owner",
  blurb: "Sitters keep 80% after Rover’s 20% service fee; owners pay 11% on top",
  markets: [M.us],
  defaultMarket: "us",
  priceField: "price",
  fields: [
    { id: "price", kind: "money", label: "Booking price (your rate × visits)", section: "sale" },
    { id: "rate", kind: "percent", label: "Your service fee", section: "options", max: 40, step: 1, help: "20% for most US providers; check your account if you’re in a pilot.", advanced: true },
  ],
  defaults: () => ({ price: 300, rate: 20 }),
  calculate,
  breakpoints: () => [],
  verifiedAt: CHECKED,
  sources,
  changes: [],
  schedule: () => [
    { fee: "Provider service fee", amount: "20%", appliesTo: "Each booking", when: "You keep 80%", source: "rover-fees" },
    { fee: "Owner booking fee", amount: "11%", appliesTo: "Each booking", when: "Paid by the pet owner at checkout", source: "rover-fees" },
  ],
};
export default def;
