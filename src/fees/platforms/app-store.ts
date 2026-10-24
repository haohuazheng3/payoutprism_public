/* Apple App Store commission. App Store Small Business Program page, checked 2026-10-24: "a reduced commission rate of 15% on paid apps and Apple In-App Purchases" for developers earning up to $1 million in proceeds a year; standard rate 30%. Prices shown in the US storefront exclude sales tax. */
import { M } from "../markets";
import { assemble, moneyFor, num, pct, str, toCents } from "../money";
import type { CalculatorDef, Inputs, Market } from "../types";
import { CHECKED, src } from "./_kit";

const sources = [src("asb", "App Store Small Business Program", "https://developer.apple.com/app-store/small-business-program/", "Apple Developer")];
const RATES: Record<string, { label: string; rate: number }> = { small: { label: "Small Business Program · 15%", rate: 15 }, standard: { label: "Standard · 30%", rate: 30 } };

function calculate(inputs: Inputs, market: Market) {
  const money = moneyFor(market);
  const price = toCents(num(inputs, "price"));
  const units = Math.max(1, Math.round(num(inputs, "units", 1)));
  const r = RATES[str(inputs, "program", "small")] ?? RATES.small;
  const gross = price * units;
  const fee = pct(gross, r.rate);
  return assemble({
    market,
    buyerPays: gross,
    saleAmount: gross,
    fees: [{ id: "commission", label: `Apple commission (${r.rate}%)`, amount: fee, kind: "platform", detail: `${r.rate}% × ${money(gross)}`, explain: r.rate === 15 ? "The Small Business Program cuts Apple’s commission to 15% on paid apps and in-app purchases for developers with up to $1 million in proceeds a year." : "Apple’s standard commission on paid apps and in-app purchases.", source: "asb" }],
    notes: gross > 0 ? [`At 15% you keep ${money(gross - pct(gross, 15))}; at 30% you’d keep ${money(gross - pct(gross, 30))}.`, "Enrollment isn’t automatic: you apply, and you re-qualify each calendar year based on the previous year’s proceeds."] : [],
  });
}

const def: CalculatorDef = {
  slug: "app-store",
  name: "App Store",
  path: "/app-store-fee-calculator",
  category: "creators",
  priceNoun: "price",
  sellerNoun: "developer",
  saleNoun: "sales",
  buyerNoun: "customers",
  blurb: "Apple keeps 15% in the Small Business Program (under $1M a year), 30% otherwise",
  markets: [M.us],
  defaultMarket: "us",
  priceField: "price",
  fields: [
    { id: "price", kind: "money", label: "Price (paid app or in-app purchase)", section: "sale" },
    { id: "units", kind: "number", label: "Sales per month", section: "sale", min: 1, integer: true },
    { id: "program", kind: "segmented", label: "Commission", section: "sale", options: Object.entries(RATES).map(([value, x]) => ({ value, label: x.label })) },
  ],
  defaults: () => ({ price: 4.99, units: 1000, program: "small" }),
  calculate,
  breakpoints: () => [],
  verifiedAt: CHECKED,
  sources,
  changes: [],
  schedule: () => [{ fee: "Small Business Program", amount: "15%", appliesTo: "Paid apps and in-app purchases", when: "Up to $1 million proceeds a year; apply to join", source: "asb" }, { fee: "Standard commission", amount: "30%", appliesTo: "Paid apps and in-app purchases", source: "asb" }],
};
export default def;
