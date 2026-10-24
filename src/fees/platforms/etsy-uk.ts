/* UK twin of the Etsy calculator: the same engine and sources, opened on the UK market (GBP, UK rules). hreflang pairs it with the US page (src/lib/hreflang.ts). */
import { M } from "../markets";
import type { CalculatorDef } from "../types";
import base from "./etsy";

const def: CalculatorDef = {
  ...base,
  slug: "etsy-uk",
  name: "Etsy UK",
  path: "/etsy-fees-uk",
  blurb: "Listing, 6.5% transaction, 4% + 20p processing and a 0.48% regulatory fee, plus VAT",
  markets: [M.uk],
  defaultMarket: "uk",
  compare: undefined,
};
export default def;
