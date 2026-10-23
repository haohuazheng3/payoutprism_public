"use client";

import { useState } from "react";
import type { CalculatorDef, Line, Market, Result } from "@/fees/types";
import { formatMoney, formatPercentOf, moneyParts } from "@/fees/money";
import { buyerNoun, cap, KIND_COLOR, KIND_LABEL } from "./util";

export function BigMoney({ cents, market, className = "" }: { cents: number; market: Market; className?: string }) {
  const parts = moneyParts(cents, market.currency, market.locale);
  return (
    <span className={`display tnum inline-flex items-baseline ${className}`} data-amount={formatMoney(cents, market.currency, market.locale)}>
      <span className="sr-only">{formatMoney(cents, market.currency, market.locale)}</span>
      {cents < 0 && <span aria-hidden>−</span>}
      {parts.map((p, i) =>
        p.type === "currency" ? (
          <span key={i} aria-hidden className="mr-[0.04em] text-[0.55em] font-normal text-ink-3">
            {p.value}
          </span>
        ) : p.type === "decimal" || p.type === "fraction" ? (
          <span key={i} aria-hidden className="text-[0.55em] text-ink-3">
            {p.value}
          </span>
        ) : p.type === "literal" ? null : (
          <span key={i} aria-hidden>
            {p.value}
          </span>
        ),
      )}
    </span>
  );
}

interface Segment {
  key: string;
  label: string;
  amount: number;
  color: string;
}

