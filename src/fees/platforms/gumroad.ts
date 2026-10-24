/*
 * Gumroad creator fees. Every number is from Gumroad's own pages (see `sources`), re-read on
 * 2026-10-23. The help-center pages render their text inside an Inertia JSON attribute that a
 * plain-HTML diff can't see, so each one is watched through its source file in Gumroad's public
 * repository (antiwork/gumroad, MIT), which is what the help center renders.
 * Research notes with verbatim quotes: research/fees/gumroad.md.
 *
 * What one sale goes through (what this module reproduces):
 *  - Direct sales (profile, direct links, the creator's own marketing): Gumroad fee 10% + $0.50
 *    plus processing 2.9% + $0.30 when the payment runs through Gumroad's checkout, whatever the
 *    buyer pays with. 5% + $0.50 instead of 10% + $0.50 for new direct sales once the month's paid
 *    sales reach $20,000.
 *  - Discover sales (Gumroad's marketplace): a flat 30%, processing included, no fixed fee.
 *  - Sales paid into the creator's own connected PayPal / Stripe account: only the Gumroad part
 *    (10% + $0.50 direct, 30% Discover); PayPal or Stripe take their own processing fee separately.
 *  - Base: what the buyer pays for the product (after discounts, including tips) plus shipping.
 *    Sales tax / VAT / GST is added on top by Gumroad as merchant of record and is never in the
 *    base.
 *  - Rounding, as Gumroad's own code does it (app/models/purchase.rb, Purchase#calculate_fees):
 *    the percentages are added up (12.9%, 7.9% or 30%), rounded ONCE to the cent half away from
 *    zero, then the fixed fees are added. We show the Gumroad and processing parts as two lines;
 *    the processing line is the difference, so the two always add up to what Gumroad deducts.
 *  - Affiliates and collaborators: their cut × the product price (no tax, no shipping), minus the
 *    same share of the sale's fees, rounded down to the cent (Purchase#determine_affiliate_balance_cents).
 *  - Installment plans: every payment is charged separately, fixed fees included. Gumroad puts the
 *    remainder cents on the first payment ($100 in 3 = $33.34 + $33.33 + $33.33).
 *  - Payout fees: none on standard bank payouts. PayPal payouts 2% of the amount, rounded UP to
 *    the cent (PaypalPayoutProcessor). Instant payouts (US) send balance ÷ 1.03 rounded down, i.e.
 *    3% of the amount sent (StripePayoutProcessor). Payouts batch many sales; we show this sale's share.
 */
import { M } from "../markets";
import { assemble, bool, formatRate, moneyFor, num, pct, roundCents, str, toCents } from "../money";
import type { CalculatorDef, FeeChange, Inputs, Line, Market, ScheduleRow, SelectOption, Source } from "../types";

/** Gumroad prices, fees and settlement are in US dollars for every creator, wherever they live. */
const WORLD: Market = { ...M.us, label: "All countries (US$)", flag: "🌍" };
const MARKETS: Market[] = [WORLD];

/* Rates in per-thousand, as Gumroad's code holds them (100 = 10%). */
const GUMROAD_PER_K = 100; // 10%
const HIGH_VOLUME_PER_K = 50; // 5%
const PROCESSING_PER_K = 29; // 2.9%
const DISCOVER_PER_K = 300; // 30%, processing included
const GUMROAD_FIXED = 50; // $0.50
const PROCESSING_FIXED = 30; // $0.30
const HIGH_VOLUME_THRESHOLD = 2_000_000; // $20,000 of paid sales in a calendar month
const GUMROAD_AFFILIATE_PCT = 10;
const OWN_AFFILIATE_MIN = 1;
const OWN_AFFILIATE_MAX = 75;
const COLLAB_MAX = 50;
const PAYPAL_PAYOUT_PCT = 2;
const INSTANT_PAYOUT_PCT = 3;
const MIN_PAYOUT = 10_000; // $100

