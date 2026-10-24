/* Venmo Instant Transfer (US). Rates from Venmo's fee page and Instant Transfer FAQ, checked 2026-10-24. */
import { instantTransfer, src } from "./_kit";

const sources = [
  src("venmo-fees", "About Venmo Fees", "https://venmo.com/resources/our-fees/", "Venmo"),
  src("venmo-instant", "Instant Bank Transfer FAQ", "https://help.venmo.com/cs/articles/instant-bank-transfer-faq-vhel302", "Venmo Help"),
];

export default instantTransfer({
  slug: "venmo-instant-transfer",
  name: "Venmo Instant Transfer",
  path: "/venmo-instant-transfer-fee-calculator",
  brand: "Venmo",
  blurb: "1.75% to cash out instantly (min $0.25, max $25); standard transfer free",
  tiers: [{ id: "personal", label: "Personal", rate: 1.75, min: 25, max: 2500, rule: "1.75% of the amount, at least $0.25 and at most $25", source: "venmo-instant" }],
  standard: "Standard transfers to your bank are free and usually arrive in 1–3 business days.",
  standardSource: "venmo-fees",
  instantWhere: "Instant transfers go to an eligible debit card or bank, typically within minutes.",
  limits: "A verified personal profile can move up to $5,000 per Instant Transfer; larger balances take several transfers, each with its own fee.",
  limitsSource: "venmo-instant",
  defaultAmount: 500,
  sources,
});
