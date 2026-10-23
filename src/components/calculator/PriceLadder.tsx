"use client";

import { useMemo } from "react";
import type { CalculatorDef, Inputs, Market } from "@/fees/types";
import { formatMoney, toCents } from "@/fees/money";

/** A sensible step for "nearby prices": sellers think in round numbers that grow with the price. */
export function ladderStep(cents: number): number {
  const d = cents / 100;
  if (d < 10) return 100;
  if (d < 30) return 200;
  if (d < 100) return 500;
  if (d < 300) return 2500;
  if (d < 1000) return 5000;
  if (d < 5000) return 25000;
  return 100000;
}

export function ladderPrices(cents: number): number[] {
  const step = ladderStep(cents);
  const base = Math.max(step, Math.round(cents / step) * step);
  const set = new Set<number>([cents]);
  for (let k = -3; k <= 3; k++) {
    const p = base + k * step;
    if (p > 0) set.add(p);
  }
  return [...set].sort((a, b) => a - b).slice(0, 8);
}

/**
 * "What if I priced it a little higher or lower?" The same settings at nearby prices,
 * so a seller can see how the payout moves (flat fees weigh more on cheap items).
 */
export function PriceLadder({ def, inputs, market, onPick }: { def: CalculatorDef; inputs: Inputs; market: Market; onPick: (price: number) => void }) {
  const current = toCents(inputs[def.priceField]);
  const rows = useMemo(() => {
    if (current <= 0) return [];
    return ladderPrices(current).map((p) => {
      const r = def.calculate({ ...inputs, [def.priceField]: p / 100 }, market);
      return { price: p, fees: r.totalFees, keep: r.profit ?? r.payout, rate: r.effectiveRate, profit: r.profit !== null };
    });
  }, [current, def, inputs, market]);
  if (!rows.length) return null;
  const money = (c: number) => formatMoney(c, market.currency, market.locale);
  const showsProfit = rows[0]?.profit;
  return (
    <div className="float mt-5 p-5 sm:p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[1rem] font-[620] text-ink">Nearby prices</h2>
        <span className="text-[0.8rem] text-ink-3">Tap a row to use it</span>
      </div>
      <table className="data-table mt-2 !text-[0.9rem]">
        <thead>
          <tr>
            <th className="!px-2">Price</th>
            <th className="num !px-2">Fees</th>
            <th className="num !px-2">{showsProfit ? "Profit" : "You keep"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const here = r.price === current;
            return (
              <tr
                key={r.price}
                className={`cursor-pointer transition-colors ${here ? "bg-keep-soft" : "hover:bg-card-2"}`}
                onClick={() => !here && onPick(r.price / 100)}
                aria-current={here ? "true" : undefined}
              >
                <td className="!px-2 tnum">
                  <button type="button" className="font-[560]" onClick={(e) => { e.stopPropagation(); if (!here) onPick(r.price / 100); }}>
                    {money(r.price)}
                  </button>
                  {here && <span className="ml-2 text-[0.72rem] font-[600] uppercase tracking-wide text-keep-text">now</span>}
                </td>
                <td className="num !px-2">
                  {money(r.fees)} <span className="text-[0.76rem] text-ink-4">{(r.rate * 100).toFixed(1)}%</span>
                </td>
                <td className={`num !px-2 font-[600] ${r.keep < 0 ? "text-bad" : "text-ink"}`}>{money(r.keep)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
