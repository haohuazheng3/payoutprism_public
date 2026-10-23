import type { CalculatorDef, FieldDef, Inputs, InputValue, LineKind, Market } from "@/fees/types";
import { encodeStateQuery } from "@/fees/url";

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
  const parts = new Intl.NumberFormat(market.locale, { style: "currency", currency: market.currency }).formatToParts(0);
  return parts.find((p) => p.type === "currency")?.value ?? market.currency;
}

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
