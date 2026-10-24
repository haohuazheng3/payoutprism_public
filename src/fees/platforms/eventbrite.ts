/*
 * Eventbrite paid tickets (US). Organizer pricing + help 755615, checked 2026-10-24:
 * service fee 3.7% + $1.79 per paid ticket, computed on the ticket price; payment processing 2.9% of
 * the total order (including service fees and tax). Fees are passed to buyers by default; an
 * organizer can absorb them, and they're then deducted from the payout. Free tickets: no fees.
 */
import { M } from "../markets";
import { assemble, moneyFor, num, pct, str, toCents } from "../money";
import type { CalculatorDef, Inputs, Line, Market } from "../types";
import { CHECKED, src } from "./_kit";

const sources = [
  src("eb-pricing", "Create an Event for Free: Pricing", "https://www.eventbrite.com/organizer/pricing/", "Eventbrite"),
  src("eb-fees", "Eventbrite’s Ticketing Fees", "https://www.eventbrite.com/help/en-us/articles/755615/how-much-does-it-cost-for-organizers-to-use-eventbrite/", "Eventbrite Help"),
];

function calculate(inputs: Inputs, market: Market) {
  const money = moneyFor(market);
  const price = toCents(num(inputs, "price"));
  const qty = Math.max(1, Math.round(num(inputs, "qty", 1)));
  const tax = Math.max(0, Math.min(20, num(inputs, "tax")));
  const absorb = str(inputs, "who", "buyer") === "absorb";
  const service = price ? pct(price, 3.7) + 179 : 0;
  const ticketTax = pct(price, tax);
  const orderTotal = absorb ? (price + ticketTax) * qty : (price + service + ticketTax) * qty;
  const processing = price ? pct(orderTotal, 2.9) : 0;
  const serviceLine: Line = { id: "service", label: "Service fee (3.7% + $1.79 per ticket)", amount: service * qty, kind: "platform", detail: `(3.7% × ${money(price)} + $1.79) × ${qty}`, explain: "Eventbrite’s service fee on each paid ticket, calculated on the ticket price.", source: "eb-pricing" };
  const procLine: Line = { id: "processing", label: "Payment processing (2.9% of the order)", amount: processing, kind: "payment", detail: `2.9% × ${money(orderTotal)}`, explain: "2.9% of the whole order, including service fees and tax.", source: "eb-fees" };
  const notes: string[] = [];
  if (price > 0) {
    notes.push(absorb ? `Passing the fees to buyers instead, you’d receive ${money(price * qty)} and each buyer would pay about ${money(price + service + ticketTax + Math.round(pct((price + service + ticketTax), 2.9)))}.` : `If you absorb the fees instead, the buyer pays ${money(price + ticketTax)} a ticket and you receive about ${money(price - service - pct(price + ticketTax, 2.9))}.`);
    notes.push("Publishing is free on the Free plan; paid Organizer plans add a publishing fee but the same ticketing fees.");
  }
  return absorb
    ? assemble({ market, buyerPays: orderTotal, saleAmount: (price + ticketTax) * qty, fees: [serviceLine, procLine], notes, ...(ticketTax ? { payout: (price + ticketTax) * qty - service * qty - processing } : {}) })
    : assemble({ market, buyerPays: orderTotal + processing, saleAmount: price * qty, fees: [], buyerFees: [serviceLine, procLine, ...(ticketTax ? [{ id: "tax", label: "Sales tax", amount: ticketTax * qty, kind: "tax" as const }] : [])], notes });
}

const def: CalculatorDef = {
  slug: "eventbrite",
  name: "Eventbrite",
  path: "/eventbrite-fee-calculator",
  category: "creators",
  priceNoun: "ticket price",
  sellerNoun: "organizer",
  buyerNoun: "ticket buyer",
  blurb: "3.7% + $1.79 per paid ticket plus 2.9% processing; pass on or absorb",
  markets: [M.us],
  defaultMarket: "us",
  priceField: "price",
  fields: [
    { id: "price", kind: "money", label: "Ticket price", section: "sale" },
    { id: "qty", kind: "number", label: "Tickets sold", section: "sale", min: 1, integer: true },
    { id: "who", kind: "segmented", label: "Who pays the fees?", section: "sale", options: [{ value: "buyer", label: "Buyers (default)" }, { value: "absorb", label: "I absorb them" }] },
    { id: "tax", kind: "percent", label: "Sales tax on tickets", section: "options", max: 20, step: 0.01, advanced: true },
  ],
  defaults: () => ({ price: 50, qty: 1, who: "buyer", tax: 0 }),
  calculate,
  breakpoints: () => [],
  verifiedAt: CHECKED,
  sources,
  changes: [],
  schedule: () => [
    { fee: "Service fee", amount: "3.7% + $1.79", appliesTo: "Each paid ticket (ticket price)", when: "Paid by buyers unless you absorb it", source: "eb-pricing" },
    { fee: "Payment processing", amount: "2.9%", appliesTo: "Total order incl. service fees and tax", source: "eb-fees" },
    { fee: "Free tickets", amount: "No fees", appliesTo: "—", source: "eb-fees" },
  ],
};
export default def;
