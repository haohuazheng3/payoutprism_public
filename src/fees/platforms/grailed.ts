/*
 * Grailed seller fees. Every number is from Grailed's own pages (see `sources`), re-read 2026-10-23:
 * the help-center articles through their Zendesk JSON API, the Terms of Service and the Patch Notes
 * in a browser (www.grailed.com blocks plain HTTP). Research notes with verbatim quotes:
 * research/fees/grailed.md.
 *
 * How a sale is settled (what this module reproduces):
 *  - Everything on Grailed is in US dollars ("all purchases on Grailed are made in USD only"), for
 *    sellers in every country. Markets here are the seller's location; they all compute in USD.
 *  - Seller commission, by the "sale price": 9% at $120 and above; 6% with a $1.99 minimum under $120
 *    ("Applicable to sales on/after 5/20/26"). Sale price = the listing price the item sells for (or
 *    the accepted offer), plus the shipping charged to the buyer only when the seller does NOT use a
 *    Grailed Label; never tax (ToS: "including applicable shipping costs, if you are not using
 *    Grailed Labels; excluding tax"). The same rates apply to domestic and international sales.
 *  - Payment processing, "assessed on the total transaction amount, including shipping and tax":
 *    onboarded with Stripe 3.49% + $0.49 (US domestic payments) / 4.99% + $0.49 (international);
 *    Stripe country but not onboarded 3.49% + $0.99 / 5.49% + $0.99; country without Stripe
 *    4.99% + $0.49 on every payment. Grailed doesn't define "US domestic"; its page says the rate
 *    depends on "how the buyer purchases your listing", so we key it to where the buyer pays from.
 *  - Grailed Labels (US→US required, Canada→US under $750 and 20 lb): the buyer pays the label as a
 *    separate checkout line, so it is not the seller's money and not in the commission base, but it is
 *    in the processing base. With free shipping the label is deducted from the payout. Over $750 a
 *    $4 signature confirmation is added to the shipping (paid by the seller with free shipping).
 *  - Sellers in Australia, the EU, New Zealand, Norway and the UK without a VAT/GST number on Grailed
 *    pay VAT/GST on the commission ("calculated based on the total Grailed commission fee"), shown as
 *    a "Tax" line. Grailed doesn't publish the rate: we use the country's standard rate.
 * Grailed doesn't document rounding; each line is rounded to the cent separately (half away from zero).
 */
import { M } from "../markets";
import { assemble, bool, costLines, formatRate, moneyFor, num, pct, str, toCents } from "../money";
import type { CalculatorDef, FeeChange, Inputs, Line, Market, ScheduleRow, Source } from "../types";

/** Grailed transacts in US dollars everywhere, so every market computes in USD; only the seller's location differs. */
const inUsd = (m: Market, over: Partial<Market> = {}): Market => ({ ...m, currency: "USD", ...over });

const MARKETS: Market[] = [
  M.us,
  inUsd(M.ca),
  inUsd(M.uk),
  inUsd(M.ie, { id: "eu", label: "European Union", flag: "🇪🇺" }),
  inUsd(M.au, { locale: "en-GB" }), // en-AU prints US dollars as "USD 105.00"; en-GB prints "US$105.00" like the other markets
  inUsd(M.us, { id: "other", label: "Other countries", locale: "en-GB", flag: "🌍" }),
];

/** Commission tiers (cents / percent). */
const TIER_EDGE = 12000; // $120.00: "$120 and above" pays 9%
const STANDARD = 9;
const REDUCED = 6;
const REDUCED_MIN = 199; // $1.99

/** Grailed Labels: Canada→US only under $750; signature confirmation over $750 (US). */
const LABEL_LIMIT_CA = 75000;
const SIGNATURE_OVER = 75000;
const SIGNATURE_FEE = 400;

type Stripe = "connected" | "none" | "unsupported";

