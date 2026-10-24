/*
 * Vinted fees. Every number is from Vinted's own pages (see `sources`), re-read 2026-10-23.
 * Research notes with verbatim quotes: research/fees/vinted.md.
 *
 * How a Vinted sale is settled (what this module reproduces):
 *  - Sellers pay no selling fee: private sellers ("There are zero selling fees") and Vinted Pro
 *    ("Vinted Pro is entirely free"). The seller receives the item price; withdrawals are free.
 *  - The buyer pays the "Vinted fee" (called the "Buyer Protection fee" until the October 2026
 *    terms): a percentage of the item or bundle price plus a fixed amount, VAT/GST included, never
 *    charged on shipping. Help article 342 per market: "usually 5% + $0.70" (US), "5 % + 0,70 €"
 *    (euro countries), "5% + 2,90 zł", "5 % + 7,50 SEK", "5 % + 5 kr", "5% + $1.20" (Australia) and,
 *    for the UK only, a range: "usually 3% to 8% + £0.3 to £0.8".
 *  - Where the help page gives a range or disagrees with what buyers are charged, we use the
 *    prices Vinted's own listings showed "incl." the fee on 2026-10-23 (anonymous catalogue pages):
 *      UK, most categories: 5% + £0.70 (e.g. £5.30 → £6.27, £11.33 → £12.60);
 *      UK, Kids catalogue: 8% + £0.30 (£1.00 → £1.38, £25.00 → £27.30, £950 → £1,026.30);
 *      UK cap: £75.00 from an item price of £1,486 (£1,485 → £74.95; £1,487.98, £1,495, £2,000 → £75).
 *        Kids items were still uncapped at £1,453 (£116.54) and capped at £1,495; we apply the same
 *        £1,486 threshold, the only one consistent with both categories;
 *      Australia: 5% + A$1.00 (A$10 → A$11.50), not the A$1.20 on the help page;
 *      US and France: 5% + $0.70 / €0.70 with no cap ($4,000 → $200.70, €3,000 → €150.70).
 *    Each fee is rounded to the cent, half up (£5.30 → 0.965 → £0.97), as the listings show.
 *  - Optional buyer services: Item Verification (designer items) and Electronics Verification, a
 *    flat fee per item where available. Shipping is a prepaid label the buyer pays at checkout.
 *  - Optional seller costs: Bump (one item, 3 or 7 days) and Showcase (whole wardrobe, 7 days).
 *    Vinted publishes no price list for either ("shown to you at the time of payment"), so the
 *    seller types what they paid; Showcase can be spread over the sales it brought. Showcase "is
 *    currently unavailable for members in the US" / "in Australia" (help/452 on each site), so it
 *    is hidden and ignored there.
 */
import { M } from "../markets";
import { assemble, bool, costLines, formatRate, moneyFor, num, pct, roundCents, str, toCents } from "../money";
import type { CalculatorDef, FeeChange, Inputs, Line, Market, ScheduleRow, Source } from "../types";

const MARKETS: Market[] = [M.us, M.uk, M.au, M.fr, M.de, M.it, M.es, M.nl, M.be, M.at, M.pt, M.ie, M.fi, M.gr, M.pl, M.se, M.dk];

interface FeeFormula {
  /** Percent of the item (or bundle) price. */
  rate: number;
  /** Fixed part, cents of the market's currency. */
  fixed: number;
}

interface MarketRules {
  fee: FeeFormula;
  /** UK only: the Kids catalogue's own formula. */
  kids?: FeeFormula;
  /** UK only: flat fee (cents) from this item price (cents) upwards. */
  cap?: { from: number; amount: number };
  /** What the market's help article says, verbatim, when it differs from what listings charge. */
  published?: string;
  /** "VAT" / "GST" when the fee includes it. */
  taxIncluded: "VAT" | "GST" | null;
  /** Item Verification: fee per item and the minimum item price (cents). Absent = not offered. */
  iv?: { fee: number; min: number };
  /** Electronics Verification: fee per item (cents). Absent = not offered. */
  ev?: number;
  /** False where Vinted's Showcase help page says the feature is unavailable. */
  showcase: boolean;
  /** Source ids for this market. */
  src: { fee: string; iv?: string; ev?: string; observed?: string };
}

