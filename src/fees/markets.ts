import type { Market } from "./types";

/** Markets shared across calculators. Modules pick the subset their official pages cover. */
export const M = {
  us: { id: "us", label: "United States", currency: "USD", locale: "en-US", flag: "🇺🇸" },
  uk: { id: "uk", label: "United Kingdom", currency: "GBP", locale: "en-GB", flag: "🇬🇧" },
  ca: { id: "ca", label: "Canada", currency: "CAD", locale: "en-CA", flag: "🇨🇦" },
  au: { id: "au", label: "Australia", currency: "AUD", locale: "en-AU", flag: "🇦🇺" },
  nz: { id: "nz", label: "New Zealand", currency: "NZD", locale: "en-NZ", flag: "🇳🇿" },
  ie: { id: "ie", label: "Ireland", currency: "EUR", locale: "en-IE", flag: "🇮🇪" },
  de: { id: "de", label: "Germany", currency: "EUR", locale: "de-DE", flag: "🇩🇪" },
  fr: { id: "fr", label: "France", currency: "EUR", locale: "fr-FR", flag: "🇫🇷" },
  it: { id: "it", label: "Italy", currency: "EUR", locale: "it-IT", flag: "🇮🇹" },
  es: { id: "es", label: "Spain", currency: "EUR", locale: "es-ES", flag: "🇪🇸" },
  nl: { id: "nl", label: "Netherlands", currency: "EUR", locale: "nl-NL", flag: "🇳🇱" },
  be: { id: "be", label: "Belgium", currency: "EUR", locale: "nl-BE", flag: "🇧🇪" },
  at: { id: "at", label: "Austria", currency: "EUR", locale: "de-AT", flag: "🇦🇹" },
  pt: { id: "pt", label: "Portugal", currency: "EUR", locale: "pt-PT", flag: "🇵🇹" },
  fi: { id: "fi", label: "Finland", currency: "EUR", locale: "fi-FI", flag: "🇫🇮" },
  gr: { id: "gr", label: "Greece", currency: "EUR", locale: "el-GR", flag: "🇬🇷" },
  in: { id: "in", label: "India", currency: "INR", locale: "en-IN", flag: "🇮🇳" },
  mx: { id: "mx", label: "Mexico", currency: "MXN", locale: "es-MX", flag: "🇲🇽" },
  ch: { id: "ch", label: "Switzerland", currency: "CHF", locale: "de-CH", flag: "🇨🇭" },
  se: { id: "se", label: "Sweden", currency: "SEK", locale: "sv-SE", flag: "🇸🇪" },
  dk: { id: "dk", label: "Denmark", currency: "DKK", locale: "da-DK", flag: "🇩🇰" },
  no: { id: "no", label: "Norway", currency: "NOK", locale: "nb-NO", flag: "🇳🇴" },
  pl: { id: "pl", label: "Poland", currency: "PLN", locale: "pl-PL", flag: "🇵🇱" },
} as const satisfies Record<string, Market>;

export function pickMarket(markets: Market[], id: string | null | undefined, fallback: string): Market {
  return markets.find((m) => m.id === id) ?? markets.find((m) => m.id === fallback) ?? markets[0];
}