/** Payment processing by Stripe status: [US domestic, international] as percent + fixed cents. */
const PROCESSING: Record<Stripe, { us: { rate: number; fixed: number }; intl: { rate: number; fixed: number } }> = {
  connected: { us: { rate: 3.49, fixed: 49 }, intl: { rate: 4.99, fixed: 49 } },
  none: { us: { rate: 3.49, fixed: 99 }, intl: { rate: 5.49, fixed: 99 } },
  unsupported: { us: { rate: 4.99, fixed: 49 }, intl: { rate: 4.99, fixed: 49 } },
};

/** VAT/GST Grailed adds to the commission for unregistered sellers. Fixed standard rate, or typed (EU, other countries). */
const VAT: Record<string, { rate: number | null; name: string }> = {
  uk: { rate: 20, name: "VAT" },
  au: { rate: 10, name: "GST" },
  eu: { rate: null, name: "VAT" },
  other: { rate: null, name: "VAT/GST" },
};

const HELP = (slugged: string) => `https://support.grailed.com/hc/en-us/articles/${slugged}`;
const API = (slugged: string) => `https://support.grailed.com/api/v2/help_center/en-us/articles/${slugged.split("-")[0]}.json`;

const S = {
  fees: "grailed-fees",
  processing: "grailed-processing",
  tos: "grailed-terms",
  patch: "grailed-patch-notes-v1",
  labels: "grailed-labels",
  labelsCa: "grailed-labels-canada",
  intlTax: "grailed-international-taxes",
  sellerTax: "grailed-seller-taxes",
  buyerTax: "grailed-buyer-tax",
  currency: "grailed-currency",
  refunds: "grailed-refunds",
} as const;

function help(id: string, slugged: string, title: string): Source {
  return { id, title, url: HELP(slugged), publisher: "Grailed Help", checked: "2026-10-23", watch: API(slugged) };
}

const sources: Source[] = [
  help(S.fees, "30282580172045-What-are-the-fees", "What are the fees?"),
  help(S.processing, "30299544492301-Does-Grailed-charge-a-payment-processing-fee", "Does Grailed charge a payment processing fee?"),
  { id: S.tos, title: "Grailed, LLC Terms of Service", url: "https://www.grailed.com/about/terms", publisher: "Grailed", checked: "2026-10-23" },
  { id: S.patch, title: "Grailed Patch Notes v1: May 2026", url: "https://www.grailed.com/drycleanonly/patch-notes-v1", publisher: "Grailed (Dry Clean Only)", checked: "2026-10-23" },
  help(S.labels, "32229125355661-What-are-Grailed-Labels", "What are Grailed Labels?"),
  help(S.labelsCa, "33898123092109-Grailed-Labels-Canada", "Grailed Labels Canada"),
  help(S.intlTax, "32231452195085-International-Taxes-on-Transactions", "International Taxes on Transactions"),
  help(S.sellerTax, "30299524516877-Does-Grailed-collect-taxes-from-Sellers", "Does Grailed collect taxes from Sellers?"),
  help(S.buyerTax, "30298811180941-Shipping-Cost-and-Tax-Facts-for-Buyers", "Shipping Cost and Tax Facts for Buyers"),
  help(S.currency, "30298404960013-Does-Grailed-support-other-currencies", "Does Grailed support other currencies?"),
  help(S.refunds, "30295620891661-I-ve-refunded-a-sale-how-do-I-get-the-fees-returned", "I've refunded a sale, how do I get the fees returned?"),
];

const changes: FeeChange[] = [
  {
    date: "2026-05-20",
    text: "Commission on sales under $120 cut from 9% to 6%, with a $1.99 minimum; sales of $120 and above stay at 9%. Grailed also lowered Grailed Label prices on sales under $120 in several categories (amounts not published).",
    source: S.patch,
  },
];

type Method = "label" | "free" | "own";

function buyerInUs(inputs: Inputs): boolean {
  return str(inputs, "buyer", "us") !== "intl";
}

