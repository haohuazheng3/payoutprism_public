/*
 * Credit card surcharge / cash discount. The exact surcharge that leaves you whole is
 * S = (A × r + f) / (1 − r): the processor also charges its rate on the surcharge itself.
 * Visa (US Merchant Surcharge Q&A, checked 2026-10-24): credit cards only, never debit or prepaid,
 * capped at the lower of your merchant discount rate or 3%; some states prohibit or limit it.
 */
import { M } from "../markets";
import { assemble, formatRate, moneyFor, num, pct, roundCents, str, toCents } from "../money";
import type { CalculatorDef, Inputs, Market } from "../types";
import { CHECKED, src } from "./_kit";

const sources = [src("visa-qa", "U.S. Merchant Surcharge Q&A", "https://usa.visa.com/content/dam/VCOM/global/support-legal/documents/merchant-surcharging-qa-for-web.pdf", "Visa")];
export const VISA_CAP = 3;
export const STATES = "Connecticut, Maine, Massachusetts, Oklahoma and Puerto Rico prohibit surcharging; Colorado, Minnesota, New Jersey and New York have their own requirements (Visa’s understanding as of Feb 15, 2024).";

function calculate(inputs: Inputs, market: Market) {
  const money = moneyFor(market);
  const a = toCents(num(inputs, "amount"));
  const r = Math.min(10, Math.max(0, num(inputs, "rate", 2.9))) / 100;
  const f = toCents(num(inputs, "fixed"));
  const mode = str(inputs, "mode", "surcharge");
  const exact = a > 0 ? roundCents((a * r + f) / (1 - r)) : 0;
  const capPct = Math.min(VISA_CAP, r * 100);
  const cap = pct(a, capPct);
  const surcharge = mode === "surcharge" ? Math.min(exact, cap) : 0;
  const listPrice = mode === "discount" ? a + exact : a + surcharge;
  const fee = pct(listPrice, r * 100) + (a > 0 ? f : 0);
  const notes: string[] = [];
  if (a > 0) {
    if (mode === "surcharge") {
      notes.push(exact > cap ? `Covering every cent would take ${money(exact)} (${((exact / a) * 100).toFixed(2)}%), above the ${formatRate(capPct)} cap, so ${money(exact - cap)} of the fee stays with you.` : `A ${money(surcharge)} surcharge (${((surcharge / a) * 100).toFixed(2)}%) covers the card fee exactly, including the fee on the surcharge itself.`);
      notes.push("Surcharges are allowed on credit cards only, never on debit or prepaid cards, and must be disclosed at the entrance, at checkout and on the receipt.");
    } else {
      notes.push(`Cash discount: list ${money(a + exact)} and give cash customers ${money(exact)} off. Card customers pay the list price; you still receive ${money(a + exact - fee)} on a card sale.`);
    }
    notes.push(STATES);
  }
  return assemble({
    market,
    buyerPays: listPrice,
    saleAmount: listPrice,
    fees: [{ id: "processing", label: `Card processing (${formatRate(Math.round(r * 10000) / 100)}${f ? ` + ${money(f)}` : ""})`, amount: fee, kind: "payment", detail: `${formatRate(Math.round(r * 10000) / 100)} × ${money(listPrice)}${f ? ` + ${money(f)}` : ""}`, explain: "Your processor charges its rate on everything the customer pays, surcharge included." }],
    buyerFees: [],
    notes,
    warnings: mode === "surcharge" && r * 100 > VISA_CAP ? [`Your rate is above Visa’s ${VISA_CAP}% surcharge cap: a surcharge can’t fully cover it.`] : [],
  });
}

const def: CalculatorDef = {
  slug: "credit-card-surcharge",
  name: "Credit Card Surcharge",
  path: "/credit-card-surcharge-calculator",
  category: "payments",
  priceNoun: "sale amount",
  sellerNoun: "business",
  buyerNoun: "customer",
  blurb: "The exact surcharge that covers your card fee, checked against Visa’s 3% cap",
  modes: false,
  markets: [M.us],
  defaultMarket: "us",
  priceField: "amount",
  fields: [
    { id: "amount", kind: "money", label: "Sale amount (before surcharge)", section: "sale" },
    { id: "rate", kind: "percent", label: "Your card processing rate", section: "sale", max: 10, step: 0.01 },
    { id: "fixed", kind: "money", label: "Fixed fee per transaction", section: "sale" },
    { id: "mode", kind: "segmented", label: "Approach", section: "sale", options: [{ value: "surcharge", label: "Surcharge on credit" }, { value: "discount", label: "Cash discount" }] },
  ],
  defaults: () => ({ amount: 100, rate: 2.9, fixed: 0.3, mode: "surcharge" }),
  calculate,
  breakpoints: () => [],
  verifiedAt: CHECKED,
  sources,
  changes: [],
  schedule: () => [
    { fee: "Maximum surcharge (Visa US)", amount: "Your merchant discount rate or 3%, whichever is lower", appliesTo: "Credit card purchases", source: "visa-qa" },
    { fee: "Debit and prepaid cards", amount: "No surcharge allowed", appliesTo: "—", source: "visa-qa" },
    { fee: "State rules", amount: "Prohibited in CT, ME, MA, OK, PR", appliesTo: "—", when: "CO, MN, NJ, NY have requirements", source: "visa-qa" },
  ],
};
export default def;