const S = {
  feeUk: "vinted-fee-uk",
  feeUs: "vinted-fee-us",
  feeAu: "vinted-fee-au",
  feeEu: "vinted-fee-ie",
  feePl: "vinted-fee-pl",
  feeSe: "vinted-fee-se",
  feeDk: "vinted-fee-dk",
  listingsUk: "vinted-listings-uk",
  listingsAu: "vinted-listings-au",
  howItWorks: "vinted-how-it-works",
  pro: "vinted-pro",
  terms: "vinted-terms-uk",
  bump: "vinted-bump",
  showcase: "vinted-showcase",
  showcaseUs: "vinted-showcase-us",
  showcaseAu: "vinted-showcase-au",
  ivUk: "vinted-iv-uk",
  ivEu: "vinted-iv-fr",
  ivPl: "vinted-iv-pl",
  ivSe: "vinted-iv-se",
  ivDk: "vinted-iv-dk",
  evUk: "vinted-ev-uk",
  evEu: "vinted-ev-fr",
  evPl: "vinted-ev-pl",
  evSe: "vinted-ev-se",
  evDk: "vinted-ev-dk",
  fx: "vinted-currency",
  withdraw: "vinted-withdrawals",
  salesTax: "vinted-us-sales-tax",
  newsUs: "vinted-news-us",
  newsAu: "vinted-news-au",
} as const;

const EURO = (iv: boolean, ev: boolean): MarketRules => ({
  fee: { rate: 5, fixed: 70 },
  taxIncluded: "VAT",
  iv: iv ? { fee: 1000, min: 10000 } : undefined,
  ev: ev ? 500 : undefined,
  showcase: true,
  src: { fee: S.feeEu, iv: iv ? S.ivEu : undefined, ev: ev ? S.evEu : undefined },
});

const RULES: Record<string, MarketRules> = {
  us: { fee: { rate: 5, fixed: 70 }, taxIncluded: null, showcase: false, src: { fee: S.feeUs } },
  uk: {
    fee: { rate: 5, fixed: 70 },
    kids: { rate: 8, fixed: 30 },
    cap: { from: 148600, amount: 7500 },
    published: "usually 3% to 8% + £0.3 to £0.8",
    taxIncluded: "VAT",
    iv: { fee: 1000, min: 8500 },
    ev: 500,
    showcase: true,
    src: { fee: S.feeUk, iv: S.ivUk, ev: S.evUk, observed: S.listingsUk },
  },
  au: { fee: { rate: 5, fixed: 100 }, published: "usually 5% + $1.20", taxIncluded: "GST", showcase: false, src: { fee: S.feeAu, observed: S.listingsAu } },
  fr: EURO(true, true),
  de: EURO(true, true),
  it: EURO(true, true),
  es: EURO(true, true),
  nl: EURO(true, true),
  be: EURO(true, true),
  pt: EURO(true, true),
  fi: EURO(true, true),
  at: EURO(false, true),
  ie: EURO(false, false),
  gr: EURO(false, false),
  pl: { fee: { rate: 5, fixed: 290 }, taxIncluded: "VAT", iv: { fee: 4500, min: 45000 }, ev: 2000, showcase: true, src: { fee: S.feePl, iv: S.ivPl, ev: S.evPl } },
  se: { fee: { rate: 5, fixed: 750 }, taxIncluded: "VAT", iv: { fee: 12000, min: 110000 }, ev: 6000, showcase: true, src: { fee: S.feeSe, iv: S.ivSe, ev: S.evSe } },
  dk: { fee: { rate: 5, fixed: 500 }, taxIncluded: "VAT", iv: { fee: 8000, min: 74000 }, ev: 4000, showcase: true, src: { fee: S.feeDk, iv: S.ivDk, ev: S.evDk } },
};

const rulesFor = (market: Market): MarketRules => RULES[market.id] ?? RULES.us;

function help(id: string, title: string, url: string, publisher = "Vinted Help"): Source {
  return { id, title, url, publisher, checked: "2026-10-23" };
}

