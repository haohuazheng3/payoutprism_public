import Link from "next/link";
import type { ReactNode } from "react";
import type { CalculatorDef, Inputs } from "@/fees/types";
import { pickMarket } from "@/fees/markets";
import { formatMoney } from "@/fees/money";
import { CATALOG } from "@/fees/catalog";

/*
 * Server-rendered building blocks for calculator articles. Every number they print is computed
 * by the same engine as the calculator, so the article and the tool can never disagree.
 */

function formatDate(iso: string) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export function Callout({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <div className="float not-prose my-8 px-5 py-4 sm:px-6">
      {title && <div className="mb-1 text-[0.95rem] font-[640] text-ink">{title}</div>}
      <div className="text-[0.96rem] leading-relaxed text-ink-2 [&_p]:my-1">{children}</div>
    </div>
  );
}

export function FeeSchedule({ def, market }: { def: CalculatorDef; market?: string }) {
  const m = pickMarket(def.markets, market, def.defaultMarket);
  const rows = def.schedule(m);
  const src = (id?: string) => (id ? def.sources.find((s) => s.id === id) : undefined);
  return (
    <div className="float not-prose my-8 overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-5 sm:px-6">
        <div className="text-[1rem] font-[640] text-ink">
          {def.name} fees{def.markets.length > 1 ? ` · ${m.flag} ${m.label}` : ""}
        </div>
        <div className="text-[0.8rem] text-ink-3">Checked {formatDate(def.verifiedAt)}</div>
      </div>
      <div className="scroll-x mt-2">
        <table className="data-table min-w-[560px]">
          <thead>
            <tr>
              <th>Fee</th>
              <th>Amount</th>
              <th>Charged on</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const s = src(r.source);
              return (
                <tr key={r.fee}>
                  <td>{r.fee}</td>
                  <td className="tnum whitespace-nowrap text-ink">{r.amount}</td>
                  <td>{r.appliesTo}</td>
                  <td>
                    {r.when ?? "Every sale"}
                    {s && (
                      <a href={s.url} target="_blank" rel="noopener noreferrer" className="link ml-1.5 text-[0.8rem] text-ink-3">
                        source
                      </a>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** "How much do you keep at $10, $25, $50…": the long-tail questions answered with live numbers. */
export function PayoutExamples({ def, prices, market, with: extra, caption }: { def: CalculatorDef; prices: number[]; market?: string; with?: Partial<Inputs>; caption?: string }) {
  const m = pickMarket(def.markets, market, def.defaultMarket);
  const base = { ...def.defaults(m), ...extra } as Inputs;
  const money = (c: number) => formatMoney(c, m.currency, m.locale);
  const rows = prices.map((p) => {
    const r = def.calculate({ ...base, [def.priceField]: p }, m);
    return { p, r };
  });
  return (
    <div className="float not-prose my-8 overflow-hidden">
      {caption && <div className="px-5 pt-5 text-[0.92rem] text-ink-2 sm:px-6">{caption}</div>}
      <div className="scroll-x mt-1">
        <table className="data-table min-w-[480px]">
          <thead>
            <tr>
              <th>{def.priceNoun[0].toUpperCase() + def.priceNoun.slice(1)}</th>
              <th className="num">Total fees</th>
              <th className="num">Fee rate</th>
              <th className="num">You keep</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, r }) => (
              <tr key={p}>
                <td className="tnum">{money(Math.round(p * 100))}</td>
                <td className="num">{money(r.totalFees)}</td>
                <td className="num">{(r.effectiveRate * 100).toFixed(1)}%</td>
                <td className="num font-[600] text-ink">{money(r.payout)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** One reference sale in every market the calculator covers. */
export function MarketTable({ def, price, with: extra }: { def: CalculatorDef; price: number; with?: Partial<Inputs> }) {
  if (def.markets.length < 2) return null;
  return (
    <div className="float not-prose my-8 overflow-hidden">
      <div className="scroll-x">
        <table className="data-table min-w-[480px]">
          <thead>
            <tr>
              <th>Market</th>
              <th className="num">Sale</th>
              <th className="num">Fees</th>
              <th className="num">You keep</th>
            </tr>
          </thead>
          <tbody>
            {def.markets.map((m) => {
              const r = def.calculate({ ...def.defaults(m), ...extra, [def.priceField]: price } as Inputs, m);
              const money = (c: number) => formatMoney(c, m.currency, m.locale);
              return (
                <tr key={m.id}>
                  <td>
                    {m.flag} {m.label}
                  </td>
                  <td className="num">{money(r.saleAmount)}</td>
                  <td className="num">
                    {money(r.totalFees)} <span className="text-[0.78rem] text-ink-4">{(r.effectiveRate * 100).toFixed(1)}%</span>
                  </td>
                  <td className="num font-[600] text-ink">{money(r.payout)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** A worked example written out line by line. */
export function Example({ def, market, with: extra }: { def: CalculatorDef; market?: string; with?: Partial<Inputs> }) {
  const m = pickMarket(def.markets, market, def.defaultMarket);
  const r = def.calculate({ ...def.defaults(m), ...extra } as Inputs, m);
  const money = (c: number) => formatMoney(c, m.currency, m.locale);
  return (
    <div className="float not-prose my-8 px-5 py-5 sm:px-6">
      <div className="eyebrow mb-2">Worked example</div>
      <ul className="divide-y divide-line">
        <li className="flex justify-between gap-3 py-2 text-[0.95rem]">
          <span className="text-ink">Buyer pays</span>
          <span className="tnum font-[560] text-ink">{money(r.buyerPays)}</span>
        </li>
        {r.fees
          .filter((l) => l.amount)
          .map((l) => (
            <li key={l.id} className="flex justify-between gap-3 py-2 text-[0.93rem]">
              <span className="text-ink-2">
                {l.label}
                {l.detail && <span className="tnum ml-2 text-[0.82rem] text-ink-4">{l.detail}</span>}
              </span>
              <span className="tnum text-ink">−{money(l.amount)}</span>
            </li>
          ))}
        <li className="flex justify-between gap-3 py-2 text-[0.98rem]">
          <span className="font-[620] text-ink">You keep</span>
          <span className="tnum font-[660] text-keep-text">{money(r.payout)}</span>
        </li>
      </ul>
    </div>
  );
}

export function ChangeLog({ def }: { def: CalculatorDef }) {
  if (!def.changes.length) return null;
  const sorted = [...def.changes].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <ol className="not-prose my-8 space-y-3">
      {sorted.map((c) => {
        const s = c.source ? def.sources.find((x) => x.id === c.source) : undefined;
        return (
          <li key={`${c.date}-${c.text.slice(0, 20)}`} className="float flex gap-4 px-5 py-4">
            <div className="w-[104px] flex-none">
              <div className="tnum text-[0.86rem] font-[600] text-ink">{formatDate(c.date)}</div>
              {c.upcoming && <div className="mt-1 inline-block rounded-full bg-warn-soft px-2 py-0.5 text-[0.7rem] font-[650] uppercase tracking-wide text-warn">Upcoming</div>}
            </div>
            <div className="text-[0.94rem] leading-relaxed text-ink-2">
              {c.text}
              {s && (
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="link ml-1.5 text-[0.82rem] text-ink-3">
                  source
                </a>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function SourceList({ def }: { def: CalculatorDef }) {
  return (
    <ul className="not-prose my-6 space-y-2.5">
      {def.sources.map((s) => (
        <li key={s.id} className="text-[0.93rem] leading-snug">
          <a href={s.url} target="_blank" rel="noopener noreferrer" className="link font-[540]">
            {s.publisher}: {s.title}
          </a>
          <span className="ml-2 text-[0.82rem] text-ink-4">checked {formatDate(s.checked)}</span>
        </li>
      ))}
    </ul>
  );
}

export function CalcLink({ slug, children }: { slug: string; children?: ReactNode }) {
  const c = CATALOG.find((x) => x.slug === slug);
  if (!c) return <>{children}</>;
  return (
    <Link href={c.path} className="link">
      {children ?? `${c.name} fee calculator`}
    </Link>
  );
}
