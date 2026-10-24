/*
 * GOAT seller fees (also what alias, GOAT Group's seller app, charges). Every number is from GOAT
 * Group's own pages (see `sources`), re-read 2026-10-23. Research notes with verbatim quotes:
 * research/fees/goat.md.
 *
 * Selling on GOAT is in US dollars only ("Selling is only available in USD at this time"), wherever
 * the seller lives, so the calculator has one USD market and asks where the seller account is
 * based instead. What one sale costs, per item (every GOAT order is one item with its own label):
 *  - Commission: a % of the listing price (or the accepted offer), by seller rating at the time of
 *    sale: 9.5 / 15 / 20 / 25 %, or 12.4 / 17.9 / 22.9 / 27.9 % for Canadian sellers.
 *  - Seller fee: a flat amount per item from the Fee Policy table, by the country on the account
 *    and, in some countries, how the item reaches GOAT (drop-off vs prepaid label). Consigned items
 *    pay the "prepaid shipping and consignment" amount (alias Fee Policy), except Mainland China and
 *    Hong Kong, where consignment pays the drop-off amount.
 *  - Cash-out fee: 2.9% "applied to the selling price of each item" (alias Fee Policy / FAQ), taken
 *    from the Cash Out Balance when the item sells. Not charged to Canadian sellers, and not charged
 *    on the Spend Balance if the seller spends it on GOAT instead. "Certain sellers in select
 *    locations" pay 3.1% (GOAT doesn't list them).
 *  - Cross-border fee: 0.6% "applied at cash out" for sellers outside the US who choose USD where
 *    local-currency cash-out is offered. GOAT doesn't name the base; we apply it to the amount being
 *    cashed out (the Cash Out Balance from this sale) and say so on the line. It "does not apply" where
 *    local-currency cash-out isn't offered: Mainland China sellers cash out to a US bank account or
 *    PayPal ("Cash Outs for China Sellers"), so the question isn't asked there.
 * GOAT doesn't publish a rounding rule; each line is rounded to the cent, half away from zero.
 */
import { M } from "../markets";
import { assemble, costLines, formatRate, moneyFor, num, pct, str, toCents } from "../money";
import type { CalculatorDef, FeeChange, Inputs, Line, Market, ScheduleRow, SelectOption, Source } from "../types";

const MARKETS: Market[] = [M.us];

/* ---------------- seller location → seller fee (USD cents) ---------------- */

type Method = "prepaid" | "dropoff" | "consign";

interface Location {
  id: string;
  label: string;
  group: string;
  /** Single seller fee for every method. */
  fee?: number;
  /** Where the Fee Policy lists separate drop-off and prepaid-shipping amounts. */
  dropoff?: number;
  prepaid?: number;
  /** Consignment amount where it differs from prepaid (alias Fee Policy: Mainland China, Hong Kong). */
  consign?: number;
  /** US states, territories and military addresses: cash out in USD, no cross-border fee. */
  domestic?: boolean;
  /** Source of the drop-off amount when GOAT's Fee Policy itself doesn't list it. */
  dropoffSource?: string;
  /** No local-currency cash-out offered (US bank account or PayPal only), so no cross-border fee. */
  usdOnly?: boolean;
  /** One extra sentence for the seller-fee line. */
  extra?: string;
}

const US_GROUP = "United States & territories";

