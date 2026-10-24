"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { CompareInputs } from "@/fees/types";
import type { CompareRow } from "@/fees/compare";
import { formatMoney } from "@/fees/money";
import { track } from "@/lib/analytics";
import { NumericInput } from "./calculator/fields";
import { KIND_COLOR } from "./calculator/util";

type Group = "sell" | "pay";

/**
 * The same sale on every platform, ranked by what you keep. The first rows are rendered on the
 * server; the engines load only when the visitor changes a number (keeps the first paint light).
 */
export function CompareTool({
  initial,
  initialRows,
  group: initialGroup = "sell",
  compact = false,
}: {
  initial: CompareInputs;
  initialRows: Record<Group, CompareRow[]>;
  group?: Group;
  compact?: boolean;
}) {
  const [group, setGroup] = useState<Group>(initialGroup);
  const [c, setC] = useState<CompareInputs>(initial);
  const [rows, setRows] = useState(initialRows);
  const [showCosts, setShowCosts] = useState(false);
  const engine = useRef<null | ((g: Group, c: CompareInputs) => CompareRow[])>(null);
  const touched = useRef(false);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const loader = useRef<Promise<(g: Group, c: CompareInputs) => CompareRow[]> | null>(null);
  /** Fetch the fee engines once; started on idle and on the first touch so a change rarely waits. */
  const loadEngine = () => {
    if (!loader.current)
      loader.current = Promise.all([import("@/fees/all"), import("@/fees/compare")]).then(([{ ALL }, { compareAll }]) => {
        const fn = (g: Group, x: CompareInputs) => compareAll(ALL, g, x);
        engine.current = fn;
        return fn;
      });
    return loader.current;
  };
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- marks hydration for monitoring and tests
    setReady(true);
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number };
    const t = w.requestIdleCallback ? w.requestIdleCallback(() => void loadEngine()) : window.setTimeout(() => void loadEngine(), 2500);
    return () => {
      if (!w.requestIdleCallback) window.clearTimeout(t);
    };
  }, []);

  // Restore ?price=&shipping=&cost=&label=&group= (links from calculator pages). The URL can only be
  // read after hydration, so this one effect sets state on purpose.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (compact) return;
    const q = new URLSearchParams(window.location.search);
    const n = (k: string) => (q.get(k) !== null && Number.isFinite(Number(q.get(k))) ? Number(q.get(k)) : undefined);
    const next: CompareInputs = { price: n("price") ?? initial.price, shipping: n("shipping") ?? initial.shipping, itemCost: n("cost") ?? initial.itemCost, shippingCost: n("label") ?? initial.shippingCost };
    if (q.get("group") === "pay") setGroup("pay");
    if (next.itemCost || next.shippingCost) setShowCosts(true);
    if (JSON.stringify(next) !== JSON.stringify(initial)) {
      touched.current = true;
      setC(next);
    }
  }, [compact, initial]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!touched.current) return;
    let alive = true;
    const go = async () => {
      const fn = engine.current ?? (await loadEngine());
      if (!alive) return;
      setRows({ sell: fn("sell", c), pay: fn("pay", c) });
      setPending(false);
    };
    void go();
    if (!compact) {
      const q = new URLSearchParams();
      q.set("price", String(c.price));
      if (c.shipping) q.set("shipping", String(c.shipping));
      if (c.itemCost) q.set("cost", String(c.itemCost));
      if (c.shippingCost) q.set("label", String(c.shippingCost));
      if (group === "pay") q.set("group", "pay");
      window.history.replaceState(window.history.state, "", `${window.location.pathname}?${q.toString()}`);
    }
    return () => {
      alive = false;
    };
  }, [c, group, compact]);

  const set = (k: keyof CompareInputs, v: number) => {
    if (!touched.current) track("compare_interact", { compact });
    touched.current = true;
    if (!engine.current) setPending(true); // instant visual feedback while the engines arrive
    setC((prev) => ({ ...prev, [k]: v }));
  };

  const list = rows[group];
  const money = (cents: number) => formatMoney(cents, "USD", "en-US");
  const best = list[0];
  const max = Math.max(1, ...list.map((r) => r.buyerPays));
  const shown = compact ? list.slice(0, 6) : list;
  const sellLabel = group === "sell";

  return (
    <div className={compact ? "" : "grid gap-5 lg:grid-cols-12 lg:items-start lg:gap-6"} data-ready={ready ? "1" : undefined}>
      <div className={compact ? "min-w-0" : "float min-w-0 p-5 sm:p-7 lg:sticky lg:top-24 lg:col-span-4"} onFocusCapture={() => void loadEngine()}>
        {!compact && (
          <div className="segmented mb-6" role="tablist" aria-label="Compare">
            <button type="button" role="tab" aria-selected={group === "sell"} onClick={() => setGroup("sell")}>
              Selling
            </button>
            <button type="button" role="tab" aria-selected={group === "pay"} onClick={() => setGroup("pay")}>
              Getting paid
            </button>
          </div>
        )}
        <div className={compact ? "grid grid-cols-2 gap-3" : "grid gap-4"}>
          <div>
            <label htmlFor="cmp-price" className="mb-1.5 block text-[0.86rem] font-[560] text-ink-2">
              {sellLabel ? "Item price" : "Payment amount"}
            </label>
            <NumericInput id="cmp-price" value={c.price} onChange={(v) => set("price", v)} prefix="$" money hero={!compact} />
          </div>
          {sellLabel && (
            <div>
              <label htmlFor="cmp-ship" className="mb-1.5 block text-[0.86rem] font-[560] text-ink-2">
                Shipping buyer pays
              </label>
              <NumericInput id="cmp-ship" value={c.shipping} onChange={(v) => set("shipping", v)} prefix="$" money />
            </div>
          )}
          {!compact && sellLabel && (
            <>
              {showCosts ? (
                <>
                  <div>
                    <label htmlFor="cmp-cost" className="mb-1.5 block text-[0.86rem] font-[560] text-ink-2">
                      What the item cost you
                    </label>
                    <NumericInput id="cmp-cost" value={c.itemCost} onChange={(v) => set("itemCost", v)} prefix="$" money />
                  </div>
                  <div>
                    <label htmlFor="cmp-label" className="mb-1.5 block text-[0.86rem] font-[560] text-ink-2">
                      Postage you pay
                    </label>
                    <NumericInput id="cmp-label" value={c.shippingCost} onChange={(v) => set("shippingCost", v)} prefix="$" money />
                  </div>
                </>
              ) : (
                <button type="button" className="inset px-4 py-3 text-left text-[0.92rem] font-[560] text-ink" onClick={() => setShowCosts(true)}>
                  + Add your costs to rank by profit
                </button>
              )}
            </>
          )}
        </div>
        {!compact && (
          <p className="mt-5 text-[0.82rem] leading-relaxed text-ink-3">
            Each platform uses its most common setup (noted under its name). Open one to change category, plan or ads; your numbers come with you.
          </p>
        )}
      </div>

      <div className={compact ? "mt-5 min-w-0" : "min-w-0 lg:col-span-8"}>
        {best && !compact && (
          <p className="mb-4 px-1 text-[1rem] text-ink-2">
            On a <span className="tnum font-[620] text-ink">{money(Math.round(c.price * 100))}</span> {sellLabel ? "sale" : "payment"},{" "}
            <span className="font-[620] text-ink">{best.name}</span> leaves you the most:{" "}
            <span className="tnum font-[620] text-keep-text">{money(best.profit ?? best.payout)}</span>
            {best.profit !== null ? " profit" : ""}.
          </p>
        )}
        <ol className={`${compact ? "space-y-1.5" : "space-y-2.5"} ${pending ? "pointer-events-none" : ""}`} aria-busy={pending} onPointerDown={() => void loadEngine()}>
          {shown.map((r, i) => (
            <li key={r.slug}>
              <Link
                href={r.href}
                onClick={() => track("compare_open", { to: r.slug, rank: i + 1, compact })}
                className={compact ? "flex items-center gap-3 rounded-[16px] px-3 py-2.5 transition-colors hover:bg-card-2" : "float float-lift flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:gap-5"}
              >
                <span className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="tnum w-5 flex-none text-[0.8rem] font-[600] text-ink-4">{i + 1}</span>
                  <span className="min-w-0">
                    <span className="block text-[0.98rem] font-[620] text-ink">{r.name}</span>
                    {!compact && <span className="block truncate text-[0.8rem] text-ink-3">{r.note}</span>}
                  </span>
                </span>
                {!compact && (
                  <span className="flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full sm:w-[220px]" aria-hidden>
                    <span className="h-full rounded-full" style={{ flexGrow: Math.max(0, r.payout) / max, background: KIND_COLOR.keep }} />
                    {Object.entries(r.byKind).map(([k, v]) => (
                      <span key={k} className="h-full rounded-full" style={{ flexGrow: v / max, background: KIND_COLOR[k as keyof typeof KIND_COLOR] ?? "var(--tax)", minWidth: 4 }} />
                    ))}
                  </span>
                )}
                <span className={`flex flex-none items-baseline gap-3 sm:w-[190px] sm:justify-end ${pending ? "skeleton text-transparent" : ""}`}>
                  <span className="tnum text-[0.8rem] text-ink-3">
                    fees {money(r.totalFees)} · {(r.effectiveRate * 100).toFixed(1)}%
                  </span>
                  <span className={`tnum text-[1.02rem] font-[650] ${(r.profit ?? r.payout) < 0 ? "text-bad" : "text-ink"}`}>{money(r.profit ?? r.payout)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
        {compact && (
          <Link href={`/compare?price=${c.price}${c.shipping ? `&shipping=${c.shipping}` : ""}`} className="btn btn-ghost btn-sm mt-4 w-full">
            Compare all {list.length} platforms →
          </Link>
        )}
      </div>
    </div>
  );
}
