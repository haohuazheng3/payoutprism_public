/*
 * Amazon KDP royalties. KDP Help G201834330 (paperback royalty), G201834340 (printing cost),
 * G200644210 (eBook royalty options), G200634560 (eBook list price requirements), checked 2026-10-24.
 *  - Paperback: (royalty rate × list price) − printing cost. Rate 50% at or below the threshold
 *    (US $9.98 / UK £7.98 / CA & AU 13.98 / EU €9.98), 60% at or above the next cent; Expanded
 *    Distribution 40%. Printing = fixed cost + pages × per-page cost (black ink 24–110 pages: fixed only).
 *  - eBook (Amazon.com): 35% of list price, or 70% of (list price − delivery cost) for list prices
 *    $2.99–$12.99; delivery averages $0.06 per copy and depends on file size.
 */
import { M } from "../markets";
import { assemble, bool, moneyFor, num, pct, str, toCents } from "../money";
import type { CalculatorDef, Inputs, Line, Market } from "../types";
import { CHECKED, src } from "./_kit";

const sources = [
  src("kdp-pb-royalty", "Paperback Royalty", "https://kdp.amazon.com/en_US/help/topic/G201834330", "Amazon KDP"),
  src("kdp-print", "Paperback Printing Cost", "https://kdp.amazon.com/en_US/help/topic/G201834340", "Amazon KDP"),
  src("kdp-ebook", "eBook Royalty Options", "https://kdp.amazon.com/en_US/help/topic/G200644210", "Amazon KDP"),
  src("kdp-ebook-price", "eBook List Price Requirements", "https://kdp.amazon.com/en_US/help/topic/G200634560", "Amazon KDP"),
];
/** Cents in the market's currency: threshold for 60%, then black / standard color / premium color [fixed small-book, fixed, per-page] for regular and large trim. */
const KDP: Record<string, { at60: number; black: { flat: [number, number]; fixed: number; page: [number, number] }; premium: { flat: [number, number]; fixed: number; page: [number, number] }; standard?: { fixed: number; page: [number, number] } }> = {
  us: { at60: 999, black: { flat: [230, 284], fixed: 100, page: [1.2, 1.7] }, premium: { flat: [360, 420], fixed: 100, page: [6.5, 8] }, standard: { fixed: 100, page: [2.55, 4.02] } },
  uk: { at60: 799, black: { flat: [193, 215], fixed: 85, page: [1.0, 1.2] }, premium: { flat: [259, 324], fixed: 85, page: [4.35, 5.98] }, standard: { fixed: 85, page: [2.0, 2.7] } },
  ca: { at60: 1399, black: { flat: [299, 353], fixed: 126, page: [1.6, 2.1] }, premium: { flat: [466, 526], fixed: 126, page: [8.5, 10] } },
  au: { at60: 1399, black: { flat: [474, 528], fixed: 242, page: [2.2, 2.7] }, premium: { flat: [582, 642], fixed: 242, page: [8.5, 10] } },
  de: { at60: 999, black: { flat: [205, 248], fixed: 75, page: [1.2, 1.6] }, premium: { flat: [285, 361], fixed: 75, page: [5.25, 7.15] }, standard: { fixed: 75, page: [2.4, 3.5] } },
};

export function printingCost(market: string, pages: number, ink: string, large: boolean): number {
  const k = KDP[market] ?? KDP.us;
  const t = large ? 1 : 0;
  if (ink === "standard" && k.standard) return Math.round(k.standard.fixed + pages * k.standard.page[t]);
  const spec = ink === "premium" ? k.premium : k.black;
  const smallMax = ink === "premium" ? 40 : market === "au" ? 108 : 110;
  if (pages <= smallMax) return spec.flat[t];
  return Math.round(spec.fixed + pages * spec.page[t]);
}

