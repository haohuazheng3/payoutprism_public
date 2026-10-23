"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { clearRecent, readRecent, RECENT_EVENT, type RecentItem } from "./calculator/recent";

function ago(t: number): string {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

/**
 * "Pick up where you left off": calculations saved in this browser only. Rendered below the
 * calculator (never above it) so its late appearance can't shift the page.
 */
export function RecentStrip({ exclude, title = "Your recent calculations" }: { exclude?: string; title?: string }) {
  const [items, setItems] = useState<RecentItem[]>([]);
  useEffect(() => {
    const load = () => setItems(readRecent().filter((x) => x.slug !== exclude).slice(0, 6));
    load();
    window.addEventListener(RECENT_EVENT, load);
    return () => window.removeEventListener(RECENT_EVENT, load);
  }, [exclude]);
  if (!items.length) return null;
  return (
    <section className="mt-10 animate-fade" aria-label={title}>
      <div className="mb-3 flex items-baseline justify-between gap-3 px-1">
        <h2 className="eyebrow">{title}</h2>
        <button type="button" className="text-[0.82rem] text-ink-3 hover:text-ink" onClick={clearRecent}>
          Clear
        </button>
      </div>
      <ul className="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:none]">
        {items.map((it) => (
          <li key={`${it.slug}${it.query}`} className="flex-none">
            <Link href={`${it.path}${it.query}`} className="float float-lift block w-[240px] px-4 py-3">
              <span className="block text-[0.92rem] font-[620] text-ink">{it.name}</span>
              <span className="tnum mt-0.5 block truncate text-[0.84rem] text-ink-2">{it.summary}</span>
              <span className="mt-1 block text-[0.74rem] text-ink-4">{ago(it.at)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