/** Where every cent of the sale goes, as one rounded bar with a legend. */
export function SpectrumBar({ result, market }: { result: Result; market: Market }) {
  const money = (c: number) => formatMoney(c, market.currency, market.locale);
  const byKind = new Map<string, Segment>();
  for (const l of result.fees) {
    if (l.amount <= 0) continue;
    const k = l.kind;
    const prev = byKind.get(k);
    byKind.set(k, { key: k, label: KIND_LABEL[k], amount: (prev?.amount ?? 0) + l.amount, color: KIND_COLOR[k] });
  }
  const segs: Segment[] = [];
  if (result.profit !== null) {
    if (result.totalCosts > 0) segs.push({ key: "cost", label: "Your costs", amount: Math.min(result.totalCosts, Math.max(0, result.payout)), color: KIND_COLOR.cost });
    if (result.profit > 0) segs.push({ key: "keep", label: "Profit", amount: result.profit, color: KIND_COLOR.keep });
  } else if (result.payout > 0) {
    segs.push({ key: "keep", label: "You keep", amount: result.payout, color: KIND_COLOR.keep });
  }
  segs.push(...[...byKind.values()].sort((a, b) => b.amount - a.amount));
  const total = Math.max(1, segs.reduce((s, x) => s + x.amount, 0));

  return (
    <div>
      <div className="flex h-3.5 w-full gap-[3px] overflow-hidden rounded-full" role="img" aria-label={segs.map((s) => `${s.label} ${money(s.amount)}`).join(", ")}>
        {segs.map((s) => (
          <div
            key={s.key}
            className="h-full rounded-full transition-[flex-grow] duration-300 ease-out"
            style={{ flexGrow: s.amount / total, flexBasis: 0, minWidth: 6, background: s.color }}
          />
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[0.8rem] text-ink-3">
        {segs.map((s) => (
          <li key={s.key} className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: s.color }} aria-hidden />
            <span className="text-ink-2">{s.label}</span>
            <span className="tnum">{formatPercentOf(s.amount, total)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LineRow({ line, market, sign = "−", sourceUrl }: { line: Line; market: Market; sign?: string; sourceUrl?: string }) {
  const [open, setOpen] = useState(false);
  const money = (c: number) => formatMoney(c, market.currency, market.locale);
  const canOpen = Boolean(line.explain || sourceUrl);
  return (
    <li className="py-2.5">
      <div className="flex items-start gap-3">
        <span className="mt-[7px] h-2 w-2 flex-none rounded-full" style={{ background: KIND_COLOR[line.kind] }} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            {canOpen ? (
              <button type="button" className="group min-w-0 text-left text-[0.95rem] font-[540] text-ink" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
                <span className="underline decoration-line-2 decoration-dotted underline-offset-4 group-hover:decoration-ink-3">{line.label}</span>
              </button>
            ) : (
              <span className="min-w-0 text-[0.95rem] font-[540] text-ink">{line.label}</span>
            )}
            <span className="tnum flex-none text-[0.95rem] font-[560] text-ink">
              {line.amount === 0 ? money(0) : line.amount < 0 ? `+${money(-line.amount)}` : `${sign}${money(line.amount)}`}
            </span>
          </div>
          {line.detail && <div className="tnum mt-0.5 text-[0.82rem] text-ink-3">{line.detail}</div>}
          {open && (
            <div className="mt-2 animate-fade rounded-[14px] bg-card-2 px-3 py-2.5 text-[0.86rem] leading-relaxed text-ink-2">
              {line.explain}
              {sourceUrl && (
                <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="link ml-1 whitespace-nowrap text-[0.84rem]">
                  Official source ↗
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

export function Breakdown({ def, result, market }: { def: CalculatorDef; result: Result; market: Market }) {
  const money = (c: number) => formatMoney(c, market.currency, market.locale);
  const src = (id?: string) => (id ? def.sources.find((s) => s.id === id)?.url : undefined);
  return (
    <div>
      <ul className="divide-y divide-line">
        {result.fees.map((l) => (
          <LineRow key={l.id} line={l} market={market} sourceUrl={src(l.source)} />
        ))}
      </ul>
      <div className="mt-1 flex items-baseline justify-between border-t border-line-2 pt-3 text-[0.95rem]">
        <span className="font-[600] text-ink">Total fees</span>
        <span className="tnum font-[620] text-ink">
          −{money(result.totalFees)} <span className="ml-1 text-[0.82rem] font-normal text-ink-3">{(result.effectiveRate * 100).toFixed(1)}%</span>
        </span>
      </div>
      <div className="mt-2 flex items-baseline justify-between text-[0.95rem]">
        <span className="font-[600] text-ink">You receive</span>
        <span className="tnum font-[640] text-keep-text">{money(result.payout)}</span>
      </div>

      {result.costs.length > 0 && (
        <div className="mt-4 inset px-4 py-3">
          <ul className="divide-y divide-line">
            {result.costs.map((l) => (
              <LineRow key={l.id} line={l} market={market} />
            ))}
          </ul>
          <div className="mt-1 flex items-baseline justify-between border-t border-line-2 pt-3">
            <span className="font-[600] text-ink">Profit</span>
            <span className={`tnum font-[660] ${result.profit !== null && result.profit < 0 ? "text-bad" : "text-keep-text"}`}>
              {money(result.profit ?? 0)}
              {result.margin !== null && <span className="ml-1.5 text-[0.82rem] font-normal text-ink-3">{(result.margin * 100).toFixed(1)}% margin</span>}
            </span>
          </div>
        </div>
      )}

      {result.buyerFees.length > 0 && (
        <div className="mt-4">
          <div className="eyebrow mb-1">Your {buyerNoun(def)} also pays</div>
          <ul className="divide-y divide-line">
            {result.buyerFees.map((l) => (
              <LineRow key={l.id} line={l} market={market} sign="+" sourceUrl={src(l.source)} />
            ))}
          </ul>
          <div className="mt-1 flex items-baseline justify-between border-t border-line pt-2.5 text-[0.9rem] text-ink-2">
            <span>{cap(buyerNoun(def))}’s total</span>
            <span className="tnum font-[560] text-ink">{money(result.buyerPays)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function Notices({ result }: { result: Result }) {
  if (!result.notes.length && !result.warnings.length) return null;
  return (
    <div className="mt-4 space-y-2">
      {result.warnings.map((w) => (
        <p key={w} className="rounded-[14px] bg-bad-soft px-3.5 py-2.5 text-[0.86rem] leading-snug text-bad" role="status">
          {w}
        </p>
      ))}
      {result.notes.map((n) => (
        <p key={n} className="rounded-[14px] bg-card-2 px-3.5 py-2.5 text-[0.84rem] leading-snug text-ink-2">
          {n}
        </p>
      ))}
    </div>
  );
}
