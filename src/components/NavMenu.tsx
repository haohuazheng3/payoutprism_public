"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CalculatorCategory, CalculatorSummary } from "@/fees/types";
import { CATEGORY_LABEL, CATEGORY_ORDER } from "@/fees/categories";
import { track } from "@/lib/analytics";

/**
 * One menu for every screen size: a floating panel with a search box on top and the
 * calculators grouped by kind below. ⌘K / Ctrl+K or "/" opens it from anywhere.
 */
export function NavMenu({ items }: { items: CalculatorSummary[] }) {
  const [openOn, setOpenOn] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  // The menu belongs to the page it was opened on: navigating closes it.
  const open = openOn === pathname;
  const setOpen = (v: boolean) => setOpenOn(v ? pathname : null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        setOpenOn(window.location.pathname);
      } else if (e.key === "Escape") setOpenOn(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => input.current?.focus(), 20);
    document.documentElement.style.overflow = "hidden";
    return () => {
      clearTimeout(t);
      document.documentElement.style.overflow = "";
    };
  }, [open]);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((i) => `${i.name} ${i.blurb} ${CATEGORY_LABEL[i.category]}`.toLowerCase().includes(needle));
  }, [q, items]);

  const grouped = useMemo(() => {
    const m = new Map<CalculatorCategory, CalculatorSummary[]>();
    for (const c of CATEGORY_ORDER) m.set(c, []);
    for (const r of results) m.get(r.category)?.push(r);
    return [...m.entries()].filter(([, v]) => v.length);
  }, [results]);

  const flat = grouped.flatMap(([, v]) => v);

  return (
    <>
      <button
        type="button"
        className="btn btn-ink btn-sm gap-2"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setOpen(true);
          track("nav_open");
        }}
      >
        <svg aria-hidden width="15" height="15" viewBox="0 0 16 16">
          <circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="m10.6 10.6 3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <span>Calculators</span>
        <kbd className="hidden rounded-md bg-white/15 px-1.5 py-0.5 text-[0.7rem] font-[600] lg:inline">⌘K</kbd>
      </button>

      {open && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Find a calculator">
          <div className="absolute inset-0 bg-[color-mix(in_oklab,var(--void)_70%,transparent)] backdrop-blur-sm animate-fade" onClick={() => setOpen(false)} aria-hidden />
          <div className="float absolute inset-x-3 top-3 bottom-3 mx-auto flex max-w-2xl flex-col overflow-hidden animate-rise sm:top-[8vh] sm:bottom-auto sm:max-h-[78vh]">
            <div className="flex items-center gap-2 border-b border-line p-3">
              <div className="field flex-1 !min-h-[48px] !bg-card-2">
                <svg aria-hidden width="17" height="17" viewBox="0 0 16 16" className="text-ink-3">
                  <circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
                  <path d="m10.6 10.6 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <input
                  ref={input}
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setActive(0);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setActive((a) => Math.min(flat.length - 1, a + 1));
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setActive((a) => Math.max(0, a - 1));
                    } else if (e.key === "Enter" && flat[active]) {
                      e.preventDefault();
                      track("nav_search_go", { to: flat[active].slug, q });
                      router.push(flat[active].path);
                      setOpen(false);
                    }
                  }}
                  placeholder="Etsy, PayPal, Poshmark…"
                  aria-label="Search calculators"
                  className="!h-[46px] !text-[1.02rem] !font-normal"
                />
              </div>
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
              {flat.length === 0 && (
                <p className="px-3 py-10 text-center text-ink-3">
                  No calculator for “{q}” yet.{" "}
                  <Link href="/contact" className="link">
                    Ask for one
                  </Link>
                </p>
              )}
              {grouped.map(([cat, list]) => (
                <div key={cat} className="mb-3">
                  <div className="eyebrow px-3 pb-1.5 pt-2">{CATEGORY_LABEL[cat]}</div>
                  <ul className="grid gap-1 sm:grid-cols-2">
                    {list.map((c) => {
                      const i = flat.indexOf(c);
                      return (
                        <li key={c.slug}>
                          <Link
                            href={c.path}
                            onPointerEnter={() => setActive(i)}
                            onClick={() => track("nav_pick", { to: c.slug, q })}
                            className={`flex min-h-[56px] flex-col justify-center rounded-[16px] px-3 py-2 transition-colors ${i === active ? "bg-card-3" : "hover:bg-card-2"} ${pathname === c.path ? "ring-1 ring-line-2" : ""}`}
                          >
                            <span className="text-[0.96rem] font-[600] text-ink">{c.name}</span>
                            <span className="line-clamp-1 text-[0.8rem] text-ink-3">{c.blurb}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
              <div className="mt-2 grid gap-2 border-t border-line px-1 pt-3 sm:grid-cols-3">
                <Link href="/compare" className="rounded-[16px] px-3 py-2.5 text-[0.92rem] font-[560] text-ink hover:bg-card-2">
                  Compare platforms →
                </Link>
                <Link href="/fee-changes" className="rounded-[16px] px-3 py-2.5 text-[0.92rem] font-[560] text-ink hover:bg-card-2">
                  Fee changes →
                </Link>
                <Link href="/methodology" className="rounded-[16px] px-3 py-2.5 text-[0.92rem] font-[560] text-ink hover:bg-card-2">
                  How we check fees →
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
