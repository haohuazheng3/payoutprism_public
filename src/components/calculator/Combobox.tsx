"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { SelectOption } from "@/fees/types";

/**
 * Searchable picker for long lists (eBay / Amazon categories, countries). A popover under the
 * field on larger screens, a bottom sheet on phones. Opens on press, filters as you type,
 * full keyboard support (↑ ↓ Enter Esc), and the current choice is always visible.
 */
export function Combobox(props: { id: string; label: string; options: SelectOption[]; value: string; onChange: (v: string) => void; describedBy?: string }) {
  const { options, value, onChange } = props;
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const current = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return options;
    const words = needle.split(/\s+/);
    return options.filter((o) => {
      const hay = `${o.label} ${o.group ?? ""} ${o.hint ?? ""}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [q, options]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDoc);
    const t = setTimeout(() => search.current?.focus(), 30);
    return () => {
      document.removeEventListener("pointerdown", onDoc);
      clearTimeout(t);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const el = list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const choose = (v: string) => {
    onChange(v);
    setOpen(false);
    setQ("");
  };

  const listId = `${props.id}-list`;

  return (
    <div ref={wrap} className="relative">
      <button
        id={props.id}
        type="button"
        className="field w-full justify-between text-left"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-describedby={props.describedBy}
        onClick={() => {
          setOpen((o) => !o);
          setActive(Math.max(0, options.findIndex((o) => o.value === value)));
        }}
      >
        <span className="min-w-0 flex-1 truncate py-3 text-[1rem] font-[540]">
          {current?.label ?? "Choose…"}
          {current?.hint && <span className="ml-2 text-[0.86rem] font-normal text-ink-3">{current.hint}</span>}
        </span>
        <svg aria-hidden width="14" height="14" viewBox="0 0 14 14" className={`flex-none text-ink-3 transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="M3 5.5 7 9.5l4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/25 animate-fade sm:hidden" aria-hidden onClick={() => setOpen(false)} />
          <div
            className="float fixed inset-x-0 bottom-0 z-50 flex max-h-[78dvh] flex-col rounded-b-none p-3 animate-rise safe-bottom sm:absolute sm:inset-x-0 sm:bottom-auto sm:top-[calc(100%+8px)] sm:max-h-[380px] sm:rounded-[22px] sm:pb-3"
            role="dialog"
            aria-label={props.label}
          >
            <div className="mx-auto mb-2 h-1 w-10 flex-none rounded-full bg-line-2 sm:hidden" aria-hidden />
            <div className="field flex-none !min-h-[46px]">
              <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" className="text-ink-3">
                <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <input
                ref={search}
                value={q}
                placeholder={`Search ${props.label.toLowerCase()}`}
                aria-controls={listId}
                aria-activedescendant={filtered[active] ? `${props.id}-opt-${active}` : undefined}
                className="!h-[44px] !text-[1rem] !font-normal"
                onChange={(e) => {
                  setQ(e.target.value);
                  setActive(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setActive((a) => Math.min(filtered.length - 1, a + 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setActive((a) => Math.max(0, a - 1));
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    if (filtered[active]) choose(filtered[active].value);
                  } else if (e.key === "Escape") {
                    setOpen(false);
                    (document.getElementById(props.id) as HTMLButtonElement | null)?.focus();
                  }
                }}
              />
            </div>
            <ul ref={list} id={listId} role="listbox" aria-label={props.label} className="mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {filtered.length === 0 && <li className="px-3 py-6 text-center text-[0.92rem] text-ink-3">Nothing matches “{q}”.</li>}
              {filtered.map((o, i) => {
                const header = o.group && (i === 0 || filtered[i - 1].group !== o.group) ? o.group : null;
                return (
                  <li key={o.value} role="presentation">
                    {header && <div className="eyebrow px-3 pb-1 pt-3 !text-[0.68rem]">{header}</div>}
                    <div
                      id={`${props.id}-opt-${i}`}
                      data-index={i}
                      role="option"
                      aria-selected={o.value === value}
                      className={`flex min-h-[46px] cursor-pointer items-center justify-between gap-3 rounded-[14px] px-3 py-2 text-[0.96rem] ${
                        i === active ? "bg-card-3" : ""
                      } ${o.value === value ? "font-[620] text-ink" : "text-ink-2"}`}
                      onPointerEnter={() => setActive(i)}
                      onClick={() => choose(o.value)}
                    >
                      <span className="min-w-0">{o.label}</span>
                      {o.hint && <span className="flex-none text-right text-[0.82rem] text-ink-3 tnum">{o.hint}</span>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
