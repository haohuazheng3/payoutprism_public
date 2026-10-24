/* UK twin of the Stripe calculator: the same engine and sources, opened on the UK market (GBP, UK rules). hreflang pairs it with the US page (src/lib/hreflang.ts). */
import { M } from "../markets";
import type { CalculatorDef } from "../types";
import base from "./stripe";

const def: CalculatorDef = {
  ...base,
  slug: "stripe-uk",
  name: "Stripe UK",
  path: "/stripe-fees-uk",
  blurb: "1.5% + 20p for standard UK cards; premium, EEA and international cost more",
  markets: [M.uk],
  defaultMarket: "uk",
  compare: undefined,
};
export default def;