const sources: Source[] = [
  // Several help pages share a title across countries, so the publisher names the country.
  help(S.feeUs, "Vinted fee", "https://www.vinted.com/help/342", "Vinted Help (US)"),
  help(S.feeUk, "Vinted fee", "https://www.vinted.co.uk/help/342", "Vinted Help (UK)"),
  help(S.feeAu, "Vinted fee", "https://www.vinted.com.au/help/342", "Vinted Help (Australia)"),
  help(S.feeEu, "Vinted fee", "https://www.vinted.ie/help/342", "Vinted Help (Ireland)"),
  help(S.feePl, "Opłata Vinted", "https://www.vinted.pl/help/342", "Vinted Help (Poland)"),
  help(S.feeSe, "Vinted-avgift", "https://www.vinted.se/help/342", "Vinted Help (Sweden)"),
  help(S.feeDk, "Vinted-gebyr", "https://www.vinted.dk/help/342", "Vinted Help (Denmark)"),
  // Catalogue pages render in the browser only (curl and the items API get no listings), so the
  // daily watch can't read them; the help/342 pages above are what it watches.
  { id: S.listingsUk, title: "Items", url: "https://www.vinted.co.uk/catalog", publisher: "Vinted UK listings (prices shown “incl.” the Vinted fee)", checked: "2026-10-23" },
  { id: S.listingsAu, title: "Items", url: "https://www.vinted.com.au/catalog", publisher: "Vinted Australia listings (prices shown “incl.” the Vinted fee)", checked: "2026-10-23" },
  { id: S.howItWorks, title: "How it works", url: "https://www.vinted.co.uk/how_it_works", publisher: "Vinted", checked: "2026-10-23" },
  { id: S.pro, title: "Discover selling with Vinted for Professionals", url: "https://www.vinted.co.uk/pro", publisher: "Vinted", checked: "2026-10-23" },
  { id: S.terms, title: "User Terms and Conditions (new version applicable from 08-10-2026)", url: "https://www.vinted.co.uk/terms_and_conditions", publisher: "Vinted", checked: "2026-10-23" },
  help(S.bump, "What is an item Bump?", "https://www.vinted.co.uk/help/340", "Vinted Help (UK)"),
  help(S.showcase, "Showcase", "https://www.vinted.co.uk/help/452", "Vinted Help (UK)"),
  help(S.showcaseUs, "Showcase", "https://www.vinted.com/help/452", "Vinted Help (US)"),
  help(S.showcaseAu, "Showcase", "https://www.vinted.com.au/help/452", "Vinted Help (Australia)"),
  help(S.ivUk, "Item Verification for designer items", "https://www.vinted.co.uk/help/1147", "Vinted Help (UK)"),
  help(S.ivEu, "Qu'est-ce que le service de Vérification de l’article pour les articles de créateurs ?", "https://www.vinted.fr/help/1147", "Vinted Help (France)"),
  help(S.ivPl, "Usługa Weryfikacja Przedmiotów dla produktów designerskich", "https://www.vinted.pl/help/1147", "Vinted Help (Poland)"),
  help(S.ivSe, "Artikel-verifiering för designobjekt", "https://www.vinted.se/help/1147", "Vinted Help (Sweden)"),
  help(S.ivDk, "Artikelbekræftelse for designerartikler", "https://www.vinted.dk/help/1147", "Vinted Help (Denmark)"),
  help(S.evUk, "Electronics Verification service for buyers", "https://www.vinted.co.uk/help/1360", "Vinted Help (UK)"),
  help(S.evEu, "Qu’est-ce que le service de Vérification du matériel électronique pour les acheteurs ?", "https://www.vinted.fr/help/1360", "Vinted Help (France)"),
  help(S.evPl, "Usługa Weryfikacji Elektroniki dla kupujących", "https://www.vinted.pl/help/1360", "Vinted Help (Poland)"),
  help(S.evSe, "Elektronikverifiering för köpare", "https://www.vinted.se/help/1360", "Vinted Help (Sweden)"),
  help(S.evDk, "Elektronikbekræftelsestjeneste for købere", "https://www.vinted.dk/help/1360", "Vinted Help (Denmark)"),
  help(S.fx, "Converted-currency payments", "https://www.vinted.co.uk/help/1074", "Vinted Help (UK)"),
  help(S.withdraw, "Money withdrawal issues", "https://www.vinted.co.uk/help/73", "Vinted Help (UK)"),
  help(S.salesTax, "Sales tax on Vinted: info for sellers", "https://www.vinted.com/help/1014", "Vinted Help (US)"),
  { id: S.newsUs, title: "Vinted has landed in New York", url: "https://company.vinted.com/en/newsroom/vinted-launches-us-nyc-2", publisher: "Vinted Group Newsroom", checked: "2026-10-23" },
  {
    id: S.newsAu,
    title: "Vinted launches in Australia as decluttering, not cost-of-living, drives demand",
    url: "https://company.vinted.com/en/newsroom/vinted-launches-australia",
    publisher: "Vinted Group Newsroom",
    checked: "2026-10-23",
  },
];