/** Grailed Labels exist for US→US sales and Canada→US sales under $750 (the 20 lb limit is the seller's call: pick "own label"). */
function labelsAvailable(inputs: Inputs, market: Market): boolean {
  if (!buyerInUs(inputs)) return false;
  if (market.id === "us") return true;
  return market.id === "ca" && toCents(num(inputs, "price")) < LABEL_LIMIT_CA;
}

function shippingMethod(inputs: Inputs, market: Market): Method {
  if (!labelsAvailable(inputs, market)) return "own";
  const m = str(inputs, "shippingMethod", "label");
  return m === "free" || m === "own" ? m : "label";
}

function stripeStatus(inputs: Inputs, market: Market): Stripe {
  const v = market.id === "other" ? str(inputs, "stripeOther", "connected") : str(inputs, "stripe", "connected");
  if (v === "none") return "none";
  if (v === "unsupported" && market.id === "other") return "unsupported";
  return "connected";
}

function vatRate(inputs: Inputs, market: Market): number {
  const v = VAT[market.id];
  if (!v) return 0;
  const typed = (id: string) => Math.min(50, Math.max(0, num(inputs, id)));
  // Other countries: only New Zealand and Norway sellers pay it, so it is a typed rate (0 = none) with no toggle.
  if (market.id === "other") return typed("vatOther");
  if (!bool(inputs, "vatOnFees")) return 0;
  return v.rate ?? typed("vatRate");
}

/** Commission on a sale price (cents): 9% at $120+, otherwise 6% with a $1.99 minimum. */
export function commission(salePrice: number): { amount: number; rate: number; minimum: boolean } {
  if (salePrice <= 0) return { amount: 0, rate: REDUCED, minimum: false };
  if (salePrice >= TIER_EDGE) return { amount: pct(salePrice, STANDARD), rate: STANDARD, minimum: false };
  const raw = pct(salePrice, REDUCED);
  return raw < REDUCED_MIN ? { amount: REDUCED_MIN, rate: REDUCED, minimum: true } : { amount: raw, rate: REDUCED, minimum: false };
}

interface Computed {
  item: number;
  method: Method;
  /** Shipping the buyer pays (label incl. signature, or the seller's own shipping charge). */
  buyerShipping: number;
  /** Shipping that is the seller's money and part of the sale price (own label only). */
  ownShipping: number;
  salePrice: number;
  tax: number;
  fees: Line[];
  payout: number;
}

