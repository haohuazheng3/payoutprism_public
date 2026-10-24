/* Vrbo pay-per-booking (US). Vrbo Help "About the pay-per-booking (PPB) model", checked 2026-10-24: 12% commission on the rental amount and any additional fees charged to the traveler (cleaning, pet, boat…), not on traveler service fees, taxes, refundable deposits or insurance; no separate processing fee when Vrbo processes the payment; with your own processor its fees apply on top. */
import { M } from "../markets";
import { assemble, moneyFor, num, pct, str, toCents } from "../money";
import type { CalculatorDef, Inputs, Line, Market } from "../types";
import { CHECKED, COSTS, costs, src } from "./_kit";

const sources = [src("vrbo-ppb", "About the pay-per-booking (PPB) model", "https://help.vrbo.com/articles/How-is-the-booking-fee-calculated", "Vrbo Help")];

function calculate(inputs: Inputs, market: Market) {
  const money = moneyFor(market);
  const nightly = toCents(num(inputs, "nightly"));
  const nights = Math.max(1, Math.round(num(inputs, "nights", 1)));
  const cleaning = toCents(num(inputs, "cleaning"));
  const other = toCents(num(inputs, "otherFees"));
  const taxes = toCents(num(inputs, "taxes"));
  const rent = nightly * nights;
  const base = rent + cleaning + other;
  const own = str(inputs, "payments", "vrbo") === "own";
  const procRate = Math.max(0, Math.min(6, num(inputs, "procRate", 2.9)));
  const fees: Line[] = [{ id: "commission", label: "Vrbo commission (12%)", amount: pct(base, 12), kind: "platform", detail: `12% × ${money(base)} (rent + fees you charge)`, explain: "Vrbo charges 12% on the rent and every fee you charge the traveler, but not on taxes, refundable deposits, insurance or the traveler’s own service fee.", source: "vrbo-ppb" }];
  if (own) fees.push({ id: "processing", label: `Your payment processor (${procRate}%)`, amount: pct(base + taxes, procRate), kind: "payment", detail: `${procRate}% × ${money(base + taxes)}`, explain: "With your own processor Vrbo still takes 12%, and your processor’s fees come on top.", source: "vrbo-ppb" });
  return assemble({
    market,
    buyerPays: base + taxes,
    saleAmount: base,
    fees,
    buyerFees: taxes ? [{ id: "taxes", label: "Lodging taxes (passed through)", amount: taxes, kind: "tax", explain: "No commission is charged on taxes." }] : [],
    costs: costs(inputs),
    notes: base > 0 ? [`Per night that’s ${money(Math.round(pct(base, 12) / nights))} to Vrbo. The traveler also pays Vrbo a service fee on top, which isn’t taken from you.`] : [],
  });
}

const def: CalculatorDef = {
  slug: "vrbo",
  name: "Vrbo",
  path: "/vrbo-fee-calculator",
  category: "rentals",
  priceNoun: "nightly rate",
  sellerNoun: "host",
  saleNoun: "booking",
  buyerNoun: "traveler",
  blurb: "12% host commission on rent plus cleaning and other fees; none on taxes or deposits",
  markets: [M.us],
  defaultMarket: "us",
  priceField: "nightly",
  fields: [
    { id: "nightly", kind: "money", label: "Nightly rate", section: "sale" },
    { id: "nights", kind: "number", label: "Nights", section: "sale", min: 1, integer: true },
    { id: "cleaning", kind: "money", label: "Cleaning fee", section: "sale" },
    { id: "otherFees", kind: "money", label: "Other fees you charge (pet, boat…)", section: "options" },
    { id: "taxes", kind: "money", label: "Lodging taxes on the booking", section: "options" },
    { id: "payments", kind: "segmented", label: "Who processes the payment?", section: "options", options: [{ value: "vrbo", label: "Vrbo" }, { value: "own", label: "My own processor" }] },
    { id: "procRate", kind: "percent", label: "Your processor’s rate", section: "options", max: 6, step: 0.01, showIf: (i) => str(i, "payments") === "own" },
    ...COSTS,
  ],
  defaults: () => ({ nightly: 200, nights: 4, cleaning: 120, otherFees: 0, taxes: 0, payments: "vrbo", procRate: 2.9, itemCost: 0, otherCost: 0 }),
  calculate,
  breakpoints: () => [],
  verifiedAt: CHECKED,
  sources,
  changes: [],
  schedule: () => [
    { fee: "Commission", amount: "12%", appliesTo: "Rent + cleaning + other fees you charge", when: "Pay-per-booking, Vrbo processes payment", source: "vrbo-ppb" },
    { fee: "Not commissioned", amount: "0%", appliesTo: "Taxes, refundable deposits, insurance, traveler service fee", source: "vrbo-ppb" },
    { fee: "Own processor", amount: "12% + your processor’s fees", appliesTo: "Booking", source: "vrbo-ppb" },
  ],
};
export default def;