const changes: FeeChange[] = [
  {
    date: "2026-10-08",
    text: "Vinted’s new UK terms (applicable from October 8, 2026) rename the “Buyer Protection fee” the “Vinted fee” and define it as “a mandatory platform fee, payable by buyers”. Sellers still receive the full item price.",
    source: S.terms,
  },
  {
    date: "2026-07-01",
    text: "Vinted launches in Australia with zero selling fees for sellers; buyers pay a Buyer Protection fee on each purchase.",
    source: S.newsAu,
  },
  { date: "2026-01-22", text: "Vinted announces its US expansion, starting in New York: sellers list items without paying selling fees.", source: S.newsUs },
];

/** "kids" only applies in the UK, the one market whose Kids catalogue has its own rate. */
function category(inputs: Inputs, market: Market): "standard" | "kids" {
  return rulesFor(market).kids && str(inputs, "category", "standard") === "kids" ? "kids" : "standard";
}

/** The Vinted fee the buyer pays on an item (or bundle) price, in cents, with how it was worked out. */
export function vintedFee(itemCents: number, market: Market, cat: "standard" | "kids" = "standard"): { amount: number; formula: FeeFormula; capped: boolean; raw: number } {
  const rules = rulesFor(market);
  const formula = cat === "kids" && rules.kids ? rules.kids : rules.fee;
  // Half up to the cent: pct() rounds the percentage part half away from zero; the fixed part is whole cents.
  const raw = itemCents > 0 ? pct(itemCents, formula.rate) + formula.fixed : 0;
  const capped = Boolean(rules.cap && itemCents >= rules.cap.from && raw > rules.cap.amount);
  return { amount: capped ? rules.cap!.amount : raw, formula, capped, raw };
}

