/* UK twin of the PayPal calculator: the same engine and sources, opened on the UK market (GBP, UK rules). hreflang pairs it with the US page (src/lib/hreflang.ts). */
import { M } from "../markets";
import type { CalculatorDef } from "../types";
import base from "./paypal";

const def: CalculatorDef = {
  ...base,
  slug: "paypal-uk",
  name: "PayPal UK",
  path: "/paypal-fee-calculator-uk",
  blurb: "2.9% + 30p to receive a UK goods and services payment; more from abroad",
  markets: [M.uk],
  defaultMarket: "uk",
  compare: undefined,
};
export default def;
