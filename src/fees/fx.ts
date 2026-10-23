import type { CurrencyCode } from "./types";
import { roundCents } from "./money";

/*
 * Reference exchange rates, used only where a platform charges a fixed amount in US dollars to a
 * shop or account in another currency (Etsy's US$0.20 listing fee, its US$100 Offsite Ads cap,
 * Payoneer-based fees). Platforms convert at their own rate on the day, so these conversions are
 * labelled as approximate wherever they appear.
 *
 * Source: European Central Bank euro foreign exchange reference rates, 2026-10-22
 * (https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml), converted to "per US dollar".
 */
export const FX_DATE = "2026-10-22";
export const FX_SOURCE = "https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html";

const ECB_PER_EUR: Record<string, number> = {
  USD: 1.1205,
  GBP: 0.8377,
  CAD: 1.5725,
  AUD: 1.598,
  NZD: 1.9724,
  INR: 106.249,
  MXN: 21.0215,
  CHF: 0.9211,
  SEK: 11.112,
  DKK: 7.4747,
  NOK: 10.488,
  PLN: 4.3695,
  JPY: 175.97,
  EUR: 1,
};

/** Units of `currency` per 1 US dollar. */
export function perUsd(currency: CurrencyCode): number {
  const c = ECB_PER_EUR[currency];
  if (!c) throw new Error(`no reference rate for ${currency}`);
  return c / ECB_PER_EUR.USD;
}

/** Convert a US-dollar amount in cents to the target currency's cents (approximate). */
export function fromUsd(usdCents: number, currency: CurrencyCode): number {
  return currency === "USD" ? usdCents : roundCents(usdCents * perUsd(currency));
}
