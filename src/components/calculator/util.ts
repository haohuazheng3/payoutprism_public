import type { CalculatorDef, FieldDef, Inputs, InputValue, LineKind, Market } from "@/fees/types";
import { encodeStateQuery } from "@/fees/url";
import { currencySymbolFor } from "@/fees/money";

/** The spectrum: one color per kind of deduction, plus "you keep". */
export const KIND_COLOR: Record<LineKind | "keep" | "profit", string> = {
  keep: "var(--keep)",
  profit: "var(--keep)",
  payout: "var(--payout)",
  platform: "var(--platform)",
  payment: "var(--payment)",
  ads: "var(--ads)",
  shipping: "var(--shipping)",
  subscription: "var(--subscription)",
  tax: "var(--tax)",
  other: "var(--subscription)",
  cost: "var(--cost)",
};

export const KIND_LABEL: Record<LineKind, string> = {
  platform: "Platform fees",
  payment: "Payment processing",
  ads: "Advertising",
  shipping: "Shipping",
  subscription: "Subscription",
  tax: "Tax",
  payout: "Payout fees",
  other: "Other fees",
  cost: "Your costs",
};

/**
 * Parse what someone typed into a number. Accepts "1,234.50", "1234,5" (decimal comma),
 * "$12", " 12 ". Returns null for empty input so fields can be cleared while typing.
 */
export function parseAmount(raw: string): number | null {
  let s = raw.replace(/[\s$£€₹¥%]/g, "").replace(/[A-Za-z]/g, "");
  if (s === "" || s === "-" || s === "." || s === ",") return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    // The later separator is the decimal one.
    if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (lastComma > -1) {
    const decimals = s.length - lastComma - 1;
    s = decimals > 0 && decimals <= 2 && s.indexOf(",") === lastComma ? s.replace(",", ".") : s.replace(/,/g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** "24.5" → "24.50" for money fields when the field loses focus. */
export function tidyMoney(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

export function currencySymbol(market: Market): string {
  return currencySymbolFor(market.currency, market.locale);
}

export function fieldHelp(f: FieldDef, inputs: Inputs, market: Market): string | undefined {
  return typeof f.help === "function" ? f.help(inputs, market) : f.help;
}

const SALE_NOUN: Record<CalculatorDef["category"], string> = {
  marketplaces: "sale",
  payments: "payment",
  freelance: "contract",
  rentals: "booking",
  creators: "sale",
  fundraising: "campaign",
};

export function saleNoun(def: CalculatorDef): string {
  return def.saleNoun ?? SALE_NOUN[def.category];
}

const BUYER_NOUN: Record<CalculatorDef["category"], string> = {
  marketplaces: "buyer",
  payments: "payer",
  freelance: "client",
  rentals: "guest",
  creators: "buyer",
  fundraising: "donor",
};

export function buyerNoun(def: CalculatorDef): string {
  return def.buyerNoun ?? BUYER_NOUN[def.category];
}

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function fieldOptions(f: FieldDef, inputs: Inputs, market: Market) {
  if (f.kind !== "select" && f.kind !== "segmented") return [];
  return typeof f.options === "function" ? f.options(inputs, market) : f.options;
}

export function visibleFields(def: CalculatorDef, inputs: Inputs, market: Market): FieldDef[] {
  return def.fields.filter((f) => !f.showIf || f.showIf(inputs, market));
}

/* ---------------- URL state: only what differs from the market defaults travels ---------------- */

export function encodeState(def: CalculatorDef, market: Market, inputs: Inputs, extra: Record<string, string>): string {
  return encodeStateQuery(def, market, inputs, extra);
}

export function decodeState(def: CalculatorDef, search: string): { market: string | null; inputs: Partial<Inputs>; extra: Record<string, string> } {
  const q = new URLSearchParams(search);
  const inputs: Partial<Inputs> = {};
  for (const f of def.fields) {
    const raw = q.get(f.id);
    if (raw === null) continue;
    let v: InputValue;
    if (f.kind === "toggle") v = raw === "1" || raw === "true";
    else if (f.kind === "select" || f.kind === "segmented") v = raw.slice(0, 80);
    else {
      const n = parseAmount(raw);
      if (n === null) continue;
      v = n;
    }
    inputs[f.id] = v;
  }
  const extra: Record<string, string> = {};
  for (const k of ["mode", "target", "goal"]) {
    const v = q.get(k);
    if (v) extra[k] = v.slice(0, 40);
  }
  return { market: q.get("market"), inputs, extra };
}
