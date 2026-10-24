/* Apple Cash Instant Transfer (US). Apple Support article 120401, checked 2026-10-24. */
import { instantTransfer, src } from "./_kit";

const sources = [src("apple-cash-transfer", "Transfer money in Apple Cash to your bank account or debit card", "https://support.apple.com/en-us/120401", "Apple Support")];

export default instantTransfer({
  slug: "apple-cash-instant-transfer",
  name: "Apple Cash Instant Transfer",
  path: "/apple-cash-instant-transfer-fee-calculator",
  brand: "Apple Cash",
  blurb: "1.7% to a debit card instantly (min $0.25, max $25); bank transfer free",
  tiers: [{ id: "personal", label: "Personal", rate: 1.7, min: 25, max: 2500, rule: "1.7% of the amount, at least $0.25 and at most $25", source: "apple-cash-transfer" }],
  standard: "Transfers from Apple Cash to your bank account are free and usually take 1–3 business days.",
  standardSource: "apple-cash-transfer",
  instantWhere: "Instant Transfer sends money to an eligible US debit card, usually within 30 minutes.",
  limits: "Apple Cash transfers start at $1 (or your whole balance if it’s under $1); Apple’s transfer-limits article lists the per-transfer and seven-day maximums.",
  limitsSource: "apple-cash-transfer",
  defaultAmount: 200,
  sources,
});