const S = {
  pricing: "gumroad-pricing",
  fees: "gumroad-fees",
  paid: "gumroad-getting-paid",
  refunds: "gumroad-refunds",
  affiliates: "gumroad-affiliates",
  collab: "gumroad-collaborators",
  installments: "gumroad-installments",
  discover: "gumroad-discover",
  tax: "gumroad-sales-tax",
  vat: "gumroad-vat",
  stripe: "gumroad-stripe-connect",
  paypal: "gumroad-paypal-connect",
  pwyw: "gumroad-pwyw",
  mor: "gumroad-mor-announcement",
  instant: "gumroad-instant-payouts",
  feeRows: "gumroad-fee-labels",
  code: "gumroad-fee-code",
  minPayout: "gumroad-min-payout",
} as const;

const help = (id: string, file: string, title: string): Omit<Source, "id"> => ({
  title,
  url: `https://gumroad.com/help/article/${file}`,
  publisher: "Gumroad Help Center",
  checked: "2026-10-23",
  watch: `https://raw.githubusercontent.com/antiwork/gumroad/main/app/views/help_center/articles/contents/_${file}.html.erb`,
});

const sources: Source[] = [
  { id: S.pricing, title: "Gumroad pricing: 10% + 50¢ direct, 30% via Discover", url: "https://gumroad.com/pricing", publisher: "Gumroad", checked: "2026-10-23" },
  { ...help(S.fees, "66-gumroads-fees", "Gumroad's fees"), id: S.fees },
  { ...help(S.paid, "13-getting-paid", "Getting paid by Gumroad"), id: S.paid },
  { ...help(S.refunds, "47-how-to-refund-a-customer", "Issuing a refund"), id: S.refunds },
  { ...help(S.affiliates, "333-affiliates-on-gumroad", "Affiliates on Gumroad"), id: S.affiliates },
  { ...help(S.collab, "341-collaborations", "Collaborate with another creator"), id: S.collab },
  { ...help(S.installments, "346-installment-plans", "Allowing installment plans"), id: S.installments },
  { ...help(S.discover, "79-gumroad-discover", "Gumroad Discover"), id: S.discover },
  { ...help(S.tax, "121-sales-tax-on-gumroad", "Sales tax on Gumroad"), id: S.tax },
  { ...help(S.vat, "10-dealing-with-vat", "EU & UK VAT on Gumroad"), id: S.vat },
  { ...help(S.stripe, "330-stripe-connect", "Connect your Stripe account to Gumroad"), id: S.stripe },
  { ...help(S.paypal, "275-paypal-connect", "Adding PayPal to checkout"), id: S.paypal },
  { ...help(S.pwyw, "133-pay-what-you-want-pricing", "\"Pay what you want\" pricing"), id: S.pwyw },
  {
    id: S.mor,
    title: "Gumroad is becoming a Merchant of Record (+ more updates!)",
    url: "https://gumroad.com/blog/p/gumroad-is-becoming-a-merchant-of-record-more-updates",
    publisher: "Gumroad (official announcement)",
    checked: "2026-10-23",
  },
  { id: S.instant, title: "Instant Payouts!", url: "https://gumroad.com/blog/p/instant-payouts", publisher: "Gumroad (official announcement)", checked: "2026-10-23" },
  {
    id: S.feeRows,
    title: "Stack fee rows and say what the Discover fee includes (#8477)",
    url: "https://github.com/antiwork/gumroad/pull/8477",
    publisher: "Gumroad source code (antiwork/gumroad)",
    checked: "2026-10-23",
  },
  {
    id: S.code,
    title: "app/models/purchase.rb: Purchase#calculate_fees",
    url: "https://github.com/antiwork/gumroad/blob/main/app/models/purchase.rb",
    publisher: "Gumroad source code (antiwork/gumroad)",
    checked: "2026-10-23",
    watch: "https://raw.githubusercontent.com/antiwork/gumroad/main/app/models/purchase.rb",
  },
  {
    id: S.minPayout,
    title: "Raise payout minimum balance from $10 to $100 (#4038)",
    url: "https://github.com/antiwork/gumroad/pull/4038",
    publisher: "Gumroad source code (antiwork/gumroad)",
    checked: "2026-10-23",
  },
];