function compute(inputs: Inputs, market: Market): Computed {
  const money = moneyFor(market);
  const item = toCents(num(inputs, "price"));
  const method = shippingMethod(inputs, market);
  const usBuyer = buyerInUs(inputs);
  const onLabel = method !== "own";
  const signature = onLabel && market.id === "us" && item > SIGNATURE_OVER ? SIGNATURE_FEE : 0;
  const label = onLabel ? toCents(num(inputs, "labelCost")) : 0;
  const buyerShipping = method === "label" ? label + signature : method === "own" ? toCents(num(inputs, "shippingCharged")) : 0;
  const ownShipping = method === "own" ? buyerShipping : 0;
  const salePrice = item + ownShipping;

  const taxRate = Math.min(100, Math.max(0, num(inputs, "salesTax")));
  const tax = pct(item + buyerShipping, taxRate);
  const processingBase = item + buyerShipping + tax;

  const fees: Line[] = [];

  const c = commission(salePrice);
  const baseWords = onLabel
    ? "With a Grailed Label the sale price is the item price only."
    : "Because you use your own label, the sale price includes the shipping you charge.";
  fees.push({
    id: "commission",
    label: `Seller commission (${formatRate(c.rate)})`,
    amount: c.amount,
    kind: "platform",
    detail: c.minimum
      ? `${formatRate(c.rate)} × ${money(salePrice)} = ${money(pct(salePrice, c.rate))}, raised to the ${money(REDUCED_MIN)} minimum`
      : `${formatRate(c.rate)} × ${money(salePrice)}`,
    explain: `Grailed takes 9% when the sale price is $120 or more, and 6% (at least $1.99) below that. ${baseWords} Tax is never included.`,
    source: S.fees,
  });

  const stripe = stripeStatus(inputs, market);
  const p = usBuyer ? PROCESSING[stripe].us : PROCESSING[stripe].intl;
  const paidParts = ["the item", method === "label" ? "the Grailed Label" : method === "own" ? "shipping" : null, tax ? "tax" : null].filter(Boolean) as string[];
  const whatPaid = paidParts.length > 1 ? `${paidParts.slice(0, -1).join(", ")} and ${paidParts[paidParts.length - 1]}` : paidParts[0];
  fees.push({
    id: "processing",
    label: "Payment processing",
    amount: processingBase > 0 ? pct(processingBase, p.rate) + p.fixed : 0,
    kind: "payment",
    detail: `${formatRate(p.rate)} × ${money(processingBase)} + ${money(p.fixed)}`,
    explain: `Charged on everything the buyer pays (${whatPaid}), once per sale. ${
      stripe === "unsupported"
        ? "Sellers in countries without Stripe pay 4.99% + $0.49 on every sale."
        : stripe === "none"
          ? "You haven’t connected Stripe, so the fixed part is $0.99 and international payments cost 5.49%. Connecting Stripe brings it to $0.49."
          : usBuyer
            ? "3.49% + $0.49 for a US domestic payment with Stripe connected."
            : "4.99% + $0.49 for an international payment with Stripe connected."
    }`,
    source: S.processing,
  });

  const vRate = vatRate(inputs, market);
  if (vRate && c.amount) {
    const v = VAT[market.id];
    fees.push({
      id: "vat",
      label: `Tax on commission (${v.name} ${formatRate(vRate)})`,
      amount: pct(c.amount, vRate),
      kind: "tax",
      detail: `${formatRate(vRate)} × ${money(c.amount)}`,
      explain: `Sellers in ${market.id === "other" ? "New Zealand and Norway" : market.label} pay ${v.name} on Grailed’s commission unless they’ve added a ${v.name} registration number to their account. Grailed shows it as a “Tax” line and doesn’t publish the rate; ${formatRate(vRate)} is the standard rate${market.id === "eu" || market.id === "other" ? " you entered" : ""}.`,
      source: S.sellerTax,
    });
  }

  if (method === "label") {
    fees.push({
      id: "label",
      label: "Grailed Label",
      amount: 0,
      kind: "shipping",
      detail: `${money(buyerShipping)} paid by the buyer${signature ? ` (incl. ${money(signature)} signature)` : ""}`,
      explain: `The buyer pays for the label as a separate line at checkout, so it costs you nothing and isn’t part of the commission. Processing is still charged on it.${
        signature ? " Sales over $750 get signature confirmation, which adds $4 to the shipping." : ""
      }`,
      source: S.labels,
    });
  } else if (method === "free") {
    fees.push({
      id: "label",
      label: "Free shipping label",
      amount: label + signature,
      kind: "shipping",
      detail: signature ? `${money(label)} label + ${money(signature)} signature` : `${money(label)} label`,
      explain: `You offer free shipping, so Grailed deducts the label from your payout. Its price is set at the time of sale from current carrier rates.${
        signature ? " Over $750 you also pay the $4 signature confirmation." : ""
      }`,
      source: S.labels,
    });
  }

  const totalFees = fees.reduce((s, l) => s + l.amount, 0);
  return { item, method, buyerShipping, ownShipping, salePrice, tax, fees, payout: salePrice - totalFees };
}

