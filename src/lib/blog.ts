import "server-only";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import GithubSlugger from "github-slugger";
import { BLOG_CATEGORIES } from "@/content/blog-categories";

/*
 * Publishing pipeline: one file per article, content/blog/<category>/<slug>.mdx, with frontmatter
 * (title, description, publishedAt, updatedAt, keywords[], draft?, faq?). Commit + push → the
 * Deploy workflow builds → the article, its hub, the sitemap and llms.txt update together.
 * Drafts and future-dated posts never render publicly.
 */

export interface Post {
  slug: string;
  category: string;
  title: string;
  description: string;
  publishedAt: string;
  updatedAt: string;
  keywords: string[];
  draft: boolean;
  faq: { q: string; a: string }[];
  /** Official pages the numbers come from, listed under the article. */
  sources: { title: string; url: string; publisher: string }[];
  /** Calculator slugs to show as next steps. */
  related: string[];
  body: string;
  readingMinutes: number;
  headings: { id: string; text: string }[];
}

export const PAGE_SIZE = 10;
const ROOT = path.join(process.cwd(), "content", "blog");
let cache: Post[] | null = null;

function isoDate(v: unknown, fallback: string): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  return fallback;
}

export function extractHeadings(body: string) {
  const slugger = new GithubSlugger();
  const out: { id: string; text: string }[] = [];
  let fence = false;
  for (const raw of body.split("\n")) {
    if (/^(```|~~~)/.test(raw.trim())) fence = !fence;
    if (fence) continue;
    const m = /^##\s+(.+?)\s*#*$/.exec(raw.trimEnd());
    if (m) {
      const text = m[1].replace(/[*_`]/g, "").trim();
      out.push({ id: slugger.slug(text), text });
    }
  }
  return out;
}

function load(): Post[] {
  if (cache) return cache;
  const posts: Post[] = [];
  for (const cat of BLOG_CATEGORIES) {
    const dir = path.join(ROOT, cat.slug);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!/\.mdx?$/.test(file)) continue;
      const { data, content } = matter(fs.readFileSync(path.join(dir, file), "utf8"));
      const slug = file.replace(/\.mdx?$/, "");
      const publishedAt = isoDate(data.publishedAt, "2999-01-01");
      const words = content.split(/\s+/).filter(Boolean).length;
      posts.push({
        slug,
        category: cat.slug,
        title: String(data.title ?? slug),
        description: String(data.description ?? ""),
        publishedAt,
        updatedAt: isoDate(data.updatedAt, publishedAt),
        keywords: Array.isArray(data.keywords) ? data.keywords.map(String) : [],
        draft: data.draft === true,
        faq: Array.isArray(data.faq) ? data.faq.filter((f: { q?: unknown; a?: unknown }) => typeof f?.q === "string" && typeof f?.a === "string") : [],
        sources: Array.isArray(data.sources) ? data.sources.filter((x: { title?: unknown; url?: unknown }) => typeof x?.title === "string" && typeof x?.url === "string").map((x: { title: string; url: string; publisher?: string }) => ({ title: x.title, url: x.url, publisher: String(x.publisher ?? "") })) : [],
        related: Array.isArray(data.related) ? data.related.map(String) : [],
        body: content,
        readingMinutes: Math.max(1, Math.round(words / 230)),
        headings: extractHeadings(content),
      });
    }
  }
  cache = posts.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  return cache;
}

const today = () => new Date().toISOString().slice(0, 10);

/** Published = not a draft and not dated in the future. */
export function publishedPosts(): Post[] {
  return load().filter((p) => !p.draft && p.publishedAt <= today());
}

export function postsIn(category: string): Post[] {
  return publishedPosts().filter((p) => p.category === category);
}

export function getPost(category: string, slug: string): Post | undefined {
  return publishedPosts().find((p) => p.category === category && p.slug === slug);
}
