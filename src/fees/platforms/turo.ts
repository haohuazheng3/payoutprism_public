/* Turo host earnings (US). "Earnings plans – In brief | US hosts", checked 2026-10-24: host share 70% (More peace of mind, $250 damage responsibility), 80% (Balanced, $1,500), 90% (More earnings, $2,750) of the trip price. Some cities use booking-lead-time ranges; this uses the standard shares. */
import { M } from "../markets";
import { assemble, moneyFor, num, pct, str, toCents } from "../money";
import type { CalculatorDef, Inputs, Market } from "../types";
import { CHECKED, COSTS, costs, src } from "./_kit";

export const turoSources = [src("turo-plans-us", "Earnings plans – In brief | US hosts", "https://help.turo.com/en_us/earnings-plans-in-brief-us-hosts-ryy_U4gE9", "Turo Help"), src("turo-protection", "Earnings Plans for Turo Hosts", "https://turo.com/us/en/car-rental/united-states/how-turo-works/vehicle-protection", "Turo")];
export const PLANS: Record<string, { label: string; share: number; damage: number }> = {
  p70: { label: "More peace of mind · 70%", share: 70, damage: 25000 },
  p80: { label: "Balanced · 80%", share: 80, damage: 150000 },
  p90: { label: "More earnings · 90%", share: 90, damage: 275000 },
};

function calculate(inputs: Inputs, market: Market) {
  const money = moneyFor(market);
  const daily = toCents(num(inputs, "daily"));
  const days = Math.max(0, Math.min(31, num(inputs, "days", 15)));
  const extras = toCents(num(inputs, "extras"));
  const plan = PLANS[str(inputs, "plan", "p80")] ?? PLANS.p80;
  const trip = Math.round(daily * days) + extras;
  const turo = trip - pct(trip, plan.share);
  const others = Object.values(PLANS).filter((p) => p !== plan).map((p) => `${p.label.split(" · ")[0]} ${money(pct(trip, p.share))}`).join(" · ");
  return assemble({
    market,
    buyerPays: trip,
    saleAmount: trip,
    fees: [{ id: "turo", label: `Turo’s share (${100 - plan.share}%)`, amount: turo, kind: "platform", detail: `${100 - plan.share}% × ${money(trip)}`, explain: `On the ${plan.label.split(" · ")[0]} plan you keep ${plan.share}% of the trip price, including delivery and Extras, and pay up to ${money(plan.damage)} per damage incident before Turo reimburses.`, source: "turo-plans-us" }],
    costs: costs(inputs),
    notes: trip > 0 ? [`Same month on the other plans: ${others}.`, `Damage responsibility on this plan: ${money(plan.damage)} per incident.`] : [],
  });
}

const def: CalculatorDef = {
  slug: "turo",
  name: "Turo",
  path: "/turo-calculator",
  category: "rentals",
  priceNoun: "daily price",
  sellerNoun: "host",
  saleNoun: "month of trips",
  buyerNoun: "guests",
  blurb: "Hosts keep 70%, 80% or 90% of the trip price, by earnings plan",
  keepHead: "You earn this month",
  markets: [M.us],
  defaultMarket: "us",
  priceField: "daily",
  fields: [
    { id: "daily", kind: "money", label: "Daily price", section: "sale" },
    { id: "days", kind: "number", label: "Booked days per month", section: "sale", min: 0, max: 31, step: 1 },
    { id: "plan", kind: "segmented", label: "Earnings plan", section: "sale", options: Object.entries(PLANS).map(([value, p]) => ({ value, label: p.label })) },
    { id: "extras", kind: "money", label: "Delivery & Extras per month", section: "options", help: "Your plan share applies to these too." },
    { id: "itemCost", kind: "money", label: "Car payment, insurance, upkeep", section: "costs" },
    COSTS[1],
  ],
  defaults: () => ({ daily: 60, days: 15, plan: "p80", extras: 0, itemCost: 0, otherCost: 0 }),
  calculate,
  breakpoints: () => [],
  verifiedAt: CHECKED,
  sources: turoSources,
  changes: [],
  schedule: () => Object.values(PLANS).map((p) => ({ fee: p.label, amount: `You keep ${p.share}%`, appliesTo: "Trip price incl. delivery and Extras", when: `Damage responsibility $${(p.damage / 100).toLocaleString("en-US")} per incident`, source: "turo-plans-us" })),
};
export default def;
