/*
 * Twitch Bits. Twitch Partners page (checked 2026-10-24): streamers get "a share of the revenue Twitch
 * receives from Bits equal to 1 cent per Bit used to Cheer for them". Bits prices (twitch.tv/bits,
 * US web): 100 for $1.40, 500 $7.00, 1,500 $19.95, 5,000 $64.40, 10,000 $126.00, 25,000 $308.00.
 */
import { M } from "../markets";
import { assemble, moneyFor, num, str, toCents } from "../money";
import type { CalculatorDef, Inputs, Market } from "../types";
import { CHECKED, src } from "./_kit";

const sources = [src("tw-partners", "Twitch Partners", "https://www.twitch.tv/p/en/partners/", "Twitch"), src("tw-bits", "Purchase Bits", "https://www.twitch.tv/bits", "Twitch")];
export const PACKS: [bits: number, cents: number][] = [[100, 140], [500, 700], [1500, 1995], [5000, 6440], [10000, 12600], [25000, 30800]];

/** What viewers paid for this many Bits, at the per-Bit price of the pack size given. */
function viewerCost(bits: number, pack: string): number {
  const p = PACKS.find(([b]) => String(b) === pack) ?? PACKS[0];
  return Math.round((bits * p[1]) / p[0]);
}

function calculate(inputs: Inputs, market: Market) {
  const money = moneyFor(market);
  const bits = str(inputs, "know", "bits") === "bits" ? Math.max(0, Math.round(num(inputs, "bits"))) : Math.round((toCents(num(inputs, "spend")) * PACKS[0][0]) / PACKS[0][1]);
  const pack = str(inputs, "pack", "100");
  const paid = str(inputs, "know", "bits") === "bits" ? viewerCost(bits, pack) : toCents(num(inputs, "spend"));
  const you = bits; // 1 cent per Bit
  const notes = bits > 0 ? [`${bits.toLocaleString("en-US")} Bits = ${money(you)} to you. Viewers paid about ${money(paid)} for them, depending on the pack size they bought.`, "Bits used in Extensions are shared with the Extension’s developer, so you receive less than 1 cent each on those."] : [];
  return assemble({ market, buyerPays: paid, saleAmount: paid, fees: [{ id: "twitch", label: "Twitch keeps (pack price − 1¢ per Bit)", amount: Math.max(0, paid - you), kind: "platform", detail: `${money(paid)} paid − ${bits.toLocaleString("en-US")} × $0.01`, explain: "Twitch pays streamers 1 cent per Bit cheered in their channel; the rest of what viewers paid for the Bits stays with Twitch (and app stores on mobile).", source: "tw-partners" }], notes, payout: you });
}

const def: CalculatorDef = {
  slug: "twitch-bits",
  name: "Twitch Bits",
  path: "/twitch-bits-calculator",
  category: "creators",
  priceNoun: "amount viewers spent",
  sellerNoun: "streamer",
  saleNoun: "Bits",
  buyerNoun: "viewers",
  blurb: "1 cent per Bit to the streamer; viewers pay $1.40 per 100 Bits",
  keepHead: "You receive",
  modes: false,
  markets: [M.us],
  defaultMarket: "us",
  priceField: "spend",
  fields: [
    { id: "know", kind: "segmented", label: "I know…", section: "sale", options: [{ value: "bits", label: "The Bits" }, { value: "dollars", label: "What viewers spent" }] },
    { id: "bits", kind: "number", label: "Bits cheered", section: "sale", min: 0, integer: true, showIf: (i) => str(i, "know", "bits") === "bits" },
    { id: "spend", kind: "money", label: "Viewers spent on Bits", section: "sale", showIf: (i) => str(i, "know", "bits") !== "bits" },
    { id: "pack", kind: "select", label: "Pack size viewers bought", section: "options", options: PACKS.map(([b, c]) => ({ value: String(b), label: `${b.toLocaleString("en-US")} Bits`, hint: `$${(c / 100).toFixed(2)}` })), showIf: (i) => str(i, "know", "bits") === "bits" },
  ],
  defaults: () => ({ know: "bits", bits: 1000, spend: 14, pack: "100" }),
  calculate,
  breakpoints: () => [],
  verifiedAt: CHECKED,
  sources,
  changes: [],
  schedule: () => [{ fee: "Streamer share", amount: "$0.01 per Bit", appliesTo: "Bits cheered in your channel", source: "tw-partners" }, ...PACKS.map(([b, c]) => ({ fee: `${b.toLocaleString("en-US")} Bits`, amount: `$${(c / 100).toFixed(2)}`, appliesTo: "Viewer price (US web)", source: "tw-bits" }))],
};
export default def;
