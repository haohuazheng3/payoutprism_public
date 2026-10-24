/*
 * Facebook Marketplace (US) seller fees. Every number is from Meta's own pages (see `sources`),
 * re-read and verified 2026-10-23. Research notes with verbatim quotes:
 * research/fees/facebook-marketplace.md.
 *
 * How an order is settled (what this module reproduces):
 *  - Local pickup, or a buyer who pays the seller without shipping & checkout (cash, PayPal…):
 *    no Meta fee at all ("There is no selling fee for items that are picked up locally, or where the
 *    buyer pays the seller without using shipping and checkout").
 *  - Shipping & checkout: a selling fee of 10%, minimum $0.80 per order, on "the entire amount of
 *    the transaction (including the sale price(s) of good(s), any shipping fees and Applicable
 *    Taxes)". Goods shipped together are one transaction, so the minimum applies once per package.
 *    Official example: 10% × ($20 + $5 + $1) = $2.60.
 *  - Prepaid label, buyer pays: the shipping the buyer pays buys the label and never reaches the
 *    seller; sales tax goes to the state. Both are still in the 10% base.
 *  - Prepaid label, seller covers shipping: the label is deducted from the payout. Meta doesn't say
 *    whether a label the seller pays is in the fee base; we follow the legal definition (what the
 *    buyer pays in the transaction) and leave it out, and show the alternative in a note.
 *  - Own label: the buyer pays the shipping rate the seller set, which reaches the seller; the seller
 *    buys postage elsewhere (a cost, not a deduction).
 *  - Carrier adjustment for under-reported weight/size on Meta labels: deducted from the payout.
 * Meta doesn't document rounding; the fee is rounded half up to the cent (the official example is exact).
 *
 * Facebook and Instagram Shops checkout ended in September 2025 (website checkout only), so Shops
 * orders no longer carry a Meta selling fee; that's in `changes` and the schedule, not a mode.
 */
import { M } from "../markets";
import { assemble, costLines, formatPercentOf, moneyFor, num, pct, str, toCents } from "../money";
import type { CalculatorDef, FeeChange, Inputs, Line, Market, ScheduleRow, Source } from "../types";

/** Selling fee on shipping & checkout orders, % of item + shipping + sales tax. */
export const SELLING_RATE = 10;
/** Minimum selling fee per order (goods shipped together), cents. */
export const SELLING_MIN = 80;
/** Shipping & checkout listings must be priced $2 to $500, cents. */
const PRICE_MIN = 200;
const PRICE_MAX = 50000;

const S = {
  fee: "fb-selling-fee",
  payout: "fb-payout-timing",
  policy: "fb-seller-protection",
  shippingCosts: "fb-shipping-costs",
  prepaidRates: "fb-prepaid-rates",
  prepaid: "fb-prepaid-labels",
  sellShipping: "fb-sell-with-shipping",
  local: "fb-checkout-vs-local",
  paypal: "fb-paypal-payouts",
  taxId: "fb-tax-id",
  refunds: "fb-refunds",
  shops: "meta-shops-checkout-change",
} as const;

