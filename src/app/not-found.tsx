import Link from "next/link";
import type { Metadata } from "next";
import { CATALOG } from "@/fees/catalog";

export const metadata: Metadata = { title: "Page not found", robots: { index: false, follow: true } };

export default function NotFound() {
  return (
    <div className="px-3 pt-20 sm:px-5">
      <div className="float mx-auto max-w-2xl px-6 py-12 sm:px-10">
        <p className="eyebrow">404</p>
        <h1 className="display mt-3 text-[2.3rem] text-ink">This page doesn’t exist.</h1>
        <p className="mt-3 text-[1rem] leading-relaxed text-ink-3">The link may be old, or the address mistyped. These are the calculators people use most:</p>
        <ul className="mt-6 grid gap-2 sm:grid-cols-2">
          {CATALOG.slice(0, 8).map((c) => (
            <li key={c.slug}>
              <Link href={c.path} className="inset block px-4 py-3 text-[0.95rem] font-[600] text-ink hover:bg-card-3">
                {c.name} fee calculator →
              </Link>
            </li>
          ))}
        </ul>
        <Link href="/" className="btn btn-ink mt-8">
          All calculators
        </Link>
      </div>
    </div>
  );
}