/** GOAT Fee Policy, "What is my seller fee?" (Last Updated: August 1, 2026). Cents. */
const LOCATIONS: Location[] = [
  { id: "us", label: "United States", group: US_GROUP, dropoff: 0, prepaid: 500, domestic: true },
  { id: "pr", label: "Puerto Rico", group: US_GROUP, fee: 800, domestic: true },
  { id: "gu", label: "Guam", group: US_GROUP, fee: 2500, domestic: true },
  { id: "vi", label: "U.S. Virgin Islands", group: US_GROUP, fee: 1500, domestic: true },
  { id: "mp", label: "Mariana Islands", group: US_GROUP, fee: 1500, domestic: true },
  { id: "as", label: "American Samoa", group: US_GROUP, fee: 3500, domestic: true },
  { id: "apo-us", label: "APO/FPO United States", group: US_GROUP, fee: 2500, domestic: true },
  { id: "apo-eu", label: "APO/FPO Europe", group: US_GROUP, fee: 2500, domestic: true },
  { id: "apo-pac", label: "APO/FPO Pacific", group: US_GROUP, fee: 2500, domestic: true },
  { id: "ca", label: "Canada", group: "Americas", dropoff: 0, prepaid: 500 },
  { id: "mx", label: "Mexico", group: "Americas", fee: 500 },
  { id: "uk", label: "United Kingdom", group: "Europe", dropoff: 200, prepaid: 500 },
  { id: "de", label: "Germany", group: "Europe", dropoff: 200, prepaid: 500 },
  { id: "nl", label: "Netherlands", group: "Europe", dropoff: 300, prepaid: 600 },
  { id: "at", label: "Austria", group: "Europe", fee: 600 },
  { id: "be", label: "Belgium", group: "Europe", fee: 600 },
  { id: "bg", label: "Bulgaria", group: "Europe", fee: 1200 },
  { id: "hr", label: "Croatia", group: "Europe", fee: 1200 },
  { id: "cy", label: "Cyprus", group: "Europe", fee: 2400 },
  { id: "cz", label: "Czech Republic", group: "Europe", fee: 600 },
  { id: "dk", label: "Denmark", group: "Europe", fee: 1000 },
  { id: "ee", label: "Estonia", group: "Europe", fee: 1200 },
  { id: "fi", label: "Finland", group: "Europe", fee: 1000 },
  { id: "fr", label: "France", group: "Europe", fee: 600 },
  { id: "gr", label: "Greece", group: "Europe", fee: 1200 },
  { id: "hu", label: "Hungary", group: "Europe", fee: 1200 },
  { id: "ie", label: "Ireland", group: "Europe", fee: 1200 },
  { id: "it", label: "Italy", group: "Europe", fee: 800 },
  { id: "lv", label: "Latvia", group: "Europe", fee: 1200 },
  { id: "lt", label: "Lithuania", group: "Europe", fee: 1200 },
  { id: "lu", label: "Luxembourg", group: "Europe", fee: 1000 },
  { id: "mt", label: "Malta", group: "Europe", fee: 2400 },
  { id: "pl", label: "Poland", group: "Europe", fee: 600 },
  { id: "pt", label: "Portugal", group: "Europe", fee: 1200 },
  { id: "ro", label: "Romania", group: "Europe", fee: 1200 },
  { id: "sk", label: "Slovakia", group: "Europe", fee: 600 },
  { id: "si", label: "Slovenia", group: "Europe", fee: 1200 },
  { id: "es", label: "Spain", group: "Europe", fee: 800 },
  { id: "se", label: "Sweden", group: "Europe", fee: 1000 },
  {
    id: "cn",
    label: "Mainland China",
    group: "Asia-Pacific",
    dropoff: 500,
    prepaid: 1000,
    consign: 500,
    usdOnly: true,
    extra: "Sellers in Mainland China get the item to GOAT’s Shenzhen location themselves and pay any courier cost.",
  },
  { id: "hk", label: "Hong Kong", group: "Asia-Pacific", dropoff: 500, prepaid: 1000, consign: 500 },
  { id: "jp", label: "Japan", group: "Asia-Pacific", dropoff: 500, prepaid: 1000 },
  { id: "my", label: "Malaysia", group: "Asia-Pacific", dropoff: 800, prepaid: 1000 },
  // GOAT's Fee Policy lists only "Philippines: $10"; GOAT's help center and alias's Fee Policy add a $8 drop-off rate.
  { id: "ph", label: "Philippines", group: "Asia-Pacific", dropoff: 800, prepaid: 1000, dropoffSource: "goat-seller-fee" },
  { id: "au", label: "Australia", group: "Asia-Pacific", fee: 800 },
  { id: "id", label: "Indonesia", group: "Asia-Pacific", fee: 1000 },
  { id: "sg", label: "Singapore", group: "Asia-Pacific", fee: 500 },
  { id: "kr", label: "South Korea", group: "Asia-Pacific", fee: 500 },
  { id: "tw", label: "Taiwan", group: "Asia-Pacific", fee: 500 },
  { id: "th", label: "Thailand", group: "Asia-Pacific", fee: 1000 },
  { id: "other", label: "Anywhere else", group: "Other", fee: 3000 },
];