const sources: Source[] = [
  { id: S.fee, title: "Get paid for selling with shipping on Marketplace", url: "https://www.facebook.com/help/449101635835192/", publisher: "Facebook Help Center", checked: "2026-10-23" },
  {
    id: S.payout,
    title: "When you'll get paid for selling with shipping on Facebook Marketplace",
    url: "https://www.facebook.com/help/620680138523186/",
    publisher: "Facebook Help Center",
    checked: "2026-10-23",
  },
  { id: S.policy, title: "Facebook Marketplace Seller Protection Policy", url: "https://www.facebook.com/legal/merchant_policies", publisher: "Meta", checked: "2026-10-23" },
  { id: S.shippingCosts, title: "About shipping costs on Facebook Marketplace", url: "https://www.facebook.com/help/3487040438008467/", publisher: "Facebook Help Center", checked: "2026-10-23" },
  {
    id: S.prepaidRates,
    title: "About shipping rates and prepaid labels on Facebook Marketplace",
    url: "https://www.facebook.com/help/376859780413203/",
    publisher: "Facebook Help Center",
    checked: "2026-10-23",
  },
  { id: S.prepaid, title: "About prepaid shipping labels on Facebook Marketplace", url: "https://www.facebook.com/help/637559426797189/", publisher: "Facebook Help Center", checked: "2026-10-23" },
  { id: S.sellShipping, title: "Sell an item with shipping on Marketplace", url: "https://www.facebook.com/help/2292899320946832/", publisher: "Facebook Help Center", checked: "2026-10-23" },
  {
    id: S.local,
    title: "The difference between buying something with checkout and a local transaction on Facebook Marketplace",
    url: "https://www.facebook.com/help/329122794534612/",
    publisher: "Facebook Help Center",
    checked: "2026-10-23",
  },
  {
    id: S.paypal,
    title: "Use your PayPal account to get paid for selling with shipping on Facebook Marketplace",
    url: "https://www.facebook.com/help/295245868956340/",
    publisher: "Facebook Help Center",
    checked: "2026-10-23",
  },
  {
    id: S.taxId,
    title: "About providing your tax identification information when selling with shipping on Marketplace",
    url: "https://www.facebook.com/help/704722346920952/",
    publisher: "Facebook Help Center",
    checked: "2026-10-23",
  },
  {
    id: S.refunds,
    title: "Issue a refund for something you sold with shipping on Facebook Marketplace",
    url: "https://www.facebook.com/help/2304659639610167/",
    publisher: "Facebook Help Center",
    checked: "2026-10-23",
  },
  {
    id: S.shops,
    title: "About Changes to Shops and Checkout on Facebook and Instagram",
    url: "https://www.facebook.com/business/help/1314349509894768",
    publisher: "Meta Business Help Center",
    checked: "2026-10-23",
  },
];

const changes: FeeChange[] = [
  {
    date: "2025-09-01",
    text: "Checkout on Facebook and Instagram Shops ended in September 2025: Shops now send buyers to the seller’s own website to pay, and Meta stopped processing payments for Shops, so Shops orders no longer pay Meta a selling fee. Marketplace shipping & checkout (10%, $0.80 minimum) is unaffected.",
    source: S.shops,
  },
];

type Payer = "buyer" | "seller" | "own";

function payerOf(inputs: Inputs): Payer {
  const p = str(inputs, "shippingPayer", "buyer");
  return p === "seller" || p === "own" ? p : "buyer";
}

const isShipped = (inputs: Inputs) => str(inputs, "saleType", "shipped") !== "local";

/** The money side of a shipped order (cents). `unitCents` overrides the typed price (for the breakpoint search). */
function amounts(inputs: Inputs, unitCents?: number) {
  const qty = Math.max(1, Math.round(num(inputs, "quantity", 1)));
  const unit = unitCents ?? toCents(num(inputs, "price"));
  const items = unit * qty;
  const payer = payerOf(inputs);
  const shipping = toCents(num(inputs, "shipping"));
  const buyerShipping = payer === "seller" ? 0 : shipping;
  const exactTax = toCents(num(inputs, "taxAmount"));
  const taxRate = Math.min(30, Math.max(0, num(inputs, "salesTax")));
  const tax = exactTax > 0 ? exactTax : pct(items + buyerShipping, taxRate);
  const base = items + buyerShipping + tax;
  return { qty, unit, items, payer, shipping, buyerShipping, tax, taxRate, exactTax: exactTax > 0, base };
}

function sellingFee(base: number, items: number): number {
  if (items <= 0) return 0;
  return Math.max(pct(base, SELLING_RATE), SELLING_MIN);
}

