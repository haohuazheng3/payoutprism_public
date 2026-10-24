"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CalculatorDef, FieldDef, FieldSection, Inputs, InputValue, Result } from "@/fees/types";
import { pickMarket } from "@/fees/markets";
import { formatMoney, toCents } from "@/fees/money";
import { solveFromInput, type Target } from "@/fees/solve";
import { track } from "@/lib/analytics";
import { Field, NumericInput } from "./fields";
import { BigMoney, Breakdown, Notices, SpectrumBar } from "./ResultCard";
import { PriceLadder } from "./PriceLadder";
import { Feedback } from "./Feedback";
import { pushRecent } from "./recent";
import { currencySymbol, decodeState, encodeState, saleNoun, visibleFields } from "./util";

const SECTION_TITLE: Record<FieldSection, string> = {
  sale: "The sale",
  shipping: "Shipping",
  costs: "Your costs",
  options: "Options",
};

type Mode = "payout" | "price";

function formatDate(iso: string) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function CalculatorApp({ def, compareHref }: { def: CalculatorDef; compareHref?: boolean }) {
  const [marketId, setMarketId] = useState(def.defaultMarket);
  const market = pickMarket(def.markets, marketId, def.defaultMarket);
  const [inputs, setInputs] = useState<Inputs>(() => def.defaults(market));
  const [mode, setMode] = useState<Mode>("payout");
  const [target, setTarget] = useState<Target>("payout");
  const [goal, setGoal] = useState<number>(() => Math.max(1, Math.round(def.calculate(def.defaults(market), market).payout / 100)));
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [restored, setRestored] = useState(false);
  const [copied, setCopied] = useState<"" | "summary" | "link">("");
  const interacted = useRef(false);
  const resultRef = useRef<HTMLDivElement>(null);
  const [resultVisible, setResultVisible] = useState(true);

  // Restore a shared / bookmarked calculation from the URL once, after hydration.
  useEffect(() => {
    const s = decodeState(def, window.location.search);
    const m = pickMarket(def.markets, s.market, def.defaultMarket);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the URL can only be read after hydration
    if (s.market) setMarketId(m.id);
    if (Object.keys(s.inputs).length || s.market) setInputs({ ...def.defaults(m), ...(s.inputs as Inputs) });
    if (s.extra.mode === "price") setMode("price");
    if (s.extra.target === "profit" || s.extra.target === "payout") setTarget(s.extra.target);
    if (s.extra.goal && Number.isFinite(Number(s.extra.goal))) setGoal(Number(s.extra.goal));
    setRestored(true);
  }, [def]);

  const fields = useMemo(() => visibleFields(def, inputs, market), [def, inputs, market]);
  const priceDef = fields.find((f) => f.id === def.priceField);
  const hasCosts = fields.some((f) => f.section === "costs");
  const costsEntered = fields.some((f) => f.section === "costs" && Number(inputs[f.id] ?? 0) > 0);

  const solved = useMemo(() => (mode === "price" ? solveFromInput(def, inputs, market, target, goal) : null), [mode, def, inputs, market, target, goal]);
  const result: Result | null = useMemo(() => {
    if (mode === "price") return solved?.result ?? null;
    return def.calculate(inputs, market);
  }, [mode, solved, def, inputs, market]);
  const money = useCallback((c: number) => formatMoney(c, market.currency, market.locale), [market]);

  const firstTouch = useCallback(() => {
    if (interacted.current) return;
    interacted.current = true;
    track("calc_interact", { calculator: def.slug });
  }, [def.slug]);

  const setValue = useCallback(
    (id: string, v: InputValue) => {
      firstTouch();
      setInputs((prev) => ({ ...prev, [id]: v }));
    },
    [firstTouch],
  );

  const changeMarket = (id: string) => {
    const next = pickMarket(def.markets, id, def.defaultMarket);
    const oldDefaults = def.defaults(market);
    const merged = def.defaults(next);
    for (const f of def.fields) {
      if ((f.kind === "money" || f.kind === "number" || f.kind === "percent") && inputs[f.id] !== oldDefaults[f.id] && f.id in merged) merged[f.id] = inputs[f.id];
    }
    setMarketId(next.id);
    setInputs(merged);
    track("market_change", { calculator: def.slug, market: next.id });
  };

  const reset = () => {
    setInputs(def.defaults(market));
    setMode("payout");
    setOpen({});
    track("calc_reset", { calculator: def.slug });
  };

  const queryString = useMemo(
    () => encodeState(def, market, inputs, mode === "price" ? { mode: "price", target, goal: String(goal) } : {}),
    [def, market, inputs, mode, target, goal],
  );

  // Keep the URL in step (shareable, survives refresh and back/forward).
  useEffect(() => {
    if (!restored) return;
    const t = setTimeout(() => {
      const url = `${window.location.pathname}${queryString}${window.location.hash}`;
      if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(window.history.state, "", url);
    }, 250);
    return () => clearTimeout(t);
  }, [queryString, restored]);

  // Remember the calculation locally once the person has settled on numbers.
  useEffect(() => {
    if (!restored || !interacted.current || !queryString || !result) return;
    const t = setTimeout(() => {
      const price = mode === "price" ? solved?.price ?? 0 : toCents(inputs[def.priceField]);
      pushRecent({
        slug: def.slug,
        name: def.name,
        path: def.path,
        query: queryString,
        summary: `${market.flag} ${money(price)} ${def.priceNoun} → keep ${money(result.payout)}`,
      });
    }, 2500);
    return () => clearTimeout(t);
  }, [queryString, restored, result, mode, solved, inputs, def, market, money]);

  // Phones: a docked mini result while the full result card is off screen.
  useEffect(() => {
    const el = resultRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setResultVisible(e.isIntersecting), { threshold: 0.12 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const summaryText = () => {
    if (!result) return "";
    const lines = [
      `${def.name} fees${def.markets.length > 1 ? ` (${market.label})` : ""}`,
      mode === "price" && solved?.price != null ? `Charge: ${money(solved.price)}` : `Sale: ${money(result.saleAmount)}`,
      ...result.fees.filter((l) => l.amount).map((l) => `${l.label}: −${money(l.amount)}${l.detail ? ` (${l.detail})` : ""}`),
      `Total fees: −${money(result.totalFees)} (${(result.effectiveRate * 100).toFixed(1)}%)`,
      `You receive: ${money(result.payout)}`,
      ...(result.profit !== null ? [`Profit after your costs: ${money(result.profit)}`] : []),
      `Rates checked ${formatDate(def.verifiedAt)}`,
    ];
    return lines.join("\n");
  };

  const copy = async (what: "summary" | "link") => {
    setCopied(what);
    const text = what === "summary" ? `${summaryText()}\n${window.location.href}` : window.location.href;
    try {
      if (what === "link" && typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches) {
        await navigator.share({ title: `${def.name} fee calculation`, url: window.location.href });
      } else {
        await navigator.clipboard.writeText(text);
      }
    } catch {
      /* the person cancelled the share sheet or the clipboard is blocked; nothing to undo */
    }
    track(what === "summary" ? "copy_result" : "share_link", { calculator: def.slug });
    setTimeout(() => setCopied(""), 1800);
  };

  const sections: FieldSection[] = ["sale", "shipping", "options", "costs"];
  // A section with nothing but advanced fields would show a bare heading: fold those into "Options".
  const lonely = new Set<FieldSection>(
    (["shipping", "costs"] as FieldSection[]).filter((s) => {
      const list = fields.filter((f) => f.section === s && f.id !== def.priceField);
      return list.length > 0 && list.every((f) => f.advanced) && s !== "costs";
    }),
  );
  const sectionOf = (f: FieldDef): FieldSection => (lonely.has(f.section) ? "options" : f.section);
  const bySection = (s: FieldSection) => fields.filter((f) => sectionOf(f) === s && !(f.id === def.priceField));
  const isDefault = (f: FieldDef) => inputs[f.id] === def.defaults(market)[f.id];

  const priceCents = mode === "price" ? solved?.price ?? null : toCents(inputs[def.priceField]);

  const heroBlock = (
        <div>
          {mode === "payout" && priceDef ? (
            <Field field={priceDef} value={inputs[priceDef.id]} inputs={inputs} market={market} onChange={setValue} hero />
          ) : (
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <span className="text-[0.86rem] font-[560] text-ink-2">{target === "profit" ? "Profit you want after your costs" : `Amount you want to receive`}</span>
                {hasCosts && (
                  <div className="segmented !p-[3px]" role="group" aria-label="Solve for">
                    <button type="button" className="!min-h-[32px] !text-[0.8rem]" aria-pressed={target === "payout"} onClick={() => setTarget("payout")}>
                      Payout
                    </button>
                    <button
                      type="button"
                      className="!min-h-[32px] !text-[0.8rem]"
                      aria-pressed={target === "profit"}
                      onClick={() => {
                        setTarget("profit");
                        setOpen((o) => ({ ...o, costs: true }));
                      }}
                    >
                      Profit
                    </button>
                  </div>
                )}
              </div>
              <NumericInput id={`${def.slug}-goal`} value={goal} onChange={(n) => setGoal(n)} prefix={currencySymbol(market)} money hero ariaLabel="Target amount" />
              <p className="mt-1.5 text-[0.82rem] text-ink-3">
                We find the lowest {def.priceNoun} that gets you there, with every fee below.
              </p>
            </div>
          )}
        </div>
  );

  return (
    <div className="grid gap-5 lg:grid-cols-12 lg:items-start lg:gap-6" data-ready={restored ? "1" : undefined}>
      {/* ---------------- inputs ---------------- */}
      <div className="float min-w-0 p-5 sm:p-7 lg:col-span-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {def.modes !== false ? (
          <div className="segmented w-full sm:w-auto" role="tablist" aria-label="What do you want to work out?">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "payout"}
              onClick={() => {
                setMode("payout");
                firstTouch();
                track("mode_switch", { calculator: def.slug, mode: "payout" });
              }}
            >
              {def.modes ? def.modes[0] : "What I’ll keep"}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "price"}
              onClick={() => {
                if (mode !== "price" && result) setGoal(Math.max(1, Math.round(result.payout / 100)));
                setMode("price");
                firstTouch();
                track("mode_switch", { calculator: def.slug, mode: "price" });
              }}
            >
              {def.modes ? def.modes[1] : "What to charge"}
            </button>
          </div>
          ) : (
            <span />
          )}
          {def.markets.length > 1 && (
            <label className="relative inline-flex items-center">
              <span className="sr-only">Country / marketplace</span>
              <select
                value={market.id}
                onChange={(e) => changeMarket(e.target.value)}
                className="pill h-10 cursor-pointer appearance-none pl-3.5 pr-9 text-[0.9rem] font-[560] text-ink"
              >
                {def.markets.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.flag} {m.label}
                  </option>
                ))}
              </select>
              <svg aria-hidden className="pointer-events-none absolute right-3 text-ink-3" width="12" height="12" viewBox="0 0 14 14">
                <path d="M3 5.5 7 9.5l4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </label>
          )}
        </div>

        {sections.map((s) => {
          const list = bySection(s);
          if (!list.length && s !== "sale") return null;
          const basic = list.filter((f) => !f.advanced);
          const adv = list.filter((f) => f.advanced);
          const advOpen = open[`${s}:adv`] || adv.some((f) => !isDefault(f));
          const collapsible = s === "costs";
          const sectionOpen = !collapsible || open.costs || costsEntered || (mode === "price" && target === "profit");
          return (
            <section key={s} className={s === "sale" ? "mt-6" : "mt-7"} aria-label={SECTION_TITLE[s]}>
              {s !== "sale" && (
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="eyebrow">{SECTION_TITLE[s]}</h2>
                </div>
              )}
              {s === "sale" && <div className={list.length ? "mb-4" : ""}>{heroBlock}</div>}
              {collapsible && !sectionOpen ? (
                <button
                  type="button"
                  className="inset flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left"
                  onClick={() => {
                    setOpen((o) => ({ ...o, costs: true }));
                    track("costs_open", { calculator: def.slug });
                  }}
                >
                  <span>
                    <span className="block text-[0.95rem] font-[580] text-ink">Add your costs to see profit</span>
                    <span className="block text-[0.84rem] text-ink-3">{def.costsHint ?? "Item cost, postage, packaging. Optional."}</span>
                  </span>
                  <span aria-hidden className="grid h-8 w-8 flex-none place-items-center rounded-full bg-card text-ink shadow-[0_0_0_1px_var(--line-2)]">
                    +
                  </span>
                </button>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {basic.map((f) => (
                    <div key={f.id} className={f.kind === "toggle" || f.kind === "segmented" || f.kind === "select" ? "sm:col-span-2" : ""}>
                      <Field field={f} value={inputs[f.id]} inputs={inputs} market={market} onChange={setValue} />
                    </div>
                  ))}
                  {adv.length > 0 && !advOpen && (
                    <button type="button" className="btn btn-quiet btn-sm justify-self-start sm:col-span-2 !px-0 text-ink-3" onClick={() => setOpen((o) => ({ ...o, [`${s}:adv`]: true }))}>
                      + More options ({adv.length})
                    </button>
                  )}
                  {advOpen &&
                    adv.map((f) => (
                      <div key={f.id} className={f.kind === "toggle" || f.kind === "segmented" || f.kind === "select" ? "sm:col-span-2" : ""}>
                        <Field field={f} value={inputs[f.id]} inputs={inputs} market={market} onChange={setValue} />
                      </div>
                    ))}
                </div>
              )}
            </section>
          );
        })}

        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
          <a href="#sources" className="inline-flex items-center gap-2 text-[0.84rem] text-ink-3 hover:text-ink">
            <span className="h-1.5 w-1.5 rounded-full bg-keep" aria-hidden />
            Rates checked {formatDate(def.verifiedAt)} against {def.name}’s own pages
          </a>
          <button type="button" className="btn btn-quiet btn-sm" onClick={reset}>
            Reset
          </button>
        </div>
      </div>

      {/* ---------------- result ---------------- */}
      <div ref={resultRef} className="min-w-0 lg:sticky lg:top-24 lg:col-span-5" id="result">
        <div className="float p-5 sm:p-7" aria-live="polite" aria-atomic="false">
          {result ? (
            <>
              <div className="eyebrow">{mode === "price" ? def.reverseHead ?? `Charge this ${def.priceNoun}` : result.profit !== null ? "Your profit" : def.keepHead ?? "You keep"}</div>
              <div className="mt-2 text-[3.1rem] leading-none text-ink sm:text-[3.6rem]">
                <BigMoney cents={mode === "price" ? solved?.price ?? 0 : def.headline === "buyerPays" ? result.buyerPays : result.profit ?? result.payout} market={market} className={result.profit !== null && result.profit < 0 && mode !== "price" ? "text-bad" : ""} />
              </div>
              <p className="tnum mt-3 text-[0.92rem] leading-snug text-ink-3">
                {mode === "price" ? (
                  <>
                    You receive <span className="font-[600] text-ink">{money(result.payout)}</span> after {money(result.totalFees)} in fees
                    {result.profit !== null && (
                      <>
                        {" "}· profit <span className="font-[600] text-ink">{money(result.profit)}</span>
                      </>
                    )}
                  </>
                ) : result.profit !== null ? (
                  <>
                    You receive <span className="font-[600] text-ink">{money(result.payout)}</span>, then your costs take {money(result.totalCosts)}
                  </>
                ) : (
                  <>
                    from a <span className="font-[600] text-ink">{money(result.saleAmount)}</span> {saleNoun(def)} · fees take{" "}
                    <span className="font-[600] text-ink">{money(result.totalFees)}</span> ({(result.effectiveRate * 100).toFixed(1)}%)
                  </>
                )}
              </p>
              <div className="mt-5">
                <SpectrumBar result={result} market={market} />
              </div>
              <div className="mt-5 border-t border-line pt-2">
                <Breakdown def={def} result={result} market={market} />
              </div>
              <Notices result={result} />
              <div className="mt-6 flex flex-wrap gap-2">
                <button type="button" className="btn btn-ink btn-sm" onClick={() => copy("summary")}>
                  {copied === "summary" ? "Copied ✓" : "Copy breakdown"}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => copy("link")}>
                  {copied === "link" ? "Link copied ✓" : "Share link"}
                </button>
                {compareHref && priceCents !== null && (
                  <a
                    className="btn btn-ghost btn-sm"
                    href={`/compare?price=${(priceCents / 100).toFixed(2)}${inputs.shippingCharged ? `&shipping=${inputs.shippingCharged}` : ""}${inputs.itemCost ? `&cost=${inputs.itemCost}` : ""}`}
                    onClick={() => track("compare_click", { calculator: def.slug })}
                  >
                    Compare platforms →
                  </a>
                )}
              </div>
            </>
          ) : (
            <div>
              <div className="eyebrow">{def.reverseHead ?? `Charge this ${def.priceNoun}`}</div>
              <p className="mt-3 text-[0.95rem] leading-relaxed text-ink-2">
                No {def.priceNoun} up to {money(100_000_000)} reaches that target with these settings. Lower the target or your costs.
              </p>
            </div>
          )}
        </div>

        {result && mode === "payout" && (
          <PriceLadder
            def={def}
            inputs={inputs}
            market={market}
            onPick={(price) => {
              setValue(def.priceField, price);
              track("ladder_click", { calculator: def.slug });
            }}
          />
        )}

        <Feedback calculator={def.slug} market={market.id} inputs={inputs} />
      </div>

      {/* Phones: the answer stays in reach while you type. */}
      {result && !resultVisible && (
        <button
          type="button"
          className="pill fixed inset-x-3 bottom-3 z-30 flex items-center justify-between gap-3 px-5 py-3 text-left animate-rise safe-bottom lg:hidden"
          onClick={() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
        >
          <span className="min-w-0">
            <span className="block text-[0.72rem] font-[600] uppercase tracking-[0.12em] text-ink-3">{mode === "price" ? "Charge" : result.profit !== null ? "Profit" : def.keepHead ?? "You keep"}</span>
            <span className="tnum block text-[1.35rem] font-[640] leading-tight text-ink">
              {money(mode === "price" ? solved?.price ?? 0 : def.headline === "buyerPays" ? result.buyerPays : result.profit ?? result.payout)}
            </span>
          </span>
          <span className="tnum text-right text-[0.8rem] leading-tight text-ink-3">
            fees {money(result.totalFees)}
            <br />
            <span className="text-ink-2">See breakdown ↓</span>
          </span>
        </button>
      )}
    </div>
  );
}
