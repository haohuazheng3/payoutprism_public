/* UK twin of the eBay calculator: the same engine and sources, opened on the UK market (GBP, UK rules). hreflang pairs it with the US page (src/lib/hreflang.ts). */
import { M } from "../markets";
import type { CalculatorDef } from "../types";
import base from "./ebay";

const def: CalculatorDef = {
  ...base,
  slug: "ebay-uk",
  name: "eBay UK",
  path: "/ebay-fee-calculator-uk",
  blurb: "Private sellers pay no final value fee; business sellers pay by category, plus VAT",
  markets: [M.uk],
  defaultMarket: "uk",
  compare: undefined,
};
export default def;
