import type { MetadataRoute } from "next";
import { BLOG_CATEGORIES } from "@/content/blog-categories";
import { PAGE_SIZE, publishedPosts } from "@/lib/blog";
import { CONTENT_UPDATED, SITE } from "@/lib/site";
import { ALL } from "@/fees/all";
import { loadCalcContent } from "@/lib/calc-content";

type Freq = MetadataRoute.Sitemap[number]["changeFrequency"];

/** Only indexable URLs go in: empty hubs and private pages never appear here. lastmod values are real. */
export default function sitemap(): MetadataRoute.Sitemap {
  const calcDates = ALL.map((d) => {
    const updated = loadCalcContent(d.slug).front.updated;
    return { d, updated: updated > d.verifiedAt ? updated : d.verifiedAt };
  });
  const newestCalc = calcDates.reduce((m, x) => (x.updated > m ? x.updated : m), CONTENT_UPDATED);
  const newestChange = ALL.flatMap((d) => d.changes.map((c) => c.date)).filter((d) => d <= new Date().toISOString().slice(0, 10)).sort().pop() ?? CONTENT_UPDATED;
  const stat: { path: string; lastModified: string; priority: number; changeFrequency: Freq }[] = [
    { path: "/", lastModified: newestCalc, priority: 1, changeFrequency: "weekly" },
    { path: "/compare", lastModified: newestCalc, priority: 0.9, changeFrequency: "weekly" },
    { path: "/fee-changes", lastModified: newestChange > newestCalc ? newestChange : newestCalc, priority: 0.7, changeFrequency: "weekly" },
    { path: "/methodology", lastModified: CONTENT_UPDATED, priority: 0.5, changeFrequency: "monthly" },
    { path: "/about", lastModified: CONTENT_UPDATED, priority: 0.4, changeFrequency: "yearly" },
    { path: "/contact", lastModified: CONTENT_UPDATED, priority: 0.3, changeFrequency: "yearly" },
    { path: "/privacy", lastModified: CONTENT_UPDATED, priority: 0.2, changeFrequency: "yearly" },
    { path: "/terms", lastModified: CONTENT_UPDATED, priority: 0.2, changeFrequency: "yearly" },
    { path: "/cookie-policy", lastModified: CONTENT_UPDATED, priority: 0.2, changeFrequency: "yearly" },
  ];
  const out: MetadataRoute.Sitemap = stat.map((s) => ({ url: `${SITE.url}${s.path === "/" ? "" : s.path}`, lastModified: s.lastModified, changeFrequency: s.changeFrequency, priority: s.priority }));
  for (const { d, updated } of calcDates) out.push({ url: `${SITE.url}${d.path}`, lastModified: updated, changeFrequency: "weekly", priority: 0.9 });

  const posts = publishedPosts();
  if (posts.length) {
    const newest = posts.reduce((m, p) => (p.updatedAt > m ? p.updatedAt : m), posts[0].updatedAt);
    out.push({ url: `${SITE.url}/blog`, lastModified: newest, changeFrequency: "weekly", priority: 0.6 });
  }
  for (const c of BLOG_CATEGORIES) {
    const inCat = posts.filter((p) => p.category === c.slug);
    if (!inCat.length) continue;
    const newest = inCat.reduce((m, p) => (p.updatedAt > m ? p.updatedAt : m), inCat[0].updatedAt);
    out.push({ url: `${SITE.url}/blog/${c.slug}`, lastModified: newest, changeFrequency: "weekly", priority: 0.6 });
    for (let n = 2; n <= Math.ceil(inCat.length / PAGE_SIZE); n++) out.push({ url: `${SITE.url}/blog/${c.slug}/page/${n}`, lastModified: newest, changeFrequency: "weekly", priority: 0.3 });
  }
  for (const p of posts) out.push({ url: `${SITE.url}/blog/${p.category}/${p.slug}`, lastModified: p.updatedAt, changeFrequency: "monthly", priority: 0.6 });
  return out;
}