function calculate(inputs: Inputs, market: Market) {
  const money = moneyFor(market);

  if (!isShipped(inputs)) {
    const price = toCents(num(inputs, "price"));
    return assemble({
      market,
      buyerPays: price,
      saleAmount: price,
      fees: [
        {
          id: "selling",
          label: "Selling fee",
          amount: 0,
          kind: "platform",
          detail: "Local pickup: no fee",
          explain:
            "Facebook charges nothing for local pickup, or when the buyer pays you directly without shipping and checkout (cash, PayPal and so on). These sales aren’t covered by Purchase Protection.",
          source: S.fee,
        },
      ],
      costs: costLines({ ...inputs, shippingCost: 0 }, market),
      notes: [
        "If the buyer pays you through PayPal, Venmo or another app, that app’s own fees may apply. Facebook doesn’t add any.",
        `Sold with shipping and checkout instead, Facebook would take 10% of the item, shipping and sales tax: at least ${money(sellingFee(price, price))} at this price.`,
      ],
    });
  }

  const a = amounts(inputs);
  const { items, payer, shipping, buyerShipping, tax, base } = a;
  const raw = pct(base, SELLING_RATE);
  const fee = sellingFee(base, items);
  const minApplies = items > 0 && raw < SELLING_MIN;

  const parts = [`${money(items)} item${a.qty > 1 ? "s" : ""}`];
  if (buyerShipping) parts.push(`${money(buyerShipping)} shipping`);
  if (tax) parts.push(`${money(tax)} tax`);
  const baseText = parts.length > 1 ? `${money(base)} (${parts.join(" + ")})` : money(base);

  const fees: Line[] = [];
  fees.push({
    id: "selling",
    label: "Selling fee",
    amount: fee,
    kind: "platform",
    detail: minApplies ? `10% × ${baseText} = ${money(raw)}, raised to the $0.80 minimum` : `10% × ${baseText}`,
    explain:
      payer === "seller"
        ? "Facebook takes 10% of what the buyer pays at checkout (the item and the sales tax here), with a $0.80 minimum per order. It covers payment processing, support and Purchase Protection."
        : `Facebook takes 10% of everything the buyer pays at checkout: the item, the shipping and the sales tax, with a $0.80 minimum per order.${buyerShipping + tax > 0 ? " That’s why it comes to more than 10% of your price." : ""} It covers payment processing, support and Purchase Protection.`,
    source: S.fee,
  });

  if (payer === "seller" && shipping > 0) {
    fees.push({
      id: "label",
      label: "Shipping label (you pay)",
      amount: shipping,
      kind: "shipping",
      detail: "Prepaid label, taken from your payout",
      explain:
        "You chose to cover shipping, so Facebook deducts the prepaid label from your payout. Labels are priced at commercial rates, by the buyer’s location and the weight you entered, and can’t be refunded.",
      source: S.shippingCosts,
    });
  }

  const adjustment = payer === "own" ? 0 : toCents(num(inputs, "adjustment"));
  if (adjustment > 0) {
    fees.push({
      id: "adjustment",
      label: "Carrier adjustment",
      amount: adjustment,
      kind: "shipping",
      detail: "Extra postage for the real weight or size",
      explain:
        "If the carrier finds the package heavier or bigger than you entered for a Facebook label, you may have to pay the difference. It comes out of your payout balance, or your payment method on file if the balance is short.",
      source: S.policy,
    });
  }

  const buyerFees: Line[] = [];
  if (payer === "buyer" && buyerShipping > 0) {
    buyerFees.push({
      id: "buyershipping",
      label: "Shipping (prepaid label)",
      amount: buyerShipping,
      kind: "shipping",
      detail: "Added at checkout",
      explain: "The buyer pays the label at checkout and Facebook uses it to pay the carrier. It never reaches you, but the 10% selling fee is charged on it.",
      source: S.prepaidRates,
    });
  }
  if (tax > 0) {
    buyerFees.push({
      id: "salestax",
      label: "Sales tax",
      amount: tax,
      kind: "tax",
      detail: a.exactTax ? "Amount you entered" : `${a.taxRate}% × ${money(items + buyerShipping)}`,
      explain: "Facebook collects sales tax at checkout and pays it to the state. You never receive it, but the 10% selling fee is charged on it.",
      source: S.fee,
    });
  }

  const saleAmount = payer === "own" ? items + shipping : items;
  const payout = saleAmount - fees.reduce((s, l) => s + l.amount, 0);

  const notes: string[] = [];
  if (payer === "own" && shipping > 0 && !toCents(num(inputs, "shippingCost"))) {
    notes.push(`Your payout includes the ${money(shipping)} shipping the buyer paid. Add what your postage costs under “Your costs” to see what you keep.`);
  }
  if (minApplies) {
    notes.push(`The $0.80 minimum applies: Facebook keeps ${formatPercentOf(fee, items)} of your item price. Below $8.00 in total (item, shipping and tax) every order pays $0.80.`);
  } else if (payer === "seller" && shipping > 0) {
    const withLabel = sellingFee(base + shipping, items);
    notes.push(
      `Meta doesn’t say whether the 10% also counts a label you pay for. We assume not, because the buyer doesn’t pay it; if it does, the fee is ${money(withLabel)} and you keep ${money(payout - (withLabel - fee))}.`,
    );
  } else {
    // Money the 10% is charged on that never reaches the seller: a prepaid label the buyer pays, and the sales tax.
    const passed = payer === "own" ? tax : buyerShipping + tax;
    const what = payer === "own" || !buyerShipping ? "the sales tax" : tax ? "the shipping and sales tax" : "the shipping";
    if (passed > 0) notes.push(`${money(pct(passed, SELLING_RATE))} of this fee is 10% of ${what}, money that passes through Facebook and never reaches you.`);
  }
  if (!a.exactTax && a.taxRate === 0) notes.push("Facebook also takes 10% of the sales tax the buyer pays. Add the buyer’s tax rate for the exact fee.");
  notes.push("Facebook sends your payout 15 days after you mark the item shipped, or 5 days after delivery is confirmed; it can take up to 5 more days to reach your bank (PayPal: 4 days after delivery).");

  const warnings: string[] = [];
  if (a.unit > 0 && (a.unit < PRICE_MIN || a.unit > PRICE_MAX)) warnings.push("Facebook only allows shipping and checkout for items priced $2 to $500. Outside that range you can sell for local pickup only.");

  return assemble({
    market,
    buyerPays: items + buyerShipping + tax,
    saleAmount,
    fees,
    buyerFees,
    costs: costLines({ ...inputs, shippingCost: payer === "own" ? inputs.shippingCost : 0 }, market),
    notes: notes.slice(0, 3),
    warnings,
  });
}