function calculate(inputs: Inputs, market: Market) {
  const money = moneyFor(market);
  const rules = rulesFor(market);
  const item = toCents(num(inputs, "price"));
  const cat = category(inputs, market);
  const fee = vintedFee(item, market, cat);

  const fees: Line[] = [
    {
      id: "selling",
      label: "Selling fee",
      amount: 0,
      kind: "platform",
      detail: "0%: Vinted charges the buyer, not you",
      explain:
        "Vinted has no selling fee, for private sellers and Vinted Pro accounts alike. You get the full item price (after any offer or bundle discount you accept) in your Vinted Balance once the order is complete.",
      source: S.howItWorks,
    },
  ];

  const bump = toCents(num(inputs, "bump"));
  if (bump) {
    fees.push({
      id: "bump",
      label: "Bump",
      amount: bump,
      kind: "ads",
      detail: "What you paid to Bump this item",
      explain: `A Bump pushes one item higher in feeds and search for 3 or 7 days. Vinted prices it by the item’s price and the duration and shows the cost before you pay; there is no public price list. It isn’t refunded if you later lower the price.${
        market.id === "us" ? " In some states sales tax is added to it: enter what you paid in total." : ""
      }`,
      source: market.id === "us" ? S.salesTax : S.bump,
    });
  }

  // Ignored where Showcase isn't offered (a value can carry over when the market is switched).
  const showcase = rules.showcase ? toCents(num(inputs, "showcase")) : 0;
  if (showcase) {
    const sales = Math.max(1, Math.round(num(inputs, "showcaseSales", 1)));
    fees.push({
      id: "showcase",
      label: sales > 1 ? "Showcase (this sale’s share)" : "Showcase",
      amount: roundCents(showcase / sales),
      kind: "ads",
      detail: sales > 1 ? `${money(showcase)} ÷ ${sales} sales` : `${money(showcase)} for the week`,
      explain:
        "Showcase (formerly Wardrobe Spotlight) promotes your whole wardrobe for 7 days and needs at least 5 listings. Vinted shows the price at checkout; it depends on how many listings you have and their value. Spread it over the sales it brought to see its cost per sale.",
      source: S.showcase,
    });
  }

  fees.push({
    id: "withdrawal",
    label: "Withdrawal to your bank",
    amount: 0,
    kind: "payout",
    detail: "Free",
    explain: "Moving your Vinted Balance to your bank costs nothing: the amount withdrawn matches the amount you receive. It can take up to 5 business days to arrive.",
    source: S.withdraw,
  });

  const buyerFees: Line[] = [];
  if (item > 0) {
    const f = fee.formula;
    const parts = [
      `The buyer pays ${formatRate(f.rate)} of the item (or bundle) price plus ${money(f.fixed)}${rules.taxIncluded ? ` (${rules.taxIncluded} included)` : ""}. It isn’t charged on shipping and doesn’t come out of your earnings.`,
    ];
    if (market.id === "uk") {
      parts.push(
        cat === "kids"
          ? "Items in the UK Kids catalogue (clothes, toys, pushchairs and more) carry 8% + £0.30 instead of the usual 5% + £0.70: a little less for the buyer under about £13, more above it."
          : "Most UK categories (women, men, home, electronics, books, hobbies) carry 5% + £0.70; the Kids catalogue has its own 8% + £0.30.",
        "Vinted’s help page gives only a range, “usually 3% to 8% + £0.3 to £0.8”; these are the rates its UK listings showed on October 23, 2026.",
      );
      if (fee.capped) parts.push("From a £1,486 item price, UK listings show a flat £75.00 fee, a cap Vinted’s help pages don’t mention.");
    }
    if (market.id === "au") parts.push("Vinted’s help page says “usually 5% + $1.20”, but listings on October 23, 2026 charged 5% + A$1.00, which is what we use.");
    buyerFees.push({
      id: "vinted-fee",
      label: "Vinted fee",
      amount: fee.amount,
      kind: "platform",
      detail: fee.capped
        ? `${formatRate(f.rate)} × ${money(item)} + ${money(f.fixed)} = ${money(fee.raw)}, capped at ${money(fee.amount)}`
        : `${formatRate(f.rate)} × ${money(item)} + ${money(f.fixed)}`,
      explain: parts.join(" "),
      source: rules.src.observed ?? rules.src.fee,
    });
  }

  const shipping = toCents(num(inputs, "shippingPaid"));
  if (shipping) {
    buyerFees.push({
      id: "shipping",
      label: "Prepaid shipping label",
      amount: shipping,
      kind: "shipping",
      detail: "Price shown at checkout",
      explain: "The buyer pays the label at checkout; it depends on the parcel size, route and carrier. It goes to the carrier, not to you, and Vinted takes no fee on it.",
      source: S.terms,
    });
  }

  if (rules.iv && item >= rules.iv.min && bool(inputs, "itemVerification")) {
    buyerFees.push({
      id: "item-verification",
      label: "Item Verification",
      amount: rules.iv.fee,
      kind: "other",
      detail: `${money(rules.iv.fee)} per item, chosen by the buyer`,
      explain: `An optional authenticity check for eligible designer items priced ${money(rules.iv.min)} or more. The buyer pays it, it includes your postage to Vinted’s verification hub, and you pay nothing. The Vinted fee still applies. Not available for bundles.`,
      source: rules.src.iv,
    });
  }

  if (rules.ev && bool(inputs, "electronicsVerification")) {
    buyerFees.push({
      id: "electronics-verification",
      label: "Electronics Verification",
      amount: rules.ev,
      kind: "other",
      detail: `${money(rules.ev)} per item, chosen by the buyer`,
      explain: `An optional check of eligible phones, tablets and consoles before they reach the buyer. ${
        market.id === "uk" ? `Vinted includes it free on some orders; otherwise the buyer pays ${money(rules.ev)}` : `The buyer pays ${money(rules.ev)}`
      }, which covers your postage to the verification hub; you pay nothing. Not available for bundles.`,
      source: rules.src.ev,
    });
  }

  const notes: string[] = [];
  if (item > 0) {
    notes.push(`Buyers see ${money(item + fee.amount)} on your listing (“incl.”): your ${money(item)} plus the ${money(fee.amount)} Vinted fee. Shipping is added at checkout.`);
  }
  if (market.id === "uk" && cat === "kids" && item > 145300 && item < 149500) {
    notes.push("Between £1,453 and £1,495 we couldn’t confirm where the £75 cap starts for Kids items; Vinted’s checkout shows the exact fee.");
  }
  if (market.id === "us") notes.push("Where Vinted collects sales tax, it is added on top of the buyer’s order. It doesn’t change what you receive.");
  if (!bump && !showcase) {
    notes.push(
      rules.showcase
        ? "Vinted takes nothing from the sale itself. Its only charges to sellers are optional Bumps and Showcase: add what you paid under Options to see the cost per sale."
        : `Vinted takes nothing from the sale itself. Its only charge to sellers is an optional Bump (Showcase isn’t available in ${market.id === "us" ? "the US" : "Australia"}): add what you paid under Options.`,
    );
  }

  return assemble({
    market,
    buyerPays: item + buyerFees.reduce((s, l) => s + l.amount, 0),
    saleAmount: item,
    fees,
    buyerFees,
    costs: costLines(inputs, market),
    notes: notes.slice(0, 3),
  });
}

