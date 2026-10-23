import { pickMarket } from "./markets";
import { encodeStateQuery } from "./url";
import type { CalculatorDef, CompareInputs, Inputs } from "./types";

export interface CompareRow {
  slug: string;
  name: string;
  path: string;
  /** Link that opens the calculator with these numbers filled in. */
  href: string;
  note: string;
  currency: string;
  saleAmount: number;
  buyerPays: number;
  totalFees: number;
  payout: number;
  profit: number | null;
  effectiveRate: number;
  /** Cents by kind, for the mini spectrum bar. */
  byKind: Record<string, number>;
}

/** Run the same sale through every calculator in a compare group, best payout first. */
export function compareAll(defs: CalculatorDef[], group: "sell" | "pay", c: CompareInputs): CompareRow[] {
  const rows: CompareRow[] = [];
  for (const def of defs) {
    if (!def.compare || def.compare.group !== group) continue;
    const market = pickMarket(def.markets, def.defaultMarket, def.defaultMarket);
    const inputs = { ...def.defaults(market), ...def.compare.map(c) } as Inputs;
    const r = def.calculate(inputs, market);
    const byKind: Record<string, number> = {};
    for (const l of r.fees) if (l.amount > 0) byKind[l.kind] = (byKind[l.kind] ?? 0) + l.amount;
    rows.push({
      slug: def.slug,
      name: def.name,
      path: def.path,
      href: `${def.path}${encodeStateQuery(def, market, inputs)}`,
      note: def.compare.note,
      currency: r.currency,
      saleAmount: r.saleAmount,
      buyerPays: r.buyerPays,
      totalFees: r.totalFees,
      payout: r.payout,
      profit: r.profit,
      effectiveRate: r.effectiveRate,
      byKind,
    });
  }
  return rows.sort((a, b) => (b.profit ?? b.payout) - (a.profit ?? a.payout));
}
