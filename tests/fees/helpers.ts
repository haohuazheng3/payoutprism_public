import type { CalculatorDef, Inputs, Result } from "@/fees/types";
import { pickMarket } from "@/fees/markets";

/** Run a calculator with the market defaults plus overrides. */
export function run(def: CalculatorDef, market: string, overrides: Partial<Inputs> = {}): Result {
  const m = pickMarket(def.markets, market, def.defaultMarket);
  return def.calculate({ ...def.defaults(m), ...overrides } as Inputs, m);
}

export function line(r: Result, id: string): number {
  const l = r.fees.find((x) => x.id === id);
  if (!l) throw new Error(`no line ${id} in ${r.fees.map((x) => x.id).join(",")}`);
  return l.amount;
}

/** Every module must satisfy these structural rules. */
export function checkContract(def: CalculatorDef) {
  const problems: string[] = [];
  for (const m of def.markets) {
    const d = def.defaults(m);
    for (const f of def.fields) if (!(f.id in d)) problems.push(`${m.id}: default missing for ${f.id}`);
    if (!def.fields.some((f) => f.id === def.priceField && f.kind === "money")) problems.push("priceField is not a money field");
    const r = def.calculate(d, m);
    if (r.currency !== m.currency) problems.push(`${m.id}: result currency ${r.currency}`);
    if (!Number.isInteger(r.payout) || !Number.isInteger(r.totalFees)) problems.push(`${m.id}: non-integer cents`);
    for (const l of r.fees) {
      if (!Number.isInteger(l.amount)) problems.push(`${m.id}: line ${l.id} not integer cents`);
      if (l.source && !def.sources.some((s) => s.id === l.source)) problems.push(`${m.id}: line ${l.id} cites unknown source ${l.source}`);
    }
    if (r.payout !== r.saleAmount - r.totalFees && !r.buyerFees.length) {
      // Allowed only when a module sets payout explicitly; flag for review.
      problems.push(`${m.id}: payout ${r.payout} ≠ sale ${r.saleAmount} − fees ${r.totalFees}`);
    }
    for (const row of def.schedule(m)) if (row.source && !def.sources.some((s) => s.id === row.source)) problems.push(`${m.id}: schedule row ${row.fee} cites unknown source`);
  }
  for (const c of def.changes) if (c.source && !def.sources.some((s) => s.id === c.source)) problems.push(`change ${c.date} cites unknown source`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(def.verifiedAt)) problems.push("verifiedAt is not an ISO date");
  return problems;
}