function schedule(market: Market): ScheduleRow[] {
  void market;
  return [
    {
      fee: "Selling fee",
      amount: "10%, min $0.80 per order",
      appliesTo: "Everything the buyer pays: item + shipping + sales tax",
      when: "Orders with shipping and checkout",
      source: S.fee,
    },
    { fee: "Local pickup or paid directly", amount: "$0", appliesTo: "—", when: "Local pickup, or the buyer pays you outside checkout (cash, PayPal…)", source: S.fee },
    { fee: "Listing fee", amount: "$0", appliesTo: "—", when: "Every listing; nothing to pay if it doesn’t sell", source: S.fee },
    {
      fee: "Prepaid shipping label",
      amount: "Label price (commercial rates)",
      appliesTo: "Paid by the buyer, or taken from your payout if you cover shipping",
      when: "UPS or USPS prepaid labels",
      source: S.shippingCosts,
    },
    { fee: "Carrier adjustment", amount: "The difference the carrier charges", appliesTo: "Taken from your payout", when: "Package heavier or bigger than you entered", source: S.policy },
    {
      fee: "Chargeback fee",
      amount: "$20 per chargeback",
      appliesTo: "Held with the order amount from your balance or payment method on file",
      when: "A buyer files a chargeback (both returned if decided in your favor)",
      source: S.policy,
    },
    { fee: "Facebook & Instagram Shops checkout", amount: "Discontinued", appliesTo: "Shops now use your own website’s checkout", when: "Since September 2025", source: S.shops },
  ];
}

const shipped = (i: Inputs) => isShipped(i);
const prepaid = (i: Inputs) => isShipped(i) && payerOf(i) !== "own";

