import { toCents } from "./money";
import type { CalculatorDef, Inputs, Market, Result } from "./types";

/*
 * Reverse mode: "what price do I need to keep $X?" Fee formulas are piecewise linear in the
 * price with a slope below 1 (percentages under 100 %), so the seller's take is non-decreasing
 * between the module's breakpoints and may only drop AT a breakpoint (a flat fee turning into a
 * percentage, a tier edge). We scan the intervals in ascending order and binary-search the first
 * one that can reach the target, which yields the true minimum price even across such drops.
 */

export type Target = "payout" | "profit" | "margin";

export interface SolveResult {
  /** Price in cents, or null when no price up to the search ceiling reaches the target. */
  price: number | null;
  result: Result | null;
}

const CEILING = 100_000_000; // $1,000,000.00 in cents

function metric(r: Result, target: Target): number {
  if (target === "payout") return r.payout;
  if (target === "profit") return r.profit ?? r.payout;
  return r.margin ?? (r.saleAmount ? r.payout / r.saleAmount : 0);
}

export function solvePrice(def: CalculatorDef, inputs: Inputs, market: Market, target: Target, goal: number): SolveResult {
  const evalAt = (cents: number) => def.calculate({ ...inputs, [def.priceField]: cents / 100 }, market);
  const reaches = (cents: number) => metric(evalAt(cents), target) >= goal - 1e-9;

  const bps = (def.breakpoints?.(inputs, market) ?? []).filter((b) => b > 0 && b < CEILING).sort((a, b) => a - b);
  // Interval edges: [0, bp1), [bp1, bp2), … [bpN, CEILING]
  const edges = [0, ...Array.from(new Set(bps)), CEILING + 1];
  for (let i = 0; i < edges.length - 1; i++) {
    const lo0 = edges[i];
    const hi0 = edges[i + 1] - 1; // last cent inside the interval
    if (hi0 < lo0) continue;
    if (!reaches(hi0)) continue;
    let lo = lo0;
    let hi = hi0;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (reaches(mid)) hi = mid;
      else lo = mid + 1;
    }
    return { price: lo, result: evalAt(lo) };
  }
  return { price: null, result: null };
}

/** Convenience for UIs that hold the goal as a decimal amount (or a percentage for margin). */
export function solveFromInput(def: CalculatorDef, inputs: Inputs, market: Market, target: Target, typed: number): SolveResult {
  const goal = target === "margin" ? typed / 100 : toCents(typed);
  return solvePrice(def, inputs, market, target, goal);
}