const BY_ID = new Map(LOCATIONS.map((l) => [l.id, l]));

function location(inputs: Inputs): Location {
  return BY_ID.get(str(inputs, "location", "us")) ?? BY_ID.get("us")!;
}

const hasMethods = (l: Location) => l.fee === undefined;

function methodOf(inputs: Inputs, loc: Location): Method {
  if (!hasMethods(loc)) return "prepaid";
  const m = str(inputs, "method", "prepaid");
  return m === "dropoff" || m === "consign" ? m : "prepaid";
}

function sellerFee(loc: Location, method: Method): number {
  if (loc.fee !== undefined) return loc.fee;
  if (method === "dropoff") return loc.dropoff!;
  if (method === "consign") return loc.consign ?? loc.prepaid!;
  return loc.prepaid!;
}

/* ---------------- commission by seller rating ---------------- */

interface Tier {
  id: string;
  label: string;
  /** For sentences: "a seller rating of 70–89". */
  short: string;
  rate: number;
  canada: number;
}

/** GOAT Fee Policy, "Commission fees". */
const TIERS: Tier[] = [
  { id: "90", label: "90 or higher (where every seller starts)", short: "90 or higher", rate: 9.5, canada: 12.4 },
  { id: "70", label: "70–89", short: "70–89", rate: 15, canada: 17.9 },
  { id: "50", label: "50–69", short: "50–69", rate: 20, canada: 22.9 },
  { id: "0", label: "Below 50", short: "below 50", rate: 25, canada: 27.9 },
];

function tierOf(inputs: Inputs): Tier {
  return TIERS.find((t) => t.id === str(inputs, "rating", "90")) ?? TIERS[0];
}

const CASH_OUT_RATE = 2.9;
const CASH_OUT_RATE_SOME = 3.1;
const CROSS_BORDER_RATE = 0.6;

/* ---------------- sources & changes ---------------- */

const S = {
  fees: "goat-fees",
  selling: "goat-selling",
  sellerFee: "goat-seller-fee",
  commission: "goat-commission",
  cashout: "goat-cashout",
  china: "goat-cashout-china",
  earnings: "goat-earnings",
  charges: "goat-charges",
  fx: "goat-fx",
  shipping: "goat-shipping",
  aliasFees: "alias-fees",
  aliasFaq: "alias-faq",
  aliasSelling: "alias-selling",
} as const;