const changes: FeeChange[] = [
  {
    date: "2026-08-18",
    text: "High-volume discount: once your paid sales in a calendar month reach $20,000, new direct sales that month pay 5% + $0.50 instead of 10% + $0.50 (processing still applies; Discover stays at 30%).",
    source: S.fees,
  },
  {
    date: "2026-07-17",
    text: "Refunds: Gumroad now states that its own fee on the refunded part of a sale is returned to you; only the payment-processing part is kept (the help center used to say no fees were refunded).",
    source: S.refunds,
  },
  { date: "2026-03-23", text: "Minimum balance for a payout raised from $10 to $100 (some countries have higher local-currency minimums).", source: S.minPayout },
  {
    date: "2025-01-01",
    text: "Gumroad became the merchant of record for all sales and moved to today’s fees: 10% + $0.50 plus card processing on direct sales, and a flat 30% (processing included) on sales through Discover.",
    source: S.mor,
  },
  { date: "2024-11-29", text: "Instant payouts launched: get paid within minutes for a 3% fee, up to $10K per payout (today US creators only).", source: S.instant },
  { date: "2024-08-06", text: "Collaborators now share Gumroad’s fees in proportion to their cut (before, the main creator paid all of them).", source: S.collab },
];

type Source_ = "direct" | "discover";
type Partner = "none" | "own" | "gumroad" | "collab";
type Payout = "bank" | "paypal" | "instant";

/** Gumroad's installment split: equal parts in cents, remainder on the first payment. */
export function splitInstallments(totalCents: number, n: number): number[] {
  const count = Math.max(1, Math.floor(n));
  const base = Math.floor(totalCents / count);
  const rem = totalCents - base * count;
  return Array.from({ length: count }, (_, i) => (i === 0 ? base + rem : base));
}

interface ChargeFees {
  /** Gumroad's own part (10%/5% + $0.50, or the 30% Discover fee). */
  gumroad: number;
  /** Processing part charged by Gumroad (0 on Discover, where it is included, and on connected accounts). */
  processing: number;
}

/** Fees on one charge, exactly as Gumroad computes them: one rounding on the summed rate, then fixed fees. */
export function chargeFees(baseCents: number, source: Source_, opts: { connected?: boolean; highVolume?: boolean } = {}): ChargeFees {
  if (baseCents <= 0) return { gumroad: 0, processing: 0 };
  if (source === "discover") return { gumroad: roundCents((baseCents * DISCOVER_PER_K) / 1000), processing: 0 };
  const grPerK = opts.highVolume ? HIGH_VOLUME_PER_K : GUMROAD_PER_K;
  const gumroad = roundCents((baseCents * grPerK) / 1000) + GUMROAD_FIXED;
  if (opts.connected) return { gumroad, processing: 0 };
  const total = roundCents((baseCents * (grPerK + PROCESSING_PER_K)) / 1000) + GUMROAD_FIXED + PROCESSING_FIXED;
  return { gumroad, processing: total - gumroad };
}

/** An affiliate's or collaborator's credit on one charge: cut × product price − cut × fees, rounded down. */
export function partnerCredit(productCents: number, feeCents: number, cutPct: number): number {
  const cut = Math.round(cutPct * 100) / 10_000; // basis points, as Gumroad stores them
  let credit = cut * productCents;
  credit -= cut * feeCents;
  return Math.max(0, Math.floor(credit));
}

/** Fee Gumroad takes when paying out `amountCents` by this method. */
export function payoutFee(amountCents: number, method: Payout): number {
  if (amountCents <= 0) return 0;
  if (method === "paypal") return Math.ceil((amountCents * PAYPAL_PAYOUT_PCT) / 100);
  if (method === "instant") return amountCents - Math.floor((amountCents * 100) / (100 + INSTANT_PAYOUT_PCT));
  return 0;
}

const PARTNER_OPTIONS: SelectOption[] = [
  { value: "none", label: "No, nobody else" },
  { value: "own", label: "My affiliate", hint: "the 1–75% you set" },
  { value: "gumroad", label: "A Gumroad Affiliate", hint: "fixed 10%" },
  { value: "collab", label: "A collaborator", hint: "their cut, up to 50%" },
];

const PAYOUT_OPTIONS: SelectOption[] = [
  { value: "bank", label: "Bank deposit", hint: "no fee · $100 minimum" },
  { value: "paypal", label: "PayPal payout", hint: "2% · where bank payouts aren’t offered" },
  { value: "instant", label: "Instant payout (US)", hint: "3% · up to $10K" },
];