function schedule(market: Market): ScheduleRow[] {
  const money = moneyFor(market);
  const rules = rulesFor(market);
  const f = rules.fee;
  const tax = rules.taxIncluded ? `, ${rules.taxIncluded} incl.` : "";
  const rows: ScheduleRow[] = [
    { fee: "Selling fee (you)", amount: "0%", appliesTo: "Your item price", when: "Private sellers and Vinted Pro", source: S.howItWorks },
  ];
  if (market.id === "uk") {
    rows.push(
      { fee: "Vinted fee (buyer), most items", amount: `5% + £0.70${tax}`, appliesTo: "Item or bundle price, not shipping", when: "Every order; added to the price the buyer pays", source: S.listingsUk },
      { fee: "Vinted fee (buyer), Kids catalogue", amount: `8% + £0.30${tax}`, appliesTo: "Item or bundle price, not shipping", when: "Items listed under Kids", source: S.listingsUk },
      {
        fee: "Vinted fee cap",
        amount: "£75.00",
        appliesTo: "Item price of £1,486 or more",
        when: "Seen on UK listings, not in Vinted’s help pages. Kids items: still uncapped at £1,453, capped at £1,495",
        source: S.listingsUk,
      },
    );
  } else if (market.id === "au") {
    rows.push({
      fee: "Vinted fee (buyer)",
      amount: `5% + ${money(f.fixed)}${tax}`,
      appliesTo: "Item or bundle price, not shipping",
      when: "Every order; Vinted’s help page says “usually 5% + $1.20”, listings charged A$1.00",
      source: S.listingsAu,
    });
  } else {
    rows.push({
      fee: "Vinted fee (buyer)",
      amount: `${formatRate(f.rate)} + ${money(f.fixed)}${tax}`,
      appliesTo: "Item or bundle price, not shipping",
      when: market.id === "us" ? "Every order; sales tax may be added on top" : "Every order; added to the price the buyer pays",
      source: rules.src.fee,
    });
  }
  rows.push({ fee: "Prepaid shipping (buyer)", amount: "Shown at checkout", appliesTo: "By parcel size, route and carrier", when: "Every order with a Vinted label", source: S.terms });
  if (rules.iv) {
    rows.push({ fee: "Item Verification (buyer, optional)", amount: `${money(rules.iv.fee)} per item`, appliesTo: `Eligible designer items from ${money(rules.iv.min)}`, when: "Buyer adds it at checkout", source: rules.src.iv });
  }
  if (rules.ev) {
    rows.push({ fee: "Electronics Verification (buyer, optional)", amount: `${money(rules.ev)} per item`, appliesTo: "Eligible phones, tablets and consoles", when: "Buyer adds it at checkout", source: rules.src.ev });
  }
  rows.push(
    { fee: "Currency conversion (buyer)", amount: "1.2% or 3%", appliesTo: "Item price, built into the exchange rate", when: "Buyer pays in another currency", source: S.fx },
    { fee: "Bump (you, optional)", amount: "Shown before you pay", appliesTo: "One item, 3 or 7 days", when: "Only if you buy one", source: S.bump },
    rules.showcase
      ? { fee: "Showcase (you, optional)", amount: "Shown at checkout", appliesTo: "Your whole wardrobe for 7 days (5+ listings)", when: "Only if you buy one", source: S.showcase }
      : { fee: "Showcase (you, optional)", amount: "Not offered", appliesTo: "Your whole wardrobe", when: `Vinted says it is unavailable in ${market.id === "us" ? "the US" : "Australia"}`, source: market.id === "us" ? S.showcaseUs : S.showcaseAu },
    { fee: "Withdrawal to your bank", amount: "Free", appliesTo: "Your Vinted Balance", when: "Up to 5 business days", source: S.withdraw },
  );
  if (market.id === "us") rows.push({ fee: "Sales tax (buyer)", amount: "By state", appliesTo: "Added on top of the buyer’s order (and to Bumps)", when: "States where Vinted collects it", source: S.salesTax });
  return rows;
}