export const facebookMarketplace: CalculatorDef = {
  slug: "facebook-marketplace",
  name: "Facebook Marketplace",
  path: "/facebook-marketplace-fee-calculator",
  category: "marketplaces",
  priceNoun: "item price",
  sellerNoun: "seller",
  blurb: "10% of item + shipping + tax, min $0.80 (shipped); local pickup free",
  markets: [M.us],
  defaultMarket: "us",
  priceField: "price",
  fields: [
    { id: "price", kind: "money", label: "Item price", section: "sale", help: "What the buyer pays for the item. Shipped listings must be $2 to $500." },
    {
      id: "saleType",
      kind: "segmented",
      label: "How does the buyer get it?",
      section: "sale",
      options: [
        { value: "shipped", label: "Shipped (checkout)" },
        { value: "local", label: "Local pickup" },
      ],
      help: "Local pickup, cash or PayPal sales outside checkout have no Facebook fee.",
    },
    {
      id: "salesTax",
      kind: "percent",
      label: "Buyer’s sales tax rate",
      section: "sale",
      max: 30,
      step: 0.25,
      advanced: true,
      help: "Facebook collects it for the state and takes 10% of it too. Use 0 if the buyer’s state has none.",
      showIf: shipped,
    },
    {
      id: "taxAmount",
      kind: "money",
      label: "Exact sales tax on the order",
      section: "sale",
      advanced: true,
      help: "From the order details. Replaces the rate above.",
      showIf: shipped,
    },
    {
      id: "quantity",
      kind: "number",
      label: "Items shipped together",
      section: "sale",
      integer: true,
      min: 1,
      max: 99,
      advanced: true,
      help: "The item price above is per item. One package is one order, so the $0.80 minimum applies once.",
      showIf: shipped,
    },
    {
      id: "shippingPayer",
      kind: "segmented",
      label: "Who pays for shipping?",
      section: "shipping",
      options: [
        { value: "buyer", label: "Buyer" },
        { value: "seller", label: "Me (free)" },
        { value: "own", label: "Own label" },
      ],
      help: "Buyer and Me use Facebook’s prepaid label, which it offers to select sellers. With your own label you charge the buyer and buy postage yourself.",
      showIf: shipped,
    },
    {
      id: "shipping",
      kind: "money",
      label: "Shipping cost",
      section: "shipping",
      help: "The prepaid label price Facebook shows, or the rate you charge with your own label. Buyer-paid shipping is in the 10%.",
      showIf: shipped,
    },
    {
      id: "adjustment",
      kind: "money",
      label: "Carrier weight adjustment",
      section: "shipping",
      advanced: true,
      help: "Extra postage if the package was heavier or bigger than you entered.",
      showIf: prepaid,
    },
    { id: "itemCost", kind: "money", label: "What the item cost you", section: "costs" },
    {
      id: "shippingCost",
      kind: "money",
      label: "Postage you buy",
      section: "costs",
      help: "What your own label costs you.",
      showIf: (i) => isShipped(i) && payerOf(i) === "own",
    },
    { id: "otherCost", kind: "money", label: "Packaging & other", section: "costs" },
  ],
  defaults: () => ({
    price: 25,
    saleType: "shipped",
    salesTax: 7,
    taxAmount: 0,
    quantity: 1,
    shippingPayer: "buyer",
    shipping: 8,
    adjustment: 0,
    itemCost: 0,
    shippingCost: 0,
    otherCost: 0,
  }),
  calculate,
  breakpoints: (inputs) => {
    // Where 10% of the order total reaches the $0.80 minimum (the fee turns from flat to a percentage).
    if (!isShipped(inputs)) return [];
    const reaches = (unit: number) => (amounts(inputs, unit).base * SELLING_RATE) / 100 >= SELLING_MIN;
    if (reaches(1)) return [];
    let lo = 1;
    let hi = 1000; // $10.00 per item always gets the order total to $8.00
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (reaches(mid)) hi = mid;
      else lo = mid + 1;
    }
    return [lo];
  },
  verifiedAt: "2026-10-23",
  sources,
  changes,
  schedule,
  compare: {
    group: "sell",
    map: (c) =>
      c.shipping > 0
        ? { price: c.price, saleType: "shipped", shippingPayer: "buyer", shipping: c.shipping, salesTax: 0, itemCost: c.itemCost }
        : { price: c.price, saleType: "shipped", shippingPayer: "seller", shipping: c.shippingCost, salesTax: 0, itemCost: c.itemCost },
    note: "Shipped with checkout; the buyer’s shipping pays the prepaid label (you pay it when shipping is $0); before sales tax",
  },
};

export default facebookMarketplace;