const sources: Source[] = [
  { id: S.fees, title: "Fee Policy", url: "https://www.goat.com/legal/fees", publisher: "GOAT", checked: "2026-10-23" },
  { id: S.selling, title: "Selling with GOAT", url: "https://www.goat.com/legal/selling", publisher: "GOAT", checked: "2026-10-23" },
  {
    id: S.sellerFee,
    title: "What is my Seller Fee?",
    url: "https://support.goat.com/hc/en-us/articles/360003037832-What-is-my-Seller-Fee",
    publisher: "GOAT Support",
    checked: "2026-10-23",
    watch: "https://support.goat.com/api/v2/help_center/en-us/articles/360003037832.json",
  },
  {
    id: S.commission,
    title: "Why is my commission higher than 9.5%?",
    url: "https://support.goat.com/hc/en-us/articles/115004610507-Why-is-my-commission-higher-than-9-5",
    publisher: "GOAT Support",
    checked: "2026-10-23",
    watch: "https://support.goat.com/api/v2/help_center/en-us/articles/115004610507.json",
  },
  {
    id: S.cashout,
    title: "How do I cash out?",
    url: "https://support.goat.com/hc/en-us/articles/115004771068-How-do-I-cash-out",
    publisher: "GOAT Support",
    checked: "2026-10-23",
    watch: "https://support.goat.com/api/v2/help_center/en-us/articles/115004771068.json",
  },
  {
    id: S.china,
    title: "Cash Outs for China Sellers",
    url: "https://support.goat.com/hc/en-us/articles/360047144932-Cash-Outs-for-China-Sellers",
    publisher: "GOAT Support",
    checked: "2026-10-23",
    watch: "https://support.goat.com/api/v2/help_center/en-us/articles/360047144932.json",
  },
  {
    id: S.earnings,
    title: "Why did my earnings amount change?",
    url: "https://support.goat.com/hc/en-us/articles/360015785112--Why-did-my-earnings-amount-change",
    publisher: "GOAT Support",
    checked: "2026-10-23",
    watch: "https://support.goat.com/api/v2/help_center/en-us/articles/360015785112.json",
  },
  {
    id: S.charges,
    title: "Will I be charged for anything as a seller?",
    url: "https://support.goat.com/hc/en-us/articles/46582726274061-Will-I-be-charged-for-anything-as-a-seller",
    publisher: "GOAT Support",
    checked: "2026-10-23",
    watch: "https://support.goat.com/api/v2/help_center/en-us/articles/46582726274061.json",
  },
  {
    id: S.fx,
    title: "Do you calculate foreign currency exchange rates?",
    url: "https://support.goat.com/hc/en-us/articles/360023739891-Do-you-calculate-foreign-currency-exchange-rates",
    publisher: "GOAT Support",
    checked: "2026-10-23",
    watch: "https://support.goat.com/api/v2/help_center/en-us/articles/360023739891.json",
  },
  {
    id: S.shipping,
    title: "How much does shipping cost?",
    url: "https://support.goat.com/hc/en-us/articles/115004770608-How-much-does-shipping-cost",
    publisher: "GOAT Support",
    checked: "2026-10-23",
    watch: "https://support.goat.com/api/v2/help_center/en-us/articles/115004770608.json",
  },
  {
    id: S.aliasFees,
    title: "Fee Policy",
    url: "https://www.alias.org/fees",
    publisher: "alias (GOAT Group)",
    checked: "2026-10-23",
    watch: "https://supportalias.zendesk.com/api/v2/help_center/en-us/articles/15461553616013.json",
  },
  {
    id: S.aliasFaq,
    title: "FAQ",
    url: "https://www.alias.org/faq",
    publisher: "alias (GOAT Group)",
    checked: "2026-10-23",
    watch: "https://supportalias.zendesk.com/api/v2/help_center/en-us/articles/15461983079053.json",
  },
  {
    id: S.aliasSelling,
    title: "Seller Policy",
    url: "https://www.alias.org/selling",
    publisher: "alias (GOAT Group)",
    checked: "2026-10-23",
    watch: "https://supportalias.zendesk.com/api/v2/help_center/en-us/articles/15461764903565.json",
  },
];

const changes: FeeChange[] = [
  {
    date: "2026-08-01",
    text: "New $1-a-month Maintenance Fee on seller accounts with no activity for two years, for return addresses in 33 states and Washington, D.C. It is never charged on a zero balance (announced June 12, 2026).",
    source: S.fees,
  },
  {
    date: "2026-03-06",
    text: "The fee for shipping or dropping off an item from a different country than the one on your account dropped from $30 to $10. The $10 now also applies to items dropped off at the wrong drop-off location.",
    source: S.selling,
  },
  {
    date: "2025-12-10",
    text: "Canadian sellers stopped paying the 2.9% cash-out fee, and sellers outside the US can cash out to a bank account in their local currency (before: US dollars to PayPal).",
    source: S.selling,
  },
  {
    date: "2025-08-22",
    text: "Separate commission rates for Canadian sellers: 12.4%, 17.9%, 22.9% and 27.9% by seller rating, against 9.5%, 15%, 20% and 25% for everyone else.",
    source: S.fees,
  },
  {
    date: "2025-06-27",
    text: "A $15 processing fee may apply if you choose to consign an item GOAT rejected for not matching your listing, instead of having it sent back.",
    source: S.selling,
  },
  {
    date: "2024-12-13",
    text: "alias spelled out that the 2.9% cash-out fee applies to the selling price of each item, and added a 0.6% Cross-Border Fee for sellers outside the US who cash out in US dollars instead of their local currency.",
    source: S.aliasSelling,
  },
  {
    date: "2024-09-03",
    text: "Cheaper drop-off seller fees in four more countries: Germany and the UK $5 → $2, the Netherlands $6 → $3, Malaysia $10 → $8. The prepaid-label rates stayed the same.",
    source: S.sellerFee,
  },
  {
    date: "2024-06-03",
    text: "Selling with GOAT added a $10 charge for cancelling a confirmed order or shipping it late, $10 for an item issue the buyer won’t accept at a discount or an item that doesn’t match the listing, $15 for a replica, and a $2 monthly storage fee on some consigned items. It also cut the cash-out minimum from $25 to $10 and added a 3.1% cash-out fee (instead of 2.9%) for certain sellers in select locations.",
    source: S.selling,
  },
  {
    date: "2024-05-10",
    text: "Mainland China seller fees cut: drop-off $10 → $5, prepaid shipping $15 → $10. Mexico added at $5.",
    source: S.fees,
  },
  {
    date: "2024-02-28",
    text: "A $0 seller fee for US and Canadian sellers who drop off a confirmed order at a GOAT drop-off location. With the prepaid label it stayed $5.",
    source: S.sellerFee,
  },
  {
    date: "2024-02-20",
    text: "Seller fees cut: Mainland China $25 → $15 with a prepaid label or $10 at drop-off, Italy and Spain $12 → $8, Poland $12 → $6.",
    source: S.fees,
  },
];

