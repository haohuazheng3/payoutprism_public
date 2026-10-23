import type { CalculatorDef, Inputs, Market } from "./types";

/** Query string that restores a calculation: only what differs from the market's defaults travels. */
export function encodeStateQuery(def: CalculatorDef, market: Market, inputs: Inputs, extra: Record<string, string> = {}): string {
  const d = def.defaults(market);
  const q = new URLSearchParams();
  if (market.id !== def.defaultMarket) q.set("market", market.id);
  for (const f of def.fields) {
    const v = inputs[f.id];
    if (v === undefined || v === d[f.id]) continue;
    q.set(f.id, typeof v === "boolean" ? (v ? "1" : "0") : String(v));
  }
  for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : "";
}
