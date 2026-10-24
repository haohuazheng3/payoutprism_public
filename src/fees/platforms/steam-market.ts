/*
 * Steam Community Market. Steam Support "Community Market FAQ", checked 2026-10-24: Steam Transaction
 * Fee "currently 5% (with a minimum fee of $0.01)", paid by the buyer, "calculated based on the item
 * cost"; game fees (TF2, Dota 2, CS2, Artifact) "currently set at 10%". The buyer pays: what the
 * seller receives + both fees. Each fee is rounded to the cent here (Steam doesn't publish its
 * rounding; listings can differ by a cent).
 */
import { M } from "../markets";
import { assemble, moneyFor, num, pct, str, toCents } from "../money";
import type { CalculatorDef, Inputs, Market } from "../types";
import { CHECKED, src } from "./_kit";

const sources = [src("steam-faq", "Community Market FAQ", "https://help.steampowered.com/en/faqs/view/61F0-72B7-9A18-C70B", "Steam Support")];

export function steamFees(receive: number, gameRate: number) {
  const steam = Math.max(1, pct(receive, 5));
  const game = gameRate ? Math.max(1, pct(receive, gameRate)) : 0;
  return { steam, game, buyer: receive + steam + game };
}

/** The most the seller can receive for a given buyer price. */
export function receiveFor(buyer: number, gameRate: number): number {
  let r = Math.floor(buyer / (1 + (5 + gameRate) / 100));
  while (r > 0 && steamFees(r + 1, gameRate).buyer <= buyer) r++;
  while (r > 0 && steamFees(r, gameRate).buyer > buyer) r--;
  return r;
}

function calculate(inputs: Inputs, market: Market) {
  const money = moneyFor(market);
  const gameRate = str(inputs, "game", "valve") === "valve" ? 10 : Math.max(0, Math.min(30, num(inputs, "gameRate", 10)));
  const knowBuyer = str(inputs, "know", "buyer") === "buyer";
  const receive = knowBuyer ? receiveFor(toCents(num(inputs, "price")), gameRate) : toCents(num(inputs, "receive"));
  const f = steamFees(receive, gameRate);
  const fees = [
    { id: "steam", label: "Steam Transaction Fee (5%)", amount: receive ? f.steam : 0, kind: "platform" as const, detail: `5% × ${money(receive)}, min $0.01`, explain: "Steam’s own fee, 5% of the amount the seller receives (at least $0.01). The buyer pays it on top.", source: "steam-faq" },
    ...(gameRate ? [{ id: "game", label: `Game fee (${gameRate}%)`, amount: receive ? f.game : 0, kind: "platform" as const, detail: `${gameRate}% × ${money(receive)}`, explain: "A fee set and collected by the game’s publisher: 10% for Team Fortress 2, Dota 2, Counter-Strike 2 and Artifact.", source: "steam-faq" }] : []),
  ];
  const buyer = receive ? f.buyer : 0;
  return assemble({ market, buyerPays: buyer, saleAmount: buyer, fees, notes: receive > 0 ? [`The buyer pays ${money(buyer)}; you receive ${money(receive)} in your Steam Wallet. That’s about ${((1 - receive / buyer) * 100).toFixed(1)}% off the listed price: the “Steam tax”.`, "Market sales pay into your Steam Wallet, not your bank."] : [] });
}

const def: CalculatorDef = {
  slug: "steam-market",
  name: "Steam Market",
  path: "/steam-market-fee-calculator",
  category: "marketplaces",
  priceNoun: "buyer price",
  sellerNoun: "seller",
  buyerNoun: "buyer",
  blurb: "5% Steam fee + 10% game fee on top of what you receive (about 13% of the listed price)",
  keepHead: "You receive",
  markets: [M.us],
  defaultMarket: "us",
  priceField: "price",
  fields: [
    { id: "know", kind: "segmented", label: "I know…", section: "sale", options: [{ value: "buyer", label: "What the buyer pays" }, { value: "receive", label: "What I want to receive" }] },
    { id: "price", kind: "money", label: "Buyer pays", section: "sale", showIf: (i) => str(i, "know", "buyer") === "buyer" },
    { id: "receive", kind: "money", label: "You receive", section: "sale", showIf: (i) => str(i, "know", "buyer") !== "buyer" },
    { id: "game", kind: "segmented", label: "Game fee", section: "options", options: [{ value: "valve", label: "CS2 / Dota 2 / TF2 · 10%" }, { value: "other", label: "Another game" }] },
    { id: "gameRate", kind: "percent", label: "That game’s fee", section: "options", max: 30, step: 0.5, showIf: (i) => str(i, "game") === "other" },
  ],
  defaults: () => ({ know: "buyer", price: 10, receive: 8.7, game: "valve", gameRate: 10 }),
  calculate,
  breakpoints: () => [],
  verifiedAt: CHECKED,
  sources,
  changes: [],
  schedule: () => [{ fee: "Steam Transaction Fee", amount: "5%, min $0.01", appliesTo: "Amount the seller receives", when: "Paid by the buyer", source: "steam-faq" }, { fee: "Game fee (TF2, Dota 2, CS2, Artifact)", amount: "10%", appliesTo: "Amount the seller receives", when: "Set by the publisher", source: "steam-faq" }],
};
export default def;
