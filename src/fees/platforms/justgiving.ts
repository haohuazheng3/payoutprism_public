/* JustGiving (UK). "Our fees", checked 2026-10-24: charity fundraising 1.9% + 30p per donation; personal (crowdfunding) fundraising 2.9% + 35p per donation. Official example: £500 from 25 donors of £20 → charity gets £483 (fees £17); personal £476.75 (fees £23.25). */
import { M } from "../markets";
import { assemble, moneyFor, num, pct, str, toCents } from "../money";
import type { CalculatorDef, Inputs, Market } from "../types";
import { CHECKED, src } from "./_kit";

const sources = [src("jg-fees", "Our fees", "https://www.justgiving.com/about-us/fees", "JustGiving")];
const TYPES: Record<string, { label: string; rate: number; fixed: number }> = { charity: { label: "Charity fundraising", rate: 1.9, fixed: 30 }, personal: { label: "Personal fundraising", rate: 2.9, fixed: 35 } };

function calculate(inputs: Inputs, market: Market) {
  const money = moneyFor(market);
  const total = toCents(num(inputs, "total"));
  const count = Math.max(1, Math.round(num(inputs, "count", 1)));
  const t = TYPES[str(inputs, "type", "charity")] ?? TYPES.charity;
  return assemble({
    market,
    buyerPays: total,
    saleAmount: total,
    fees: [
      { id: "pct", label: `Processing (${t.rate}%)`, amount: pct(total, t.rate), kind: "payment", detail: `${t.rate}% × ${money(total)}`, explain: `${t.label} on JustGiving costs ${t.rate}% + ${t.fixed}p per donation for standard payment methods.`, source: "jg-fees" },
      { id: "fixed", label: `Per-donation fee (${t.fixed}p × ${count})`, amount: t.fixed * count, kind: "payment", detail: `${t.fixed}p × ${count} donations`, explain: "A fixed amount on every donation, so many small gifts cost more than a few large ones.", source: "jg-fees" },
    ],
    notes: total > 0 ? [`Average donation ${money(Math.round(total / count))}: the fixed ${t.fixed}p is ${((t.fixed / (total / count)) * 100).toFixed(1)}% of each one.`, "Gift Aid isn’t a fee: eligible UK taxpayers’ donations to charities can add 25% on top, claimed separately."] : [],
  });
}

const def: CalculatorDef = {
  slug: "justgiving",
  name: "JustGiving",
  path: "/justgiving-fee-calculator",
  category: "fundraising",
  priceNoun: "total raised",
  sellerNoun: "fundraiser",
  saleNoun: "fundraiser",
  buyerNoun: "donors",
  blurb: "Charities 1.9% + 30p, personal fundraisers 2.9% + 35p per donation",
  keepHead: "Reaches the cause",
  markets: [M.uk],
  defaultMarket: "uk",
  priceField: "total",
  fields: [
    { id: "total", kind: "money", label: "Total raised", section: "sale" },
    { id: "count", kind: "number", label: "Number of donations", section: "sale", min: 1, integer: true },
    { id: "type", kind: "segmented", label: "Fundraising for", section: "sale", options: Object.entries(TYPES).map(([value, t]) => ({ value, label: `${t.label} · ${t.rate}% + ${t.fixed}p` })) },
  ],
  defaults: () => ({ total: 500, count: 25, type: "charity" }),
  calculate,
  breakpoints: () => [],
  verifiedAt: CHECKED,
  sources,
  changes: [],
  schedule: () => Object.values(TYPES).map((t) => ({ fee: t.label, amount: `${t.rate}% + ${t.fixed}p`, appliesTo: "Each donation", source: "jg-fees" })),
};
export default def;