function calculate(inputs: Inputs, market: Market) {
  const money = moneyFor(market);
  const r = compute(inputs, market);
  const notes: string[] = [];

  // The $120 cliff: just over the line you can keep less than at $119.99.
  if (r.salePrice >= TIER_EDGE) {
    const altItem = TIER_EDGE - 1 - r.ownShipping;
    if (altItem > 0) {
      const alt = compute({ ...inputs, price: altItem / 100 }, market);
      if (alt.salePrice < TIER_EDGE && alt.payout > r.payout) {
        notes.push(
          `The commission jumps from 6% to 9% at a $120 sale price${r.ownShipping ? " (item + the shipping you charge)" : ""}. An item price of ${money(altItem)} would leave you ${money(alt.payout)}, ${money(alt.payout - r.payout)} more than this.`,
        );
      }
    }
  }
  if (market.id === "ca" && buyerInUs(inputs) && r.item >= LABEL_LIMIT_CA) {
    notes.push("Grailed Labels from Canada only cover sales under $750, so you buy your own label and the shipping you charge counts toward the commission.");
  }
  if (buyerInUs(inputs) && !r.tax) notes.push("Processing is also charged on the sales tax a US buyer pays. Add their rate under “More options” for the exact figure.");
  if (market.id !== "us") notes.push("Every Grailed sale is in US dollars. If your payout account is in another currency, it is converted at the payment processor’s rate, which Grailed doesn’t publish.");

  const onLabel = r.method !== "own";
  const costs = costLines(inputs, market).filter((l) => !(onLabel && l.id === "shippingCost"));

  return assemble({
    market,
    buyerPays: r.item + r.buyerShipping + r.tax,
    saleAmount: r.salePrice,
    fees: r.fees,
    costs,
    notes: notes.slice(0, 3),
  });
}

function schedule(market: Market): ScheduleRow[] {
  const money = moneyFor(market);
  const rows: ScheduleRow[] = [
    {
      fee: "Seller commission",
      amount: "9%",
      appliesTo: "Sale price of $120 and above: the item price, plus the shipping you charge if you don’t use a Grailed Label; never tax",
      when: "Every sale, domestic or international",
      source: S.fees,
    },
    { fee: "Seller commission (reduced)", amount: `6%, minimum ${money(REDUCED_MIN)}`, appliesTo: "Sale price under $120 (same base)", when: "Sales on or after May 20, 2026", source: S.fees },
    {
      fee: "Payment processing (Stripe connected)",
      amount: `3.49% + ${money(49)} US / 4.99% + ${money(49)} intl`,
      appliesTo: "Everything the buyer pays: item, shipping and tax",
      when: "Every sale; US domestic vs international payment",
      source: S.processing,
    },
    {
      fee: "Payment processing (Stripe not connected)",
      amount: `3.49% + ${money(99)} US / 5.49% + ${money(99)} intl`,
      appliesTo: "Everything the buyer pays: item, shipping and tax",
      when: "Your country has Stripe but you haven’t onboarded",
      source: S.processing,
    },
  ];
  if (market.id === "other") {
    rows.push({ fee: "Payment processing (no Stripe in your country)", amount: `4.99% + ${money(49)}`, appliesTo: "Everything the buyer pays: item, shipping and tax", when: "Every sale", source: S.processing });
  }
  const vat = VAT[market.id];
  if (vat) {
    rows.push({
      fee: `${vat.name} on commission`,
      amount: vat.rate ? `${formatRate(vat.rate)} (standard rate)` : market.id === "eu" ? "Your country’s standard rate" : "NZ 15% GST / Norway 25% VAT",
      appliesTo: "The Grailed commission",
      when: market.id === "other" ? "Sellers in New Zealand or Norway with no GST/VAT number on Grailed" : "No VAT/GST number on your Grailed account",
      source: S.sellerTax,
    });
  }
  if (market.id === "us" || market.id === "ca") {
    rows.push({
      fee: "Grailed Label",
      amount: "Paid by the buyer",
      appliesTo: "Not part of the commission; processing is charged on it",
      when: market.id === "us" ? "Required on sales to US buyers" : "Sales to US buyers under $750 and 20 lb",
      source: market.id === "us" ? S.labels : S.labelsCa,
    });
    rows.push({ fee: "Free shipping (optional)", amount: "The label price", appliesTo: "Deducted from your payout", when: "If you offer free standard shipping", source: S.labels });
  }
  if (market.id === "us") {
    rows.push({ fee: "Signature confirmation", amount: money(SIGNATURE_FEE), appliesTo: "Added to the shipping; you pay it with free shipping", when: "Grailed Label sales over $750", source: S.labels });
  }
  rows.push({ fee: "Buyer fee", amount: "None", appliesTo: "—", when: "Grailed is free for buyers", source: S.fees });
  return rows;
}

