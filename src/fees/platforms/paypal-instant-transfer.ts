/* PayPal instant transfer (US). Personal: PayPal Consumer Fees; business: PayPal Merchant Fees. Checked 2026-10-24. */
import { instantTransfer, src } from "./_kit";

const sources = [
  src("pp-us-consumer", "PayPal Consumer Fees", "https://www.paypal.com/us/digital-wallet/paypal-consumer-fees", "PayPal US"),
  src("pp-us-merchant", "PayPal Merchant Fees", "https://www.paypal.com/us/business/paypal-business-fees", "PayPal US"),
];

export default instantTransfer({
  slug: "paypal-instant-transfer",
  name: "PayPal Instant Transfer",
  path: "/paypal-instant-transfer-fee-calculator",
  brand: "PayPal",
  blurb: "Personal 1.75% (min $0.25, max $25), business 1.5% (min $0.50); standard free",
  tierLabel: "Account type",
  tiers: [
    { id: "personal", label: "Personal", rate: 1.75, min: 25, max: 2500, rule: "1.75% of the amount, at least $0.25 and at most $25", source: "pp-us-consumer" },
    { id: "business", label: "Business", rate: 1.5, min: 50, rule: "1.5% of the amount, at least $0.50, with no maximum", source: "pp-us-merchant" },
  ],
  standard: "Standard transfers to your bank are free and usually arrive in 1–3 business days.",
  standardSource: "pp-us-consumer",
  instantWhere: "Instant transfers go to an eligible bank account or debit card within minutes.",
  defaultAmount: 500,
  sources,
  extraNotes: (amount, fee, t) => (t.id === "business" && amount >= 166700 ? ["Business accounts have no cap: on large balances a free standard transfer saves real money if you can wait a day or two."] : []),
});
