/* Ko-fi. "Does Ko-fi take a fee?" + ko-fi.com/pricing, checked 2026-10-24: Free: 0% on one-off tips and crowdfunding, 5% on monthly tips, memberships, commissions and shop sales; Standard: 5% on everything; Gold $12/month: 0% service fee. PayPal or Stripe fees apply on top ("usually around 3% + $0.30"). */
import { M } from "../markets";
import { assemble, moneyFor, num, pct, str, toCents } from "../money";
import type { CalculatorDef, Inputs, Line, Market } from "../types";
import { CHECKED, src } from "./_kit";

const sources = [src("kofi-fee", "Does Ko-fi take a fee?", "https://help.ko-fi.com/hc/en-us/articles/360002506494-Does-Ko-fi-take-a-fee", "Ko-fi Help"), src("kofi-pricing", "Ko-fi Pricing", "https://ko-fi.com/pricing", "Ko-fi")];
const TYPES: Record<string, string> = { tip: "One-off tip", goal: "Crowdfunding goal", monthly: "Monthly tip", membership: "Membership", commission: "Commission", shop: "Shop sale" };

function serviceRate(type: string, plan: string) {
  if (plan === "gold") return 0;
  if (plan === "standard") return 5;
  return type === "tip" || type === "goal" ? 0 : 5;
}

function calculate(inputs: Inputs, market: Market) {
  const money = moneyFor(market);
  const amount = toCents(num(inputs, "amount"));
  const type = str(inputs, "type", "shop");
  const plan = str(inputs, "plan", "free");
  const rate = serviceRate(type, plan);
  const pRate = Math.max(0, Math.min(6, num(inputs, "procRate", 2.9)));
  const pFixed = toCents(num(inputs, "procFixed", 0.3));
  const fees: Line[] = [
    { id: "service", label: `Ko-fi service fee (${rate}%)`, amount: pct(amount, rate), kind: "platform", detail: `${rate}% × ${money(amount)}`, explain: plan === "gold" ? "Ko-fi Gold ($12 a month) removes the service fee on every payment type." : rate ? "Ko-fi takes 5% on this payment type." : "One-off tips and crowdfunding are fee-free on Ko-fi Free.", source: "kofi-fee" },
    { id: "processor", label: `PayPal or Stripe (${pRate}% + ${money(pFixed)})`, amount: amount ? pct(amount, pRate) + pFixed : 0, kind: "payment", detail: `${pRate}% × ${money(amount)} + ${money(pFixed)}`, explain: "Ko-fi pays into your own PayPal or Stripe account, and their usual fees apply. Ko-fi says they’re usually around 3% + $0.30; check your processor’s rate.", source: "kofi-fee" },
  ];
  const notes = amount > 0 && plan !== "gold" && rate ? [`Gold costs $12 a month, so it pays for itself once your 5%-fee income passes ${money(24000)} a month.`] : [];
  return assemble({ market, buyerPays: amount, saleAmount: amount, fees, notes });
}

const def: CalculatorDef = {
  slug: "ko-fi",
  name: "Ko-fi",
  path: "/ko-fi-fee-calculator",
  category: "creators",
  priceNoun: "payment",
  sellerNoun: "creator",
  buyerNoun: "supporter",
  blurb: "0% on one-off tips, 5% on shop, memberships and commissions; Gold $12/mo for 0%",
  markets: [M.us],
  defaultMarket: "us",
  priceField: "amount",
  fields: [
    { id: "amount", kind: "money", label: "Payment amount", section: "sale" },
    { id: "type", kind: "select", label: "Payment type", section: "sale", options: Object.entries(TYPES).map(([value, label]) => ({ value, label })) },
    { id: "plan", kind: "segmented", label: "Your Ko-fi plan", section: "sale", options: [{ value: "free", label: "Free" }, { value: "standard", label: "Standard" }, { value: "gold", label: "Gold · $12/mo" }] },
    { id: "procRate", kind: "percent", label: "Processor rate", section: "options", max: 6, step: 0.01 },
    { id: "procFixed", kind: "money", label: "Processor fixed fee", section: "options" },
  ],
  defaults: () => ({ amount: 25, type: "shop", plan: "free", procRate: 2.9, procFixed: 0.3 }),
  calculate,
  breakpoints: () => [],
  verifiedAt: CHECKED,
  sources,
  changes: [],
  schedule: () => [
    { fee: "Ko-fi Free", amount: "0% tips & goals · 5% others", appliesTo: "Each payment", source: "kofi-fee" },
    { fee: "Ko-fi Standard", amount: "5% on everything", appliesTo: "Each payment", source: "kofi-fee" },
    { fee: "Ko-fi Gold", amount: "0%", appliesTo: "Each payment", when: "$12 per month", source: "kofi-pricing" },
    { fee: "PayPal / Stripe", amount: "≈3% + $0.30", appliesTo: "Each payment", when: "Your processor’s own rate", source: "kofi-fee" },
  ],
};
export default def;
