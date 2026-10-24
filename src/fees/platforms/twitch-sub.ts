/*
 * Twitch subscription earnings. Twitch Help, checked 2026-10-24: standard split 50/50 "after applicable
 * deductions (such as taxes, payment processing fees, and currency conversion fees)"; Plus Program
 * Level 1 60/40 (100 Plus Points for three consecutive months), Level 2 70/30 (300 points). US Tier 1
 * web price $5.99; Tier 2 $9.99, Tier 3 $24.99. Twitch doesn't publish the size of the deductions, so
 * they're an input (default 0: the split of the sticker price).
 */
import { M } from "../markets";
import { assemble, moneyFor, num, pct, str, toCents } from "../money";
import type { CalculatorDef, Inputs, Line, Market } from "../types";
import { CHECKED, src } from "./_kit";

const sources = [
  src("tw-partner", "Twitch Partner Program Overview", "https://help.twitch.tv/s/article/partner-program-overview?language=en_US", "Twitch Help"),
  src("tw-price", "Local Subscription Pricing Countries", "https://help.twitch.tv/s/article/local-sub-price-countries?language=en_US", "Twitch Help"),
  src("tw-affiliate", "Twitch Affiliate Program", "https://affiliate.twitch.tv/", "Twitch"),
];
export const TIERS = { t1: 599, t2: 999, t3: 2499 };
const SPLITS: Record<string, { label: string; you: number }> = { s50: { label: "Standard 50/50", you: 50 }, s60: { label: "Plus Level 1 · 60/40", you: 60 }, s70: { label: "Plus Level 2 · 70/30", you: 70 } };

function calculate(inputs: Inputs, market: Market) {
  const money = moneyFor(market);
  const n1 = Math.max(0, Math.round(num(inputs, "t1")));
  const n2 = Math.max(0, Math.round(num(inputs, "t2")));
  const n3 = Math.max(0, Math.round(num(inputs, "t3")));
  const p1 = toCents(num(inputs, "price", 5.99));
  const gross = n1 * p1 + n2 * TIERS.t2 + n3 * TIERS.t3;
  const ded = Math.max(0, Math.min(60, num(inputs, "deductions")));
  const split = SPLITS[str(inputs, "split", "s50")] ?? SPLITS.s50;
  const deduction = pct(gross, ded);
  const net = gross - deduction;
  const twitch = net - pct(net, split.you);
  const fees: Line[] = [];
  if (deduction) fees.push({ id: "deductions", label: `Taxes, processing & conversion (${ded}%)`, amount: deduction, kind: "tax", detail: `${ded}% × ${money(gross)}`, explain: "Twitch splits subscription revenue after taxes, payment processing and currency conversion are taken out. It doesn’t publish their size, so enter your own estimate.", source: "tw-partner" });
  fees.push({ id: "twitch", label: `Twitch’s share (${100 - split.you}%)`, amount: twitch, kind: "platform", detail: `${100 - split.you}% × ${money(net)}`, explain: `${split.label}: you keep ${split.you}% of net subscription revenue from recurring and gift subs.`, source: "tw-partner" });
  const notes = gross > 0 ? [`Per Tier 1 sub you get about ${money(pct(p1 - pct(p1, ded), split.you))} at this split.`, "Plus Program: hold 100 Plus Points for three months in a row for 60/40, or 300 for 70/30. Recurring subs of every tier count."] : [];
  return assemble({ market, buyerPays: gross, saleAmount: gross, fees, notes });
}

const def: CalculatorDef = {
  slug: "twitch-sub",
  name: "Twitch Subs",
  path: "/twitch-sub-calculator",
  category: "creators",
  priceNoun: "Tier 1 price",
  sellerNoun: "streamer",
  saleNoun: "month of subs",
  buyerNoun: "subscribers",
  blurb: "Sub earnings at 50/50, 60/40 or 70/30, Tier 1 $5.99 / Tier 2 $9.99 / Tier 3 $24.99",
  keepHead: "Your sub revenue this month",
  modes: false,
  markets: [M.us],
  defaultMarket: "us",
  priceField: "price",
  fields: [
    { id: "t1", kind: "number", label: "Tier 1 subs (incl. gifted)", section: "sale", min: 0, integer: true },
    { id: "t2", kind: "number", label: "Tier 2 subs", section: "sale", min: 0, integer: true },
    { id: "t3", kind: "number", label: "Tier 3 subs", section: "sale", min: 0, integer: true },
    { id: "split", kind: "segmented", label: "Your revenue share", section: "sale", options: Object.entries(SPLITS).map(([value, s]) => ({ value, label: s.label })) },
    { id: "price", kind: "money", label: "Tier 1 price", section: "options", help: "$5.99 on the web in the US; local prices differ by country.", advanced: true },
    { id: "deductions", kind: "percent", label: "Taxes & processing deducted first", section: "options", max: 60, step: 0.5, help: "Twitch takes these out before the split but doesn’t publish the figure. 0 shows the split of the sticker price." },
  ],
  defaults: () => ({ t1: 100, t2: 5, t3: 2, split: "s50", price: 5.99, deductions: 0 }),
  calculate,
  breakpoints: () => [],
  verifiedAt: CHECKED,
  sources,
  changes: [],
  schedule: () => [
    { fee: "Standard split", amount: "50/50", appliesTo: "Net subscription revenue", when: "After taxes, processing, conversion", source: "tw-partner" },
    { fee: "Plus Program Level 1", amount: "60/40", appliesTo: "Recurring and gift subs", when: "100 Plus Points for 3 consecutive months", source: "tw-partner" },
    { fee: "Plus Program Level 2", amount: "70/30", appliesTo: "Recurring and gift subs", when: "300 Plus Points for 3 consecutive months", source: "tw-partner" },
    { fee: "Tier 1 price (US web)", amount: "$5.99", appliesTo: "Per month", source: "tw-price" },
    { fee: "Tier 2 / Tier 3 price", amount: "$9.99 / $24.99", appliesTo: "Per month", source: "tw-affiliate" },
  ],
};
export default def;