const SHIPPING_DEFAULT: Record<string, number> = { us: 20, ca: 20, uk: 25, eu: 25, au: 30, other: 30 };

export const grailed: CalculatorDef = {
  slug: "grailed",
  name: "Grailed",
  path: "/grailed-fee-calculator",
  category: "marketplaces",
  priceNoun: "item price",
  sellerNoun: "seller",
  blurb: "6% (min $1.99) under $120 or 9% from $120, plus 3.49% + $0.49 processing (US)",
  markets: MARKETS,
  defaultMarket: "us",
  priceField: "price",
  fields: [
    { id: "price", kind: "money", label: "Item price or accepted offer", section: "sale", help: "What the buyer pays for the item, before shipping and tax." },
    {
      id: "buyer",
      kind: "segmented",
      label: "Where is the buyer?",
      section: "shipping",
      options: [
        { value: "us", label: "In the US" },
        { value: "intl", label: "Outside the US" },
      ],
      help: (_i, m) =>
        m.id === "us"
          ? "Processing is 3.49% on US domestic payments and 4.99% on international ones; Grailed Labels only ship to US buyers."
          : "Grailed charges 3.49% on “US domestic” and 4.99% on international payments without defining them; we use 3.49% when the buyer is in the US.",
    },
    {
      id: "shippingMethod",
      kind: "segmented",
      label: "How are you shipping?",
      section: "shipping",
      options: [
        { value: "label", label: "Grailed Label" },
        { value: "free", label: "Free shipping" },
        { value: "own", label: "My own label" },
      ],
      help: "The buyer pays the Grailed Label, and it isn’t part of the commission. Your own label (20 lb+ parcels) adds the shipping you charge to the sale price.",
      showIf: (i, m) => labelsAvailable(i, m),
    },
    {
      id: "labelCost",
      kind: "money",
      label: "Grailed Label price",
      section: "shipping",
      help: "Set at the sale from carrier rates. The buyer pays it, or it comes out of your payout if you offer free shipping.",
      showIf: (i, m) => shippingMethod(i, m) !== "own",
    },
    {
      id: "shippingCharged",
      kind: "money",
      label: "Shipping you charge the buyer",
      section: "shipping",
      help: "With your own label, Grailed counts this in the sale price: it takes commission on it and it counts toward the $120 line.",
      showIf: (i, m) => shippingMethod(i, m) === "own",
    },
    {
      id: "stripeOther",
      kind: "segmented",
      label: "Are you paid through Stripe?",
      section: "options",
      options: [
        { value: "connected", label: "Yes" },
        { value: "none", label: "Not set up" },
        { value: "unsupported", label: "No Stripe here" },
      ],
      help: "Where Stripe isn’t available, processing is 4.99% + $0.49 on every sale.",
      showIf: (_i, m) => m.id === "other",
    },
    {
      id: "vatOnFees",
      kind: "toggle",
      label: "Grailed adds VAT/GST to my commission",
      section: "options",
      help: "Yes unless you’ve added a VAT/GST registration number to your Grailed account.",
      showIf: (_i, m) => m.id === "uk" || m.id === "eu" || m.id === "au",
    },
    {
      id: "vatRate",
      kind: "percent",
      label: "Your country’s VAT rate",
      section: "options",
      max: 30,
      step: 0.1,
      help: "The standard rate: 19% Germany, 20% France, 21% Spain or the Netherlands, 22% Italy.",
      showIf: (i, m) => m.id === "eu" && bool(i, "vatOnFees"),
    },
    {
      id: "vatOther",
      kind: "percent",
      label: "VAT/GST Grailed adds to your commission",
      section: "options",
      advanced: true,
      max: 30,
      step: 0.1,
      help: "Only for sellers in New Zealand (15% GST) or Norway (25% VAT) with no registration number on Grailed. Leave at 0 elsewhere.",
      showIf: (_i, m) => m.id === "other",
    },
    {
      id: "salesTax",
      kind: "percent",
      label: "Tax the buyer pays at checkout",
      section: "sale",
      advanced: true,
      max: 30,
      help: "US sales tax, or the VAT/GST Grailed collects from some buyers abroad. It goes to the government, but processing is charged on it.",
    },
    {
      id: "stripe",
      kind: "segmented",
      label: "Is your Grailed account connected to Stripe?",
      section: "options",
      advanced: true,
      options: [
        { value: "connected", label: "Yes" },
        { value: "none", label: "No" },
      ],
      help: "Without Stripe, processing costs $0.99 instead of $0.49 per sale, and 5.49% instead of 4.99% on international payments.",
      showIf: (_i, m) => m.id !== "other",
    },
    { id: "itemCost", kind: "money", label: "What the item cost you", section: "costs", help: "What you paid for it, if you bought it to resell." },
    { id: "shippingCost", kind: "money", label: "Postage you pay", section: "costs", help: "Only with your own label.", showIf: (i, m) => shippingMethod(i, m) === "own" },
    { id: "otherCost", kind: "money", label: "Packaging & other", section: "costs" },
  ],
  defaults: (market) => ({
    price: 100,
    buyer: "us",
    shippingMethod: "label",
    labelCost: market.id === "ca" ? 15 : 10,
    shippingCharged: SHIPPING_DEFAULT[market.id] ?? 20,
    stripeOther: "connected",
    vatOnFees: market.id === "uk" || market.id === "eu" || market.id === "au",
    vatRate: market.id === "eu" ? 21 : 0,
    vatOther: 0,
    salesTax: 0,
    stripe: "connected",
    itemCost: 0,
    shippingCost: 0,
    otherCost: 0,
  }),
  calculate,
  breakpoints: (inputs, market) => {
    // Item prices where the formula changes shape: the $120 tier edge and the $1.99 minimum (both on the
    // sale price, so shifted by the shipping you charge on your own label), the Canada→US label limit
    // ($750: own label from there) and the US signature fee (over $750).
    const ship = toCents(num(inputs, "shippingCharged"));
    const minEdge = Math.ceil((REDUCED_MIN * 100) / REDUCED); // 3317
    const out = [TIER_EDGE, TIER_EDGE - ship, minEdge, minEdge - ship];
    if (market.id === "ca") out.push(LABEL_LIMIT_CA);
    if (market.id === "us") out.push(SIGNATURE_OVER + 1);
    return out.filter((b) => b > 0);
  },
  verifiedAt: "2026-10-23",
  sources,
  changes,
  schedule,
  compare: {
    group: "sell",
    // US-to-US sales must use a Grailed Label: the buyer's shipping pays for it; with $0 shipping the seller offers free shipping.
    map: (c) =>
      c.shipping > 0
        ? { price: c.price, shippingMethod: "label", labelCost: c.shipping, itemCost: c.itemCost }
        : { price: c.price, shippingMethod: "free", labelCost: c.shippingCost, itemCost: c.itemCost },
    note: "US seller and buyer, Grailed Label paid by the buyer (you pay it at $0 shipping), Stripe connected",
  },
};

export default grailed;