/* ---------------- calculation ---------------- */

const isCanada = (l: Location) => l.id === "ca";
/** Fields about cashing out only matter when there is a cash-out fee to avoid (everyone except Canada). */
const cashesOut = (inputs: Inputs, l: Location) => isCanada(l) || str(inputs, "cashOut", "cash") !== "spend";
/** Sellers who can choose between local currency and US dollars at cash out (and so may owe the 0.6%). */
const currencyChoice = (l: Location) => !l.domestic && !l.usdOnly;

const METHOD_WORDS: Record<Method, string> = { prepaid: "prepaid label", dropoff: "drop-off", consign: "consignment" };

function calculate(inputs: Inputs, market: Market) {
  const money = moneyFor(market);
  /** Flat fees read better as "$0" / "$5" than "$0.00". */
  const flat = (c: number) => (c % 100 === 0 ? `$${c / 100}` : money(c));
  const price = toCents(num(inputs, "price"));
  const loc = location(inputs);
  const method = methodOf(inputs, loc);
  const tier = tierOf(inputs);
  const canada = isCanada(loc);
  const rate = canada ? tier.canada : tier.rate;

  const fees: Line[] = [];
  const commission = pct(price, rate);
  fees.push({
    id: "commission",
    label: `Commission (${formatRate(rate)})`,
    amount: commission,
    kind: "platform",
    detail: `${formatRate(rate)} × ${money(price)}`,
    explain: canada
      ? `Canadian sellers pay ${formatRate(rate)} of the listing price (or the offer you accept) at a seller rating of ${tier.short}, charged only when the item sells. It is 2.9 points above the rate for other sellers, and Canadian sellers pay no cash-out fee.`
      : `${formatRate(rate)} of the listing price (or the offer you accept), charged only when the item sells. The rate depends on your seller rating when it sells: 9.5% at 90 or higher, rising to 15%, 20% and 25% as cancellations pull the rating down.`,
    source: S.fees,
  });

  const fee = sellerFee(loc, method);
  const methodText = hasMethods(loc) ? `${loc.label}, ${METHOD_WORDS[method]}` : loc.label;
  fees.push({
    id: "seller-fee",
    label: "Seller fee",
    amount: fee,
    kind: "platform",
    detail: methodText,
    explain:
      loc.id === "other"
        ? "A flat fee per item set by the country on your seller account. Countries GOAT doesn’t list pay $30. GOAT sends the shipping label; there is no separate charge for it."
        : hasMethods(loc)
          ? `A flat fee per item set by the country on your seller account and how the item reaches GOAT: ${flat(loc.dropoff!)} when you drop off a confirmed order at a GOAT drop-off location, ${flat(loc.prepaid!)} with GOAT’s prepaid shipping label${loc.consign !== undefined ? `, ${flat(loc.consign)} for consignment` : `. Consigned items pay the ${flat(loc.prepaid!)} rate, not the drop-off rate`}. ${loc.extra ?? "There is no separate charge for the label."}`
          : `A flat fee per item set by the country on your seller account: ${flat(fee)} in ${loc.label}. GOAT sends the shipping label; there is no separate charge for it.`,
    source: method === "consign" ? S.aliasFees : method === "dropoff" && loc.dropoffSource ? loc.dropoffSource : S.fees,
  });

  const earnings = price - commission - fee; // the Spend Balance

  const spend = !canada && !cashesOut(inputs, loc);
  const someRate = !loc.domestic && !canada && str(inputs, "cashOutRate", "2.9") === "3.1";
  const coRate = someRate ? CASH_OUT_RATE_SOME : CASH_OUT_RATE;
  let cashOutFee = 0;
  if (canada) {
    fees.push({
      id: "cash-out",
      label: "Cash-out fee",
      amount: 0,
      kind: "payout",
      detail: "Not charged in Canada",
      explain: "Canadian sellers don’t pay GOAT’s 2.9% cash-out fee and see a single balance they can cash out or spend. The higher commission makes up the difference.",
      source: S.selling,
    });
  } else if (spend) {
    fees.push({
      id: "cash-out",
      label: "Cash-out fee",
      amount: 0,
      kind: "payout",
      detail: "Not charged on the Spend Balance",
      explain: `If you spend your Spend Balance on GOAT instead of cashing out, the ${formatRate(coRate)} cash-out fee isn’t charged. The money can only be used to buy on GOAT.`,
      source: S.aliasFaq,
    });
  } else {
    cashOutFee = pct(price, coRate);
    fees.push({
      id: "cash-out",
      label: `Cash-out fee (${formatRate(coRate)})`,
      amount: cashOutFee,
      kind: "payout",
      detail: `${formatRate(coRate)} × ${money(price)}`,
      explain: `${formatRate(coRate)} of the item’s selling price, not of what’s left after fees. GOAT takes it from your Cash Out Balance as soon as the item sells, and charges it when the money goes to your bank or PayPal.${someRate ? " GOAT says certain sellers in select locations pay 3.1% instead of 2.9%, depending on cash-out method and currency." : ""}`,
      source: S.aliasFees,
    });
  }

  const usd = currencyChoice(loc) && !spend && str(inputs, "cashOutCurrency", "local") === "usd";
  if (usd) {
    const base = earnings - cashOutFee;
    fees.push({
      id: "cross-border",
      label: `Cross-border fee (${formatRate(CROSS_BORDER_RATE)})`,
      amount: pct(Math.max(0, base), CROSS_BORDER_RATE),
      kind: "payout",
      detail: `${formatRate(CROSS_BORDER_RATE)} × ${money(Math.max(0, base))}`,
      explain:
        "Charged at cash out when a seller outside the US picks US dollars where local currency is offered. GOAT doesn’t say what the 0.6% is taken from; we apply it to the amount this sale adds to your cash-out.",
      source: S.aliasFees,
    });
  }

  const notes: string[] = [];
  if (hasMethods(loc) && method === "prepaid" && loc.dropoff! < fee) {
    notes.push(`Dropping off a confirmed order at a GOAT drop-off location costs ${flat(loc.dropoff!)} instead of ${flat(fee)}, if there is one near you.`);
  }
  if (hasMethods(loc) && method === "consign" && loc.dropoff! < fee) {
    notes.push(`Consigned items pay ${flat(fee)} even when you drop them off: the ${flat(loc.dropoff!)} drop-off rate is only for confirmed orders you drop off after a sale.`);
  }
  if (!canada && !spend) {
    notes.push(`Spending the money on GOAT instead of cashing out skips the cash-out fee: ${money(cashOutFee)} more on this sale, as GOAT credit only.`);
  }
  if (tier.id !== "90") notes.push("Every completed sale adds 2 points to your seller rating; at 90 the commission is back to its lowest rate.");
  if (currencyChoice(loc) && !usd && !spend) {
    notes.push("Cashing out in your local currency avoids the 0.6% cross-border fee, but GOAT’s exchange rate includes a conversion fee it doesn’t publish.");
  }

  return assemble({
    market,
    buyerPays: price,
    saleAmount: price,
    fees,
    costs: costLines(inputs, market),
    notes: notes.slice(0, 3),
  });
}