function calculate(inputs: Inputs, market: Market) {
  const money = moneyFor(market);
  const source: Source_ = str(inputs, "source", "direct") === "discover" ? "discover" : "direct";
  const connected = bool(inputs, "connected");
  const highVolume = source === "direct" && bool(inputs, "highVolume");
  const price = toCents(num(inputs, "price"));
  const shipping = toCents(num(inputs, "shipping"));
  // Installment plans exist only for digital products, so shipping turns them off.
  const n = shipping > 0 ? 1 : Math.min(24, Math.max(1, Math.round(num(inputs, "installments", 1))));
  const parts = splitInstallments(price, n);
  const base = price + shipping;

  const warnings: string[] = [];
  const partner = str(inputs, "partner", "none") as Partner;
  let cutPct = 0;
  if (partner === "gumroad") cutPct = GUMROAD_AFFILIATE_PCT;
  else if (partner === "own") {
    const typed = num(inputs, "partnerPct");
    cutPct = Math.min(OWN_AFFILIATE_MAX, Math.max(OWN_AFFILIATE_MIN, typed));
    if (typed !== cutPct) warnings.push(`Gumroad lets you set an affiliate commission between 1% and 75%; we used ${formatRate(cutPct)}.`);
  } else if (partner === "collab") {
    const typed = num(inputs, "partnerPct");
    cutPct = Math.min(COLLAB_MAX, Math.max(0, typed));
    if (typed > COLLAB_MAX) warnings.push("A collaborator’s cut can be at most 50%; we used 50%.");
  }

  // Each installment is its own charge; shipping (no installments) rides on the single charge.
  let gumroad = 0;
  let processing = 0;
  let credit = 0;
  parts.forEach((part, i) => {
    const chargeBase = part + (i === 0 ? shipping : 0);
    const f = chargeFees(chargeBase, source, { connected, highVolume });
    gumroad += f.gumroad;
    processing += f.processing;
    if (cutPct > 0) credit += partnerCredit(part, f.gumroad + f.processing, cutPct);
  });
  const paymentsNote = n > 1 ? ` × ${n} payments` : "";
  const each = n > 1 ? " on each payment" : "";

  const fees: Line[] = [];
  if (source === "discover") {
    fees.push({
      id: "discover",
      label: "Gumroad Discover fee (30%)",
      amount: gumroad,
      kind: "platform",
      detail: n > 1 ? `30% of each of ${n} payments (${money(base)} in all)` : `30% × ${money(base)}`,
      explain: connected
        ? "A flat 30% when the buyer found you through Gumroad’s Discover marketplace. On a connected PayPal or Stripe account it is Gumroad’s part only: the processor’s fee comes on top."
        : "A flat 30% when the buyer found you through Gumroad’s Discover marketplace (its search, category pages and recommendations). It replaces the 10% + $0.50 and already includes payment processing: nothing else is added.",
      source: S.fees,
    });
    if (!connected) {
      fees.push({
        id: "processing",
        label: "Processing fee",
        amount: 0,
        kind: "payment",
        detail: "Included in the 30%",
        explain: "Discover sales have no separate processing fee and no fixed $0.50 + $0.30: the 30% is the whole charge.",
        source: S.fees,
      });
    }
  } else {
    const grRate = highVolume ? "5%" : "10%";
    fees.push({
      id: "gumroad",
      label: highVolume ? "Gumroad fee (high-volume rate)" : "Gumroad fee",
      amount: gumroad,
      kind: "platform",
      detail: `${grRate} × ${money(base)} + $0.50${paymentsNote}`,
      explain: highVolume
        ? `5% + $0.50${each} instead of 10% + $0.50, for new direct sales once your paid sales this calendar month have reached ${money(HIGH_VOLUME_THRESHOLD)}. It resets on the 1st, and a refund that takes you back under that amount switches it off again.`
        : `10% of the price (after discounts, including tips${shipping ? " and shipping" : ""}) plus $0.50${each}, for every sale that didn’t come through Discover: your profile, direct links, social posts, email. Not charged on sales tax or VAT.`,
      source: highVolume ? S.fees : S.pricing,
    });
    if (!connected) {
      fees.push({
        id: "processing",
        label: "Processing fee",
        amount: processing,
        kind: "payment",
        detail: `2.9% × ${money(base)} + $0.30${paymentsNote}`,
        explain:
          "Gumroad’s checkout adds 2.9% + $0.30 for payment processing on top of its own fee, whether the buyer pays by card, PayPal or a local method, so a direct sale costs 12.9% + $0.80 in all. Gumroad rounds the combined percentage once, so this line can differ by a cent from 2.9% on its own. On a refund Gumroad returns its own fee but keeps this part.",
        source: S.fees,
      });
    }
  }

  if (cutPct > 0) {
    const label = partner === "collab" ? `Collaborator’s cut (${formatRate(cutPct)})` : partner === "gumroad" ? "Gumroad Affiliate commission (10%)" : `Affiliate commission (${formatRate(cutPct)})`;
    const feeTotal = gumroad + processing;
    fees.push({
      id: "partner",
      label,
      amount: credit,
      kind: "other",
      detail: `${formatRate(cutPct)} × ${money(price)} − ${formatRate(cutPct)} × ${money(feeTotal)} fees`,
      explain:
        partner === "collab"
          ? `Your collaborator gets ${formatRate(cutPct)} of the product price and pays ${formatRate(cutPct)} of Gumroad’s fees out of it. Shipping stays entirely with you. Gumroad rounds their share down to the cent.`
          : partner === "gumroad"
            ? "Gumroad Affiliates earn a fixed 10% of the product price and pay 10% of the fees. Products on Discover are opted in automatically; you can opt out of the program for all products in your Affiliates dashboard."
            : `Your affiliate earns ${formatRate(cutPct)} of what the buyer paid for the product (after discounts, including tips, never tax or shipping) and pays the same share of the fees. Gumroad rounds their share down to the cent.`,
      source: partner === "collab" ? S.collab : S.affiliates,
    });
  }

  const method = (str(inputs, "payout", "bank") as Payout) || "bank";
  const net = base - gumroad - processing - credit;
  if (method === "paypal" || method === "instant") {
    const fee = payoutFee(net, method);
    const sent = net - fee;
    fees.push({
      id: "payout",
      label: method === "paypal" ? "PayPal payout fee (2%)" : "Instant payout fee (3%)",
      amount: fee,
      kind: "payout",
      detail: method === "paypal" ? `2% × ${money(net)}, rounded up` : `${money(net)} ÷ 1.03 = ${money(sent)} sent`,
      explain:
        method === "paypal"
          ? "Gumroad pays creators in countries without bank payouts through PayPal, in US dollars, and takes 2% of each payout. Payouts bundle many sales; this is this sale’s share."
          : "Instant payouts (US creators only) arrive within minutes for a 3% fee, up to $10K at a time. Gumroad works the 3% out on the amount it sends, so you receive your balance ÷ 1.03.",
      source: S.paid,
    });
  } else {
    fees.push({
      id: "payout",
      label: "Bank payout",
      amount: 0,
      kind: "payout",
      detail: "No fee",
      explain: `Gumroad charges nothing for standard bank payouts (weekly, monthly or quarterly). Your balance has to reach ${money(MIN_PAYOUT)} first (more in a few countries), and it is converted to your currency at the rate on the day of each sale.`,
      source: S.paid,
    });
  }

  const taxRate = Math.min(30, Math.max(0, num(inputs, "taxRate")));
  const tax = pct(base, taxRate);
  const buyerFees: Line[] = tax
    ? [
        {
          id: "tax",
          label: "Sales tax / VAT (Gumroad collects it)",
          amount: tax,
          kind: "tax",
          detail: `${formatRate(taxRate)} × ${money(base)}`,
          explain:
            "Gumroad is the merchant of record: it adds the buyer’s sales tax, VAT or GST on top of your price and pays it to the tax office. It never passes through your balance, and Gumroad’s fees aren’t charged on it. You can’t make prices tax-inclusive.",
          source: S.tax,
        },
      ]
    : [];

  const notes: string[] = [];
  if (price === 0) notes.push("Gumroad takes no fee on free products.");
  else if (source === "direct") {
    const alt = parts.reduce((s, part, i) => s + chargeFees(part + (i === 0 ? shipping : 0), "discover").gumroad, 0);
    notes.push(`If this buyer had found you through Gumroad Discover, the fee would be a flat 30% (${money(alt)}) instead of ${money(gumroad + processing)}.`);
  } else {
    const alt = parts.reduce((s, part, i) => {
      const f = chargeFees(part + (i === 0 ? shipping : 0), "direct", { connected });
      return s + f.gumroad + f.processing;
    }, 0);
    notes.push(`The same sale through your own link or profile would cost ${money(alt)} in fees${connected ? " (Gumroad’s part)" : " (12.9% + $0.80)"} instead of ${money(gumroad)}.`);
  }
  if (connected) notes.push("Paid into your own PayPal or Stripe account: they take their own processing fee from the payment, which isn’t included above.");
  if (highVolume) notes.push("The 5% rate starts with the first direct sale after your paid sales this month reach $20,000; your sales CSV shows the exact fee on every sale.");
  if (!tax && price > 0 && notes.length < 3) notes.push("Gumroad adds any sales tax or VAT on top of your price at checkout and pays it for you. Add the buyer’s rate under “More options” to see their total.");

  const costs: Line[] = [];
  const itemCost = toCents(num(inputs, "itemCost"));
  const shipCost = toCents(num(inputs, "shippingCost"));
  if (itemCost) costs.push({ id: "itemCost", label: "Your cost per sale", amount: itemCost, kind: "cost" });
  if (shipCost) costs.push({ id: "shippingCost", label: "Postage you pay", amount: shipCost, kind: "cost" });

  return assemble({ market, buyerPays: base + tax, saleAmount: base, fees, buyerFees, costs, notes: notes.slice(0, 3), warnings });
}

