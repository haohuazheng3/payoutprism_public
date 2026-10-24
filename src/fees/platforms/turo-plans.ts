/* Turo host plans compared on expected yearly profit: share of trip revenue minus expected out-of-pocket damage (incidents × min(repair, damage responsibility)). Plan figures: Turo Help, US hosts, checked 2026-10-24. */
import { M } from "../markets";
import { assemble, moneyFor, num, pct, str, toCents } from "../money";
import type { CalculatorDef, Inputs, Market } from "../types";
import { CHECKED } from "./_kit";
import { PLANS, turoSources } from "./turo";

/** Extra trip revenue a year at which the higher-share plan pays for one more incident's extra damage responsibility. */
export function breakEven(a: keyof typeof PLANS, b: keyof typeof PLANS): number {
  return Math.round(((PLANS[b].damage - PLANS[a].damage) / (PLANS[b].share - PLANS[a].share)) * 100);
}

function calculate(inputs: Inputs, market: Market) {
  const money = moneyFor(market);
  const monthly = toCents(num(inputs, "monthly"));
  const yearly = monthly * 12;
  const incidents = Math.max(0, num(inputs, "incidents", 1));
  const repair = toCents(num(inputs, "repair"));
  const plan = PLANS[str(inputs, "plan", "p80")] ?? PLANS.p80;
  const outOfPocket = Math.round(incidents * Math.min(repair, plan.damage));
  const fees = [{ id: "turo", label: `Turo’s share (${100 - plan.share}%)`, amount: yearly - pct(yearly, plan.share), kind: "platform" as const, detail: `${100 - plan.share}% × ${money(yearly)} a year`, explain: `${plan.label}: you keep ${plan.share}% of the trip price.`, source: "turo-plans-us" }];
  const all = Object.entries(PLANS).map(([k, p]) => ({ k, p, net: pct(yearly, p.share) - Math.round(incidents * Math.min(repair, p.damage)) }));
  const best = all.reduce((x, y) => (y.net > x.net ? y : x));
  return assemble({
    market,
    buyerPays: yearly,
    saleAmount: yearly,
    fees,
    costs: outOfPocket ? [{ id: "damage", label: `Expected damage you pay (${incidents} × up to ${money(plan.damage)})`, amount: outOfPocket, kind: "cost" }] : [],
    notes: yearly > 0 ? [`Best plan for these numbers: ${best.p.label} (${money(best.net)} a year after expected damage). Others: ${all.filter((x) => x !== best).map((x) => `${x.p.label.split(" · ")[0]} ${money(x.net)}`).join(" · ")}.`, `Balanced beats peace of mind once you earn ${money(breakEven("p70", "p80"))} a year per expected incident; More earnings beats Balanced above ${money(breakEven("p80", "p90"))}.`] : [],
  });
}

const def: CalculatorDef = {
  slug: "turo-plans",
  name: "Turo Host Plans",
  path: "/turo-protection-plans",
  category: "rentals",
  priceNoun: "monthly trip revenue",
  sellerNoun: "host",
  saleNoun: "year of trips",
  buyerNoun: "guests",
  blurb: "70% / 80% / 90% plans compared after expected damage costs",
  keepHead: "Your year on this plan",
  modes: false,
  markets: [M.us],
  defaultMarket: "us",
  priceField: "monthly",
  fields: [
    { id: "monthly", kind: "money", label: "Trip revenue per month", section: "sale", help: "Trip price including delivery and Extras, before Turo’s share." },
    { id: "plan", kind: "segmented", label: "Earnings plan", section: "sale", options: Object.entries(PLANS).map(([value, p]) => ({ value, label: p.label })) },
    { id: "incidents", kind: "number", label: "Damage incidents per year (expected)", section: "costs", min: 0, max: 12, step: 0.5 },
    { id: "repair", kind: "money", label: "Typical repair cost per incident", section: "costs" },
  ],
  defaults: () => ({ monthly: 900, plan: "p80", incidents: 1, repair: 2000 }),
  calculate,
  breakpoints: () => [],
  verifiedAt: CHECKED,
  sources: turoSources,
  changes: [],
  schedule: () => Object.values(PLANS).map((p) => ({ fee: p.label, amount: `You keep ${p.share}%`, appliesTo: "Trip price", when: `You pay up to $${(p.damage / 100).toLocaleString("en-US")} per damage incident`, source: "turo-plans-us" })),
};
export default def;
