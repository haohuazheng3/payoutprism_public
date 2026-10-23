import type { CurrencyCode, Inputs, Line, Market, Result } from "./types";

/*
 * Money helpers. Everything is integer cents; rounding happens exactly once per fee line,
 * half away from zero to the cent, which is how platforms present each line on a statement.
 */

/** Round half away from zero, guarding against binary noise such as 1.005 * 100 = 100.49999. */
export function roundCents(value: number): number {
  const cleaned = Math.round(value * 1e6) / 1e6;
  return cleaned < 0 ? -Math.round(-cleaned) : Math.round(cleaned);
}

/** A decimal amount someone typed ("24.99") → cents (2499). Non-finite or negative → 0 unless allowed. */
export function toCents(amount: unknown, allowNegative = false): number {
  const n = typeof amount === "number" ? amount : typeof amount === "string" ? Number(amount) : NaN;
  if (!Number.isFinite(n)) return 0;
  const c = roundCents(n * 100);
  return allowNegative ? c : Math.max(0, c);
}

/** `rate` is a percentage (6.5 means 6.5 %). */
export function pct(baseCents: number, rate: number): number {
  return roundCents((baseCents * rate) / 100);
}

/** Clamp a fee between an optional minimum and maximum (cents). */
export function clamp(cents: number, min?: number, max?: number): number {
  let v = cents;
  if (min !== undefined) v = Math.max(min, v);
  if (max !== undefined) v = Math.min(max, v);
  return v;
}

export function num(inputs: Inputs, id: string, fallback = 0): number {
  const v = inputs[id];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return fallback;
}

export function str(inputs: Inputs, id: string, fallback = ""): string {
  const v = inputs[id];
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : fallback;
}

export function bool(inputs: Inputs, id: string): boolean {
  const v = inputs[id];
  return v === true || v === "true" || v === "1" || v === 1;
}

const formatters = new Map<string, Intl.NumberFormat>();

/**
 * The currency symbol to show. Canadian, Australian, New Zealand (…) dollars print as a bare "$"
 * in their own locales, which reads as US dollars next to USD figures: use the unambiguous
 * international form instead (CA$, A$, NZ$, MX$).
 */
const symbols = new Map<string, string>();

export function currencySymbolFor(currency: CurrencyCode, locale: string): string {
  const key = `${locale}|${currency}`;
  const hit = symbols.get(key);
  if (hit) return hit;
  let sym = new Intl.NumberFormat(locale, { style: "currency", currency }).formatToParts(0).find((p) => p.type === "currency")?.value ?? currency;
  if (sym === "$" && currency !== "USD") sym = new Intl.NumberFormat("en-US", { style: "currency", currency }).formatToParts(0).find((p) => p.type === "currency")?.value ?? currency;
  symbols.set(key, sym);
  return sym;
}

function formatter(currency: CurrencyCode, locale: string, whole: boolean): Intl.NumberFormat {
  const key = `${locale}|${currency}|${whole ? 0 : "d"}`;
  let f = formatters.get(key);
  if (!f) {
    // Default fraction digits come from the currency itself (2 for USD, 0 for JPY).
    f = new Intl.NumberFormat(locale, { style: "currency", currency, ...(whole ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : {}) });
    formatters.set(key, f);
  }
  return f;
}

/** Formatted parts with the unambiguous symbol, for components that style each part. */
export function moneyParts(cents: number, currency: CurrencyCode, locale = "en-US"): Intl.NumberFormatPart[] {
  const sym = currencySymbolFor(currency, locale);
  return formatter(currency, locale, false)
    .formatToParts(Math.abs(cents) / 100)
    .map((p) => (p.type === "currency" ? { ...p, value: sym } : p));
}

export function formatMoney(cents: number, currency: CurrencyCode, locale = "en-US", opts: { sign?: boolean; whole?: boolean } = {}): string {
  const sym = currencySymbolFor(currency, locale);
  const s = formatter(currency, locale, Boolean(opts.whole))
    .formatToParts(Math.abs(cents) / 100)
    .map((p) => (p.type === "currency" ? sym : p.value))
    .join("");
  if (cents < 0) return `−${s}`;
  return opts.sign && cents > 0 ? `+${s}` : s;
}

/** "6.5%" / "2.35%" / "15%": trims trailing zeros, keeps up to 3 decimals. */
export function formatRate(rate: number): string {
  return `${Number(rate.toFixed(3))}%`;
}

export function formatPercentOf(part: number, whole: number): string {
  if (!whole) return "0%";
  const p = (part / whole) * 100;
  return `${p >= 10 || p === 0 ? p.toFixed(1) : p.toFixed(2)}%`;
}

/** A money formatter bound to one market, for building line details inside modules. */
export function moneyFor(market: Market) {
  return (cents: number) => formatMoney(cents, market.currency, market.locale);
}

export interface Assembly {
  market: Market;
  buyerPays: number;
  saleAmount: number;
  fees: Line[];
  buyerFees?: Line[];
  costs?: Line[];
  /** Override the payout when the platform pays out something other than sale − fees (e.g. buyer fees collected on top). */
  payout?: number;
  notes?: string[];
  warnings?: string[];
}

/**
 * Turn the lines a module computed into a `Result`: totals, payout, profit, margin and the
 * standard warnings. Zero-amount lines are kept only when they carry an explanation worth
 * showing (e.g. "Offsite Ads: not charged on this order").
 */
export function assemble(a: Assembly): Result {
  const fees = a.fees.filter((l) => l.amount !== 0 || l.explain);
  const costs = (a.costs ?? []).filter((l) => l.amount !== 0);
  const totalFees = fees.reduce((s, l) => s + l.amount, 0);
  const totalCosts = costs.reduce((s, l) => s + l.amount, 0);
  const payout = a.payout ?? a.saleAmount - totalFees;
  const profit = costs.length ? payout - totalCosts : null;
  const margin = profit !== null && a.saleAmount > 0 ? profit / a.saleAmount : null;
  const warnings = [...(a.warnings ?? [])];
  const money = moneyFor(a.market);
  if (a.saleAmount > 0 && payout <= 0) warnings.push(`Fees take the whole sale: you would receive ${money(payout)}.`);
  else if (profit !== null && profit < 0) warnings.push(`This sale loses ${money(-profit)} once your costs are counted.`);
  return {
    currency: a.market.currency,
    buyerPays: a.buyerPays,
    saleAmount: a.saleAmount,
    fees,
    buyerFees: (a.buyerFees ?? []).filter((l) => l.amount !== 0),
    totalFees,
    payout,
    costs,
    totalCosts,
    profit,
    margin,
    effectiveRate: a.saleAmount > 0 ? totalFees / a.saleAmount : 0,
    notes: a.notes ?? [],
    warnings,
  };
}

/** Standard "your costs" lines most marketplace calculators share. */
export function costLines(inputs: Inputs, market: Market, ids: { item?: string; label?: string; other?: string } = {}): Line[] {
  const out: Line[] = [];
  const item = toCents(num(inputs, ids.item ?? "itemCost"));
  const label = toCents(num(inputs, ids.label ?? "shippingCost"));
  const other = toCents(num(inputs, ids.other ?? "otherCost"));
  if (item) out.push({ id: "itemCost", label: "What you paid for the item", amount: item, kind: "cost" });
  if (label) out.push({ id: "shippingCost", label: "Shipping label / postage", amount: label, kind: "cost" });
  if (other) out.push({ id: "otherCost", label: "Packaging & other costs", amount: other, kind: "cost" });
  void market;
  return out;
}