function schedule(): ScheduleRow[] {
  return [
    { fee: "Gumroad fee (direct sales)", amount: "10% + $0.50", appliesTo: "Price after discounts, incl. tips and shipping (not tax)", when: "Buyer came from your profile, a direct link or your own marketing", source: S.pricing },
    { fee: "Processing fee", amount: "2.9% + $0.30", appliesTo: "Same amount", when: "Direct sales paid through Gumroad’s checkout (card, PayPal or local method)", source: S.fees },
    { fee: "Gumroad Discover fee", amount: "30% (processing included)", appliesTo: "Same amount", when: "Buyer found you through Gumroad Discover", source: S.fees },
    { fee: "High-volume rate", amount: "5% + $0.50 (+ processing)", appliesTo: "Same amount", when: "New direct sales after $20,000 of paid sales in a calendar month", source: S.fees },
    { fee: "Connected PayPal / Stripe", amount: "10% + $0.50 or 30% to Gumroad; processor’s own fee on top", appliesTo: "Same amount", when: "Sales paid into your own connected account", source: S.feeRows },
    { fee: "Affiliate or collaborator", amount: "Their % of the price, less the same % of fees", appliesTo: "Product price (no tax or shipping)", when: "Affiliate 1–75%, Gumroad Affiliate 10%, collaborator up to 50%", source: S.affiliates },
    { fee: "Installment plans", amount: "Full fees on every payment", appliesTo: "Each installment", when: "Buyer pays in installments", source: S.installments },
    { fee: "Bank payout", amount: "No fee · $100 minimum", appliesTo: "Your balance", when: "Weekly, monthly or quarterly payouts", source: S.paid },
    { fee: "PayPal payout", amount: "2%", appliesTo: "Amount paid out", when: "Countries without bank payouts", source: S.paid },
    { fee: "Instant payout", amount: "3%", appliesTo: "Amount paid out (up to $10K)", when: "US creators, on request", source: S.paid },
    { fee: "Sales tax / VAT / GST", amount: "Buyer’s local rate, added on top", appliesTo: "Paid by the buyer, collected by Gumroad", when: "Wherever Gumroad must collect it", source: S.tax },
    { fee: "Refunds", amount: "Gumroad fee returned; processing part kept", appliesTo: "The refunded amount", when: "Refunded sales through Gumroad’s checkout", source: S.refunds },
    { fee: "Free products", amount: "No fee", appliesTo: "$0 sales", when: "Free or pay-what-you-want at $0", source: S.pwyw },
  ];
}