/* ---------------- schedule ---------------- */

function schedule(market: Market): ScheduleRow[] {
  void market;
  return [
    { fee: "Commission, seller rating 90+", amount: "9.5% (Canada 12.4%)", appliesTo: "Listing price or accepted offer", when: "When the item sells; every seller starts at 90", source: S.fees },
    { fee: "Commission, rating 70–89", amount: "15% (Canada 17.9%)", appliesTo: "Listing price or accepted offer", when: "After cancellations (−10 points each)", source: S.fees },
    { fee: "Commission, rating 50–69", amount: "20% (Canada 22.9%)", appliesTo: "Listing price or accepted offer", when: "After cancellations", source: S.fees },
    { fee: "Commission, rating below 50", amount: "25% (Canada 27.9%)", appliesTo: "Listing price or accepted offer", when: "Account may be reviewed or suspended", source: S.fees },
    { fee: "Seller fee, United States", amount: "$0 drop-off / $5 prepaid label", appliesTo: "Each item sold", when: "Drop-off rate only for confirmed orders dropped off at GOAT; consigned items pay $5", source: S.fees },
    { fee: "Seller fee, elsewhere", amount: "$0–$35 by country (unlisted: $30)", appliesTo: "Each item sold", when: "By the address on your seller account", source: S.fees },
    { fee: "Cash-out fee", amount: "2.9% (3.1% for some sellers)", appliesTo: "Selling price of each item", when: "Cashing out to a bank or PayPal; not in Canada; not on balance spent on GOAT", source: S.aliasFees },
    { fee: "Cross-border fee", amount: "0.6%", appliesTo: "The cash-out (base not stated)", when: "Sellers outside the US who cash out in USD instead of local currency", source: S.aliasFees },
    { fee: "Cancellation", amount: "$10", appliesTo: "Each order", when: "Cancelled after confirming, or not shipped within 3 business days", source: S.selling },
    { fee: "Item issue", amount: "$10", appliesTo: "Each item", when: "Buyer rejects the discount after an issue is found, or item doesn’t match the listing", source: S.selling },
    { fee: "Replica", amount: "$15", appliesTo: "Each item", when: "GOAT deems the item a replica", source: S.selling },
    { fee: "Wrong country or drop-off point", amount: "$10", appliesTo: "Each item", when: "Shipped or dropped off outside your account’s country, or at the wrong drop-off location", source: S.selling },
    { fee: "Retrieval fee", amount: "Varies (not published)", appliesTo: "Each item sent back to you", when: "Rejected, replica or withdrawn consigned items you ask to have returned", source: S.selling },
    { fee: "Consigning a rejected item", amount: "$10–$15 (may apply)", appliesTo: "Each item", when: "You choose consignment instead of having a rejected item sent back", source: S.selling },
    { fee: "Storage after a verification issue", amount: "$2 a month", appliesTo: "Each consigned item", when: "Unsold 60 days after relisting, if the $10 issue fee wasn’t charged", source: S.selling },
    { fee: "Maintenance fee", amount: "$1 a month", appliesTo: "Account balance", when: "No activity for 2 years, in 33 states and D.C.", source: S.fees },
  ];
}

