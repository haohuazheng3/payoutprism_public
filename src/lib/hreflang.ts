/**
 * Regional twins: the US page and its UK counterpart describe different fee rules, so each gets
 * its own URL and they point at each other with hreflang (en-US / en-GB, US as x-default).
 */
const PAIRS: [us: string, uk: string][] = [
  ["/ebay-fee-calculator", "/ebay-fee-calculator-uk"],
  ["/paypal-fee-calculator", "/paypal-fee-calculator-uk"],
  ["/stripe-fee-calculator", "/stripe-fees-uk"],
  ["/etsy-fee-calculator", "/etsy-fees-uk"],
];

export function hreflangFor(path: string): Record<string, string> | undefined {
  const pair = PAIRS.find(([us, uk]) => us === path || uk === path);
  if (!pair) return undefined;
  return { "en-US": pair[0], "en-GB": pair[1], "x-default": pair[0] };
}
