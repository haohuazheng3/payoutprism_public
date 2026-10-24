/* Clover (US, Clover Flex pricing page, checked 2026-10-24): Starter 2.6% + 10¢, Essentials 2.5% + 10¢, Services growth 2.3% + 10¢ for cards tapped/swiped/inserted; typed-in 3.5% + 10¢ on all plans; Rapid Deposit 1.75%. Software: Essentials $29.95/mo, Services growth $84.95/mo when hardware is bought outright. */
import { M } from "../markets";
import { assemble, bool, formatRate, moneyFor, num, pct, str, toCents } from "../money";
import type { CalculatorDef, Inputs, Line, Market } from "../types";
import { CHECKED, COSTS, costs, src } from "./_kit";

const sources = [src("clover-flex", "Clover Flex pricing (Starter, Essentials, Services growth)", "https://www.clover.com/pricing/flex", "Clover"), src("clover-go", "Clover Go pricing", "https://www.clover.com/pricing/go", "Clover")];
export const PLANS: Record<string, { label: string; rate: number; software: string }> = {
  starter: { label: "Starter", rate: 2.6, software: "$40/mo for 36 months with Flex, or $749 outright" },
  essentials: { label: "Essentials", rate: 2.5, software: "$70/mo for 36 months, or $749 + $29.95/mo" },
  growth: { label: "Services growth", rate: 2.3, software: "$125/mo for 36 months, or $749 + $84.95/mo" },
};

function calculate(inputs: Inputs, market: Market) {
  const money = moneyFor(market);
  const amount = toCents(num(inputs, "amount"));
  const plan = PLANS[str(inputs, "plan", "starter")] ?? PLANS.starter;
  const keyed = str(inputs, "entry", "present") === "keyed";
  const rate = keyed ? 3.5 : plan.rate;
  const fees: Line[] = [{ id: "processing", label: `${keyed ? "Typed-in card" : "Card tapped, swiped or inserted"} (${formatRate(rate)} + 10¢)`, amount: amount ? pct(amount, rate) + 10 : 0, kind: "payment", detail: `${formatRate(rate)} × ${money(amount)} + $0.10`, explain: keyed ? "Typing the card number in costs 3.5% + 10¢ on every Clover plan." : `On the ${plan.label} plan, card-present payments cost ${formatRate(plan.rate)} + 10¢.`, source: "clover-flex" }];
  if (bool(inputs, "rapid")) fees.push({ id: "rapid", label: "Rapid Deposit (1.75%)", amount: pct(amount, 1.75), kind: "payment", detail: `1.75% × ${money(amount)}`, explain: "Optional: get the money within minutes of the sale for 1.75%.", source: "clover-flex" });
  const notes = amount > 0 ? [`Plan cost on top: ${plan.label} is ${plan.software}. Divide it by your monthly card sales to see your true rate.`, keyed ? `Taken in person the same payment would cost ${money(pct(amount, plan.rate) + 10)}.` : `Typed in, the same payment would cost ${money(pct(amount, 3.5) + 10)}.`] : [];
  return assemble({ market, buyerPays: amount, saleAmount: amount, fees, costs: costs(inputs), notes });
}

const def: CalculatorDef = {
  slug: "clover",
  name: "Clover",
  path: "/clover-fee-calculator",
  category: "payments",
  priceNoun: "sale amount",
  sellerNoun: "business",
  buyerNoun: "customer",
  blurb: "2.3%–2.6% + 10¢ in person by plan, 3.5% + 10¢ typed in, plus the monthly plan",
  markets: [M.us],
  defaultMarket: "us",
  priceField: "amount",
  fields: [
    { id: "amount", kind: "money", label: "Sale amount", section: "sale" },
    { id: "plan", kind: "segmented", label: "Clover plan", section: "sale", options: Object.entries(PLANS).map(([value, p]) => ({ value, label: `${p.label} · ${p.rate}%` })) },
    { id: "entry", kind: "segmented", label: "How is the card taken?", section: "sale", options: [{ value: "present", label: "Tapped, swiped, inserted" }, { value: "keyed", label: "Typed in · 3.5%" }] },
    { id: "rapid", kind: "toggle", label: "Rapid Deposit (+1.75%)", section: "options" },
    ...COSTS,
  ],
  defaults: () => ({ amount: 50, plan: "starter", entry: "present", rapid: false, itemCost: 0, otherCost: 0 }),
  calculate,
  breakpoints: () => [],
  verifiedAt: CHECKED,
  sources,
  changes: [],
  schedule: () => [...Object.values(PLANS).map((p) => ({ fee: `${p.label} · card present`, amount: `${formatRate(p.rate)} + 10¢`, appliesTo: "Each sale", when: p.software, source: "clover-flex" })), { fee: "Typed-in card (all plans)", amount: "3.5% + 10¢", appliesTo: "Each sale", source: "clover-flex" }, { fee: "Rapid Deposit", amount: "1.75%", appliesTo: "Deposit", when: "Optional", source: "clover-flex" }],
};
export default def;