/* ---------------- fields ---------------- */

const locationOptions: SelectOption[] = LOCATIONS.map((l) => ({
  value: l.id,
  label: l.label,
  group: l.group,
  hint: l.fee !== undefined ? `$${l.fee / 100} seller fee` : `$${l.dropoff! / 100} drop-off · $${l.prepaid! / 100} label`,
}));

function ratingOptions(inputs: Inputs): SelectOption[] {
  const canada = location(inputs).id === "ca";
  return TIERS.map((t) => ({ value: t.id, label: t.label, hint: `${formatRate(canada ? t.canada : t.rate)} commission` }));
}

const abroad = (inputs: Inputs) => !location(inputs).domestic;
const cashOutRateOf = (inputs: Inputs) => (abroad(inputs) && !isCanada(location(inputs)) && str(inputs, "cashOutRate", "2.9") === "3.1" ? CASH_OUT_RATE_SOME : CASH_OUT_RATE);

export const goat: CalculatorDef = {
  slug: "goat",
  name: "GOAT",
  path: "/goat-fee-calculator",
  category: "marketplaces",
  priceNoun: "listing price",
  sellerNoun: "seller",
  blurb: "9.5% commission + $5 seller fee ($0 drop-off) + 2.9% cash-out (US)",
  markets: MARKETS,
  defaultMarket: "us",
  priceField: "price",
  fields: [
    {
      id: "price",
      kind: "money",
      label: "Your listing price",
      section: "sale",
      help: "What you list it for, or the offer you accept, in US dollars. The buyer’s shipping and tax are added on top and don’t change your fees.",
    },
    {
      id: "rating",
      kind: "select",
      label: "Your seller rating",
      section: "sale",
      options: (inputs) => ratingOptions(inputs),
      help: "Everyone starts at 90. Each cancellation takes off 10 points; each completed sale adds 2.",
    },
    {
      id: "location",
      kind: "select",
      label: "Where is your seller account based?",
      section: "shipping",
      searchable: true,
      options: locationOptions,
      help: "Your seller fee depends on the address on your account: $0 to $35 per item.",
    },
    {
      id: "method",
      kind: "segmented",
      label: "How will the item get to GOAT?",
      section: "shipping",
      options: [
        { value: "prepaid", label: "Prepaid label" },
        { value: "dropoff", label: "Drop-off" },
        { value: "consign", label: "Consign" },
      ],
      help: (inputs) =>
        location(inputs).consign !== undefined
          ? "The drop-off rate only applies when you drop off a confirmed order at a GOAT location. Consigned items pay the drop-off rate here."
          : "The drop-off rate only applies when you drop off a confirmed order at a GOAT location. Consigned items pay the prepaid-label rate.",
      showIf: (inputs) => hasMethods(location(inputs)),
    },
    {
      id: "cashOut",
      kind: "segmented",
      label: "What will you do with the money?",
      section: "options",
      options: [
        { value: "cash", label: "Cash out" },
        { value: "spend", label: "Spend it on GOAT" },
      ],
      help: (inputs) => `Cashing out to your bank or PayPal costs ${formatRate(cashOutRateOf(inputs))} of the price. Your Spend Balance has no fee but only buys things on GOAT.`,
      advanced: true,
      showIf: (inputs) => !isCanada(location(inputs)),
    },
    {
      id: "cashOutCurrency",
      kind: "segmented",
      label: "Which currency will you cash out in?",
      section: "options",
      options: [
        { value: "local", label: "My local currency" },
        { value: "usd", label: "US dollars" },
      ],
      help: "Choosing US dollars where local currency is offered may add a 0.6% cross-border fee.",
      showIf: (inputs) => currencyChoice(location(inputs)) && cashesOut(inputs, location(inputs)),
    },
    {
      id: "cashOutRate",
      kind: "segmented",
      label: "Your cash-out fee",
      section: "options",
      options: [
        { value: "2.9", label: "2.9% (most sellers)" },
        { value: "3.1", label: "3.1%" },
      ],
      help: "GOAT says certain sellers in select locations pay 3.1%, depending on cash-out method and currency. Your app shows which you pay.",
      advanced: true,
      showIf: (inputs) => abroad(inputs) && !isCanada(location(inputs)) && cashesOut(inputs, location(inputs)),
    },
    { id: "itemCost", kind: "money", label: "What you paid for it", section: "costs", help: "Retail or what you paid for the pair." },
    { id: "otherCost", kind: "money", label: "Packaging & other costs", section: "costs", help: "Box, bubble wrap, the trip to the drop-off point." },
  ],
  defaults: () => ({
    price: 200,
    rating: "90",
    location: "us",
    method: "prepaid",
    cashOut: "cash",
    cashOutCurrency: "local",
    cashOutRate: "2.9",
    itemCost: 0,
    otherCost: 0,
  }),
  calculate,
  // Every GOAT fee is a fixed amount or a straight percentage of the price: no tier edges or caps.
  breakpoints: () => [],
  verifiedAt: "2026-10-23",
  sources,
  changes,
  schedule,
  compare: {
    group: "sell",
    // GOAT supplies the label (covered by the seller fee) and the buyer pays GOAT for shipping, so shipping in/out doesn't apply.
    map: (c) => ({ price: c.price, itemCost: c.itemCost }),
    note: "US seller, prepaid label, rating 90+, cashed out; GOAT supplies the label",
  },
};

export default goat;