export const gumroad: CalculatorDef = {
  slug: "gumroad",
  name: "Gumroad",
  path: "/gumroad-fee-calculator",
  category: "creators",
  priceNoun: "product price",
  sellerNoun: "creator",
  saleNoun: "sale",
  blurb: "10% + $0.50 plus 2.9% + $0.30 processing direct; 30% via Discover",
  markets: MARKETS,
  defaultMarket: "us",
  priceField: "price",
  fields: [
    { id: "price", kind: "money", label: "Product price", section: "sale", help: "What the buyer pays for it, after any discount and including any tip. Tax is added on top and doesn’t count." },
    {
      id: "source",
      kind: "segmented",
      label: "Where did the buyer find you?",
      section: "sale",
      options: [
        { value: "direct", label: "My link or profile" },
        { value: "discover", label: "Gumroad Discover" },
      ],
      help: "Sales Gumroad’s marketplace brings you cost a flat 30%, processing included. Everything else costs 10% + $0.50 plus 2.9% + $0.30.",
    },
    {
      id: "partner",
      kind: "select",
      label: "Does an affiliate or collaborator get a cut?",
      section: "sale",
      options: PARTNER_OPTIONS,
      help: "They also pay their share of the fees: an affiliate on 30% covers 30% of them.",
    },
    {
      id: "partnerPct",
      kind: "percent",
      label: "Their cut",
      section: "sale",
      min: 1,
      max: 75,
      help: (i) => (str(i, "partner") === "collab" ? "Up to 50% for a collaborator. Shipping isn’t shared." : "Anything from 1% to 75%, paid on the product price only (no tax or shipping)."),
      showIf: (i) => str(i, "partner") === "own" || str(i, "partner") === "collab",
    },
    {
      id: "payout",
      kind: "select",
      label: "How do you get paid out?",
      section: "options",
      options: PAYOUT_OPTIONS,
      help: "Bank payouts are free. PayPal payouts cost 2% and instant payouts 3%.",
    },
    { id: "taxRate", kind: "percent", label: "Buyer’s sales tax or VAT rate", section: "sale", advanced: true, max: 30, help: "Gumroad adds it at checkout and pays it for you. It doesn’t change your fees or payout." },
    {
      id: "installments",
      kind: "number",
      label: "Number of installments",
      section: "sale",
      advanced: true,
      integer: true,
      min: 1,
      max: 24,
      unit: "payments",
      help: "Each payment is charged Gumroad’s full fees, including the fixed $0.50 + $0.30.",
      showIf: (i) => num(i, "shipping") <= 0,
    },
    { id: "shipping", kind: "money", label: "Shipping you charge", section: "shipping", advanced: true, help: "Physical products only. Gumroad’s fees apply to shipping too." },
    {
      id: "highVolume",
      kind: "toggle",
      label: "My paid sales this month are already over $20,000",
      section: "options",
      advanced: true,
      help: "New direct sales then pay 5% + $0.50 instead of 10% + $0.50 until the 1st. Discover stays 30%.",
      showIf: (i) => str(i, "source", "direct") === "direct",
    },
    {
      id: "connected",
      kind: "toggle",
      label: "Paid into my own connected PayPal or Stripe account",
      section: "options",
      advanced: true,
      help: "Gumroad then takes only its 10% + $0.50 (or 30%); PayPal or Stripe charge their own processing fee.",
    },
    { id: "itemCost", kind: "money", label: "Your cost per sale", section: "costs", help: "Optional: printing, licences, hosting or anything you pay per sale." },
    { id: "shippingCost", kind: "money", label: "Postage you pay", section: "costs", showIf: (i) => num(i, "shipping") > 0 },
  ],
  defaults: () => ({
    price: 25,
    source: "direct",
    partner: "none",
    partnerPct: 30,
    payout: "bank",
    taxRate: 0,
    installments: 1,
    shipping: 0,
    highVolume: false,
    connected: false,
    itemCost: 0,
    shippingCost: 0,
  }),
  calculate,
  // Every Gumroad fee is a straight percentage plus a fixed amount: no tiers or caps depend on the price.
  breakpoints: () => [],
  verifiedAt: "2026-10-23",
  sources,
  changes,
  schedule,
};

export default gumroad;
