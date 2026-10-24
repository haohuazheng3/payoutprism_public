import Link from "next/link";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";
import type { CalculatorDef, Inputs } from "@/fees/types";
import { pickMarket } from "@/fees/markets";
import { formatMoney } from "@/fees/money";
import { CATALOG } from "@/fees/catalog";
import { getCalculator } from "@/fees/all";

/*
 * Server-rendered building blocks for calculator articles. Every number they print is computed
 * by the same engine as the calculator, so the article and the tool can never disagree.
 */

/** "2026-06-22" → "June 22, 2026"; "2025-09" (month precision) → "September 2025". */
export function formatChangeDate(iso: string) {
  if (/^\d{4}-\d{2}$/.test(iso)) return new Date(`${iso}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}
const formatDate = formatChangeDate;

/** Rates under 10% keep two decimals so 2.99% doesn't read as 3.0%. */
function rateText(r: number) {
  const p = r * 100;
  return `${p < 10 ? p.toFixed(2) : p.toFixed(1)}%`;
}

const BUYER: Record<string, string> = { marketplaces: "Buyer", payments: "Payer", freelance: "Client", rentals: "Guest", creators: "Buyer", fundraising: "Donors" };

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
            {rows.map((r, i) => {
              const s = src(r.source);
              return (
                <tr key={`${i}-${r.fee}`}>
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
export function PayoutExamples({ def, prices, market, with: extra, caption, label }: { def: CalculatorDef; prices: number[]; market?: string; with?: Partial<Inputs>; caption?: string; label?: string }) {
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
              <th>{label ?? def.priceNoun[0].toUpperCase() + def.priceNoun.slice(1)}</th>
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
                <td className="num">{rateText(r.effectiveRate)}</td>
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
                    {money(r.totalFees)} <span className="text-[0.78rem] text-ink-4">{rateText(r.effectiveRate)}</span>
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
  const buyer = def.buyerNoun ? def.buyerNoun[0].toUpperCase() + def.buyerNoun.slice(1) : BUYER[def.category] ?? "Buyer";
  const signed = (c: number) => (c < 0 ? `+${money(-c)}` : c === 0 ? money(0) : `−${money(c)}`);
  return (
    <div className="float not-prose my-8 px-5 py-5 sm:px-6">
      <div className="eyebrow mb-2">Worked example</div>
      <ul className="divide-y divide-line">
        {r.buyerFees.length > 0 && (
          <>
            <li className="flex justify-between gap-3 py-2 text-[0.93rem]">
              <span className="text-ink-2">{buyer} pays in total</span>
              <span className="tnum text-ink">{money(r.buyerPays)}</span>
            </li>
            {r.buyerFees.map((l) => (
              <li key={`b-${l.id}`} className="flex justify-between gap-3 py-2 text-[0.9rem]">
                <span className="text-ink-3">
                  of which {l.label.charAt(0).toLowerCase() + l.label.slice(1)} (paid by the {buyer.toLowerCase()})
                  {l.detail && <span className="tnum ml-2 text-[0.82rem] text-ink-4">{l.detail}</span>}
                </span>
                <span className="tnum text-ink-3">{money(l.amount)}</span>
              </li>
            ))}
          </>
        )}
        <li className="flex justify-between gap-3 py-2 text-[0.95rem]">
          <span className="text-ink">{r.buyerFees.length ? "Sale amount" : `${buyer} pays`}</span>
          <span className="tnum font-[560] text-ink">{money(r.buyerFees.length ? r.saleAmount : r.buyerPays)}</span>
        </li>
        {r.fees
          .filter((l) => l.amount || l.explain)
          .map((l) => (
            <li key={l.id} className="flex justify-between gap-3 py-2 text-[0.93rem]">
              <span className="text-ink-2">
                {l.label}
                {l.detail && <span className="tnum ml-2 text-[0.82rem] text-ink-4">{l.detail}</span>}
              </span>
              <span className="tnum text-ink">{signed(l.amount)}</span>
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
  const today = new Date().toISOString().slice(0, 10);
  const sorted = [...def.changes].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <ol className="not-prose my-8 space-y-3">
      {sorted.map((c) => {
        const s = c.source ? def.sources.find((x) => x.id === c.source) : undefined;
        return (
          <li key={`${c.date}-${c.text.slice(0, 20)}`} className="float flex gap-4 px-5 py-4">
            <div className="w-[104px] flex-none">
              <div className="tnum text-[0.86rem] font-[600] text-ink">{formatDate(c.date)}</div>
              {c.date > today && <div className="mt-1 inline-block rounded-full bg-warn-soft px-2 py-0.5 text-[0.7rem] font-[650] uppercase tracking-wide text-warn">Upcoming</div>}
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

/** A local, pre-sized photo (Pexels) with its credit line. Lazy, fixed dimensions: no layout shift. */
export function Figure({ src, alt, credit, creditUrl, w = 1200, h = 800, caption }: { src: string; alt: string; credit?: string; creditUrl?: string; w?: number; h?: number; caption?: string }) {
  return (
    <figure className="not-prose my-9">
      {/* eslint-disable-next-line @next/next/no-img-element -- static local WebP, sized; next/image optimisation would bill per image */}
      <img src={src} alt={alt} width={w} height={h} loading="lazy" decoding="async" className="h-auto w-full rounded-[22px] bg-card-2 object-cover" />
      {(caption || credit) && (
        <figcaption className="mt-2 text-[0.8rem] text-ink-4">
          {caption}
          {caption && credit ? " · " : ""}
          {credit && (
            <>
              Photo:{" "}
              {creditUrl ? (
                <a href={creditUrl} target="_blank" rel="noopener noreferrer" className="link">
                  {credit}
                </a>
              ) : (
                credit
              )}{" "}
              / Pexels
            </>
          )}
        </figcaption>
      )}
    </figure>
  );
}

export interface ScenarioRow {
  label: string;
  /** Another calculator to run this row through (defaults to the page's own). */
  slug?: string;
  market?: string;
  with?: Partial<Inputs>;
  /** Run the same sale the compare page uses (price + shipping the buyer pays), mapped to this calculator’s own inputs. */
  sale?: { price: number; shipping?: number; itemCost?: number };
  note?: string;
}

/**
 * The same engine, several situations side by side: plans, payment methods, platforms. Every
 * number is computed at render time, so the table can't drift from the calculator.
 */
export function Scenarios({ def, rows, caption, head = "Scenario", buyer = false, sort = false, keep }: { def?: CalculatorDef; rows: ScenarioRow[]; caption?: string; head?: string; buyer?: boolean; sort?: boolean; keep?: string }) {
  const computed = rows.map((row) => {
    const d = row.slug ? getCalculator(row.slug) : def;
    if (!d) throw new Error(`Scenarios: no calculator for row ${row.label}`);
    const m = pickMarket(d.markets, row.market, d.defaultMarket);
    const mapped = row.sale && d.compare ? d.compare.map({ price: row.sale.price, shipping: row.sale.shipping ?? 0, itemCost: row.sale.itemCost ?? 0, shippingCost: 0 }) : {};
    const r = d.calculate({ ...d.defaults(m), ...mapped, ...row.with } as Inputs, m);
    const money = (c: number) => formatMoney(c, m.currency, m.locale);
    return { row, r, money, path: d.path };
  });
  if (sort) computed.sort((a, b) => (b.r.profit ?? b.r.payout) - (a.r.profit ?? a.r.payout));
  const profit = computed.some((c) => c.r.profit !== null);
  return (
    <div className="float not-prose my-8 overflow-hidden">
      {caption && <div className="px-5 pt-5 text-[0.92rem] text-ink-2 sm:px-6">{caption}</div>}
      <div className="scroll-x mt-1">
        <table className="data-table min-w-[520px]">
          <thead>
            <tr>
              <th>{head}</th>
              {buyer && <th className="num">They pay</th>}
              <th className="num">Fees</th>
              <th className="num">Fee rate</th>
              <th className="num">{keep ?? (profit ? "Profit" : "You keep")}</th>
            </tr>
          </thead>
          <tbody>
            {computed.map(({ row, r, money, path }) => (
              <tr key={row.label}>
                <td>
                  {row.slug ? (
                    <Link href={path} className="link">
                      {row.label}
                    </Link>
                  ) : (
                    row.label
                  )}
                  {row.note && <span className="block text-[0.78rem] text-ink-4">{row.note}</span>}
                </td>
                {buyer && <td className="num">{money(r.buyerPays)}</td>}
                <td className="num">{money(r.totalFees)}</td>
                <td className="num">{rateText(r.effectiveRate)}</td>
                <td className="num font-[600] text-ink">{money(r.profit ?? r.payout)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** The B-page conclusion card: the answer in two sentences, then the buttons that act on it. */
export function Verdict({ title = "Our verdict", children, links = [] }: { title?: string; children: ReactNode; links?: { slug?: string; href?: string; label: string }[] }) {
  return (
    <aside className="float not-prose my-8 border-l-4 border-keep px-5 py-5 sm:px-7 sm:py-6" aria-label={title}>
      <div className="eyebrow mb-2">{title}</div>
      <div className="text-[1.02rem] leading-relaxed text-ink [&_p]:my-1.5 [&_strong]:font-[650]">{children}</div>
      {links.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {links.map((l, i) => {
            const href = l.href ?? CATALOG.find((c) => c.slug === l.slug)?.path ?? "/compare";
            return (
              <Link key={href + l.label} href={href} className={i === 0 ? "btn btn-ink" : "btn btn-ghost"}>
                {l.label}
              </Link>
            );
          })}
        </div>
      )}
    </aside>
  );
}

interface PhotoMeta {
  n: number;
  src: string;
  photographer?: string;
  photographerUrl?: string;
}
const photoCache = new Map<string, PhotoMeta[]>();
function photoManifest(page: string): PhotoMeta[] {
  if (!photoCache.has(page)) {
    let list: PhotoMeta[] = [];
    try {
      list = JSON.parse(readFileSync(join(process.cwd(), "research", "images", `${page}.json`), "utf8")) as PhotoMeta[];
    } catch {
      list = [];
    }
    photoCache.set(page, list);
  }
  return photoCache.get(page) ?? [];
}

/** <Photo id="tcgplayer/1" alt="…" />: a photo from public/img with its Pexels credit filled in from the manifest. */
export function Photo({ id, alt, caption }: { id: string; alt: string; caption?: string }) {
  const [page, n] = id.split("/");
  const meta = photoManifest(page).find((p) => String(p.n) === n);
  return <Figure src={meta?.src ?? `/img/${page}/${n}.webp`} alt={alt} credit={meta?.photographer} creditUrl={meta?.photographerUrl} caption={caption} w={1200} h={800} />;
}