function calculate(inputs: Inputs, market: Market) {
  const money = moneyFor(market);
  const price = toCents(num(inputs, "price"));
  const format = str(inputs, "format", "paperback");
  const notes: string[] = [];
  if (format === "ebook") {
    const opt70 = str(inputs, "plan", "70") === "70" && market.id === "us" && price >= 299 && price <= 1299;
    const delivery = toCents(num(inputs, "delivery", 0.06));
    const royalty = opt70 ? pct(price - delivery, 70) : pct(price, 35);
    const fees: Line[] = opt70
      ? [
          { id: "share", label: "Amazon’s share (30%)", amount: price - delivery - royalty, kind: "platform", detail: `30% × (${money(price)} − ${money(delivery)})`, explain: "On the 70% option you get 70% of the list price after the delivery cost.", source: "kdp-ebook" },
          { id: "delivery", label: "Delivery cost", amount: delivery, kind: "other", detail: "per copy, by file size", explain: "KDP subtracts a delivery cost based on the file size; KDP says it averages $0.06 per copy.", source: "kdp-ebook" },
        ]
      : [{ id: "share", label: "Amazon’s share (65%)", amount: price - royalty, kind: "platform", detail: `65% × ${money(price)}`, explain: "On the 35% option you get 35% of the list price, with no delivery cost.", source: "kdp-ebook" }];
    if (str(inputs, "plan", "70") === "70" && !opt70) notes.push(market.id !== "us" ? "This calculator applies the 70% option on Amazon.com prices; other marketplaces have their own price bands and VAT." : "The 70% option needs a list price between $2.99 and $12.99 on Amazon.com, so this price earns 35%.");
    return assemble({ market, buyerPays: price, saleAmount: price, fees, notes });
  }
  const pages = Math.max(24, Math.min(828, Math.round(num(inputs, "pages", 300))));
  const ink = str(inputs, "ink", "black");
  const large = bool(inputs, "large");
  const expanded = bool(inputs, "expanded");
  const k = KDP[market.id] ?? KDP.us;
  const rate = expanded ? 40 : price >= k.at60 ? 60 : 50;
  const print = printingCost(market.id, pages, ink, large);
  const fees: Line[] = [
    { id: "share", label: `Amazon’s share (${100 - rate}%)`, amount: price - pct(price, rate), kind: "platform", detail: `${100 - rate}% × ${money(price)}`, explain: expanded ? "Expanded Distribution pays a 40% royalty rate before printing." : `Paperbacks priced at ${money(k.at60)} or more earn 60%; below that, 50%.`, source: "kdp-pb-royalty" },
    { id: "print", label: `Printing (${pages} pages, ${ink === "black" ? "black ink" : ink === "premium" ? "premium color" : "standard color"}${large ? ", large trim" : ""})`, amount: print, kind: "other", detail: "fixed cost + pages × per-page cost", explain: "KDP subtracts the printing cost for each copy: a fixed cost plus a per-page cost that depends on ink, trim size and marketplace.", source: "kdp-print" },
  ];
  if (!expanded && price < k.at60 && price > 0) notes.push(`At ${money(k.at60)} the rate jumps to 60%: pricing up to there would pay ${money(pct(k.at60, 60) - print)} a copy instead of ${money(pct(price, 50) - print)}.`);
  const minPrice = Math.ceil(print / (rate / 100));
  if (pct(price, rate) - print < 0) notes.push(`KDP won’t let you set a list price this low: the minimum covers printing, about ${money(minPrice)} here.`);
  return assemble({ market, buyerPays: price, saleAmount: price, fees, notes });
}

const def: CalculatorDef = {
  slug: "kdp",
  name: "Amazon KDP",
  path: "/kdp-royalty-calculator",
  category: "creators",
  priceNoun: "list price",
  sellerNoun: "author",
  saleNoun: "copy",
  buyerNoun: "reader",
  blurb: "Paperback 60% (50% under $9.99) minus printing; eBook 35% or 70%",
  keepHead: "Royalty per copy",
  receiveLabel: "Your royalty",
  markets: [M.us, M.uk, M.ca, M.au, M.de],
  defaultMarket: "us",
  priceField: "price",
  fields: [
    { id: "price", kind: "money", label: "List price", section: "sale" },
    { id: "format", kind: "segmented", label: "Format", section: "sale", options: [{ value: "paperback", label: "Paperback" }, { value: "ebook", label: "eBook" }] },
    { id: "pages", kind: "number", label: "Page count", section: "sale", min: 24, max: 828, integer: true, showIf: (i) => str(i, "format") !== "ebook" },
    { id: "ink", kind: "segmented", label: "Ink", section: "sale", options: [{ value: "black", label: "Black" }, { value: "standard", label: "Standard color" }, { value: "premium", label: "Premium color" }], showIf: (i) => str(i, "format") !== "ebook" },
    { id: "large", kind: "toggle", label: "Large trim (wider than 6.12″ or taller than 9″)", section: "options", showIf: (i) => str(i, "format") !== "ebook" },
    { id: "expanded", kind: "toggle", label: "Sold through Expanded Distribution (40%)", section: "options", showIf: (i) => str(i, "format") !== "ebook" },
    { id: "plan", kind: "segmented", label: "eBook royalty option", section: "sale", options: [{ value: "70", label: "70%" }, { value: "35", label: "35%" }], showIf: (i) => str(i, "format") === "ebook" },
    { id: "delivery", kind: "money", label: "Delivery cost per copy", section: "options", help: "KDP says it averages $0.06; bigger files cost more.", showIf: (i) => str(i, "format") === "ebook" && str(i, "plan", "70") === "70" },
  ],
  defaults: () => ({ price: 14.99, format: "paperback", pages: 300, ink: "black", large: false, expanded: false, plan: "70", delivery: 0.06 }),
  calculate,
  breakpoints: (i, m) => (str(i, "format") === "ebook" ? [2.99, 12.99] : [(KDP[m.id] ?? KDP.us).at60 / 100]),
  verifiedAt: CHECKED,
  sources,
  changes: [],
  schedule: (m) => {
    const k = KDP[m.id] ?? KDP.us;
    const money = moneyFor(m);
    return [
      { fee: "Paperback royalty", amount: `60% of list price at ${money(k.at60)}+, 50% below`, appliesTo: "List price, minus printing", source: "kdp-pb-royalty" },
      { fee: "Expanded Distribution", amount: "40%", appliesTo: "List price, minus printing", source: "kdp-pb-royalty" },
      { fee: "Printing · black ink", amount: `${money(k.black.flat[0])} flat up to 110 pages; then ${money(k.black.fixed)} + ${(k.black.page[0] / 100).toFixed(3)} ${m.currency} per page`, appliesTo: "Each copy (regular trim)", source: "kdp-print" },
      { fee: "eBook 70% option", amount: "70% of (list − delivery)", appliesTo: "Amazon.com list price $2.99–$12.99", source: "kdp-ebook-price" },
      { fee: "eBook 35% option", amount: "35% of list price", appliesTo: "Any allowed price", source: "kdp-ebook" },
    ];
  },
};
export default def;
