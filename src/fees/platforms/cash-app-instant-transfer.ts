/* Cash App instant deposit (US). Range from Cash App's Terms of Service, checked 2026-10-24: 0.5%–2.5%, $0.25–$1 minimum, $75 maximum. */
import { instantTransfer, src } from "./_kit";

const sources = [
  src("cash-tos", "Cash App Terms of Service", "https://cash.app/us/en/legal/tos", "Cash App"),
  src("cash-not-instant", "Withdrawal Transfer Wasn't Instant", "https://cash.app/help/us/en-us/3074-cash-out-not-instant", "Cash App Help"),
];

export default instantTransfer({
  slug: "cash-app-instant-transfer",
  name: "Cash App Instant Transfer",
  path: "/cash-app-instant-transfer-fee-calculator",
  brand: "Cash App",
  blurb: "0.5%–2.5% to deposit instantly ($0.25–$1 minimum, $75 maximum); standard free",
  tiers: [{ id: "personal", label: "Personal", rate: 1.75, min: 25, max: 7500, rule: "0.5%–2.5% of the amount (shown in the app), with a $0.25–$1 minimum and a $75 maximum", source: "cash-tos" }],
  customRate: { min: 0.5, max: 2.5, minFee: [0.25, 1] },
  standard: "Standard deposits to your bank are free and take 1–3 business days.",
  standardSource: "cash-tos",
  instantWhere: "Instant deposits go to your linked debit card within minutes.",
  limits: "Cash App shows the exact instant rate and arrival amount before you confirm; it can differ from one deposit to the next.",
  limitsSource: "cash-tos",
  defaultAmount: 300,
  sources,
});