const DEFAULT_PRICE: Record<string, number> = { USD: 20, GBP: 10, EUR: 10, AUD: 20, PLN: 40, SEK: 100, DKK: 75 };

export const vinted: CalculatorDef = {
  slug: "vinted",
  name: "Vinted",
  path: "/vinted-fee-calculator",
  category: "marketplaces",
  priceNoun: "item price",
  sellerNoun: "seller",
  blurb: "No selling fee; the buyer pays 5% + $0.70 (US)",
  markets: MARKETS,
  defaultMarket: "us",
  priceField: "price",
  fields: [
    {
      id: "price",
      kind: "money",
      label: "Item price",
      section: "sale",
      help: "Your listing price, or the offer you accepted. For a bundle, enter the bundle total. You get all of it: Vinted charges the buyer.",
    },
    {
      id: "category",
      kind: "segmented",
      label: "What are you selling?",
      section: "sale",
      options: [
        { value: "standard", label: "Most items" },
        { value: "kids", label: "Kids’ items" },
      ],
      help: "UK buyers pay 8% + £0.30 on anything in the Kids catalogue (clothes, toys, pushchairs…) and 5% + £0.70 on everything else.",
      showIf: (_i, m) => Boolean(rulesFor(m).kids),
    },
    {
      id: "shippingPaid",
      kind: "money",
      label: "Shipping the buyer pays",
      section: "shipping",
      help: "Optional: the label price Vinted shows at checkout for your parcel size. The buyer pays it, it never touches your earnings, and no fee is charged on it.",
    },
    {
      id: "bump",
      kind: "money",
      label: "Bump cost for this item",
      section: "options",
      help: "Leave at 0 if you didn’t Bump it. Vinted shows the price before you pay; it depends on the item’s price and whether you pick 3 or 7 days.",
    },
    {
      id: "showcase",
      kind: "money",
      label: "Showcase cost (7 days)",
      section: "options",
      advanced: true,
      help: "What you paid to promote your whole wardrobe for a week (formerly Wardrobe Spotlight).",
      showIf: (_i, m) => rulesFor(m).showcase,
    },
    {
      id: "showcaseSales",
      kind: "number",
      label: "Sales during that Showcase week",
      section: "options",
      advanced: true,
      integer: true,
      min: 1,
      max: 999,
      help: "We split the Showcase cost evenly across them.",
      showIf: (i, m) => rulesFor(m).showcase && num(i, "showcase") > 0,
    },
    {
      id: "itemVerification",
      kind: "toggle",
      label: "Buyer added Item Verification",
      section: "options",
      advanced: true,
      help: "Optional authenticity check on eligible designer items. The buyer pays for it; you pay nothing.",
      showIf: (i, m) => {
        const iv = rulesFor(m).iv;
        return Boolean(iv) && toCents(num(i, "price")) >= iv!.min;
      },
    },
    {
      id: "electronicsVerification",
      kind: "toggle",
      label: "Buyer added Electronics Verification",
      section: "options",
      advanced: true,
      help: "Optional check of eligible phones, tablets and consoles. The buyer pays for it; you pay nothing.",
      showIf: (_i, m) => Boolean(rulesFor(m).ev),
    },
    { id: "itemCost", kind: "money", label: "What the item cost you", section: "costs", help: "What you paid for it, if you bought it to resell." },
    { id: "otherCost", kind: "money", label: "Packaging & other", section: "costs", help: "The prepaid label is paid by the buyer, so postage isn’t your cost." },
  ],
  defaults: (market) => ({
    price: DEFAULT_PRICE[market.currency] ?? 20,
    category: "standard",
    shippingPaid: 0,
    bump: 0,
    showcase: 0,
    showcaseSales: 1,
    itemVerification: false,
    electronicsVerification: false,
    itemCost: 0,
    otherCost: 0,
  }),
  calculate,
  // The seller's take is the item price minus whatever promotion they bought: no tiers, caps or
  // minimums on the seller side. (The UK £75 cap only changes what the buyer pays.)
  breakpoints: () => [],
  verifiedAt: "2026-10-23",
  sources,
  changes,
  schedule,
  compare: {
    group: "sell",
    map: (c) => ({ price: c.price, shippingPaid: c.shipping, itemCost: c.itemCost }),
    note: "No selling fee; the buyer pays the label plus 5% + $0.70",
  },
};

export default vinted;
