import "server-only";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { z } from "zod";

/*
 * The written part of each calculator page lives in content/calculators/<slug>.mdx:
 * frontmatter for the SEO title, description, heading, FAQ and related calculators, and an MDX
 * body that can drop in live tables computed by the same engine as the calculator
 * (<FeeSchedule/>, <PayoutExamples/>, <MarketTable/>, <ChangeLog/>, <Example/>).
 */

const Front = z.object({
  title: z.string().min(10).max(70),
  description: z.string().min(70).max(170),
  h1: z.string().min(5),
  dek: z.string().min(20),
  updated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  related: z.array(z.string()).default([]),
  faq: z.array(z.object({ q: z.string().min(8), a: z.string().min(20) })).default([]),
});

export type CalcFront = z.infer<typeof Front>;

export interface CalcContent {
  front: CalcFront;
  body: string;
  toc: { id: string; text: string }[];
}

const DIR = path.join(process.cwd(), "content", "calculators");

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

/**
 * Without an authored article (e.g. a fresh clone of the public mirror, which never carries the
 * articles) the page still renders: generic copy plus the live tables.
 */
function fallback(slug: string): CalcContent {
  const name = slug.replace(/(^|-)([a-z])/g, (_, d, c) => `${d ? " " : ""}${c.toUpperCase()}`);
  const body = "## Fees at a glance\n\n<FeeSchedule />\n\n## What you keep at common prices\n\n<PayoutExamples prices={[10, 25, 50, 100, 250]} />\n";
  return {
    front: {
      title: `${name} Fee Calculator`,
      description: `Calculate every ${name} fee line by line and see exactly what you keep, or the price to charge to receive the amount you want.`,
      h1: `${name} Fee Calculator`,
      dek: `Enter your numbers to see each ${name} fee and what lands in your account.`,
      updated: "2026-01-01",
      related: [],
      faq: [],
    },
    body,
    toc: [
      { id: "fees-at-a-glance", text: "Fees at a glance" },
      { id: "what-you-keep-at-common-prices", text: "What you keep at common prices" },
    ],
  };
}

export function loadCalcContent(slug: string): CalcContent {
  const file = path.join(DIR, `${slug}.mdx`);
  if (!fs.existsSync(file)) return fallback(slug);
  const raw = fs.readFileSync(file, "utf8");
  const { data, content } = matter(raw);
  const front = Front.parse(data);
  const toc = [...content.matchAll(/^##\s+(.+)$/gm)].map((m) => {
    const text = m[1].replace(/[`*_]/g, "").trim();
    return { id: slugify(text), text };
  });
  return { front, body: content, toc };
}

export function hasCalcContent(slug: string): boolean {
  return fs.existsSync(path.join(DIR, `${slug}.mdx`));
}
