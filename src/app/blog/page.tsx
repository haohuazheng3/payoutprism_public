import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { pageMetadata } from "@/lib/seo";
import { BLOG_CATEGORIES } from "@/content/blog-categories";
import { postsIn, publishedPosts } from "@/lib/blog";

export function generateMetadata() {
  const any = publishedPosts().length > 0;
  return pageMetadata({
    title: "Guides",
    description: "Guides to platform fees, payments and pricing for sellers, freelancers and creators: sourced, dated and built around worked examples.",
    path: "/blog",
    noindex: !any,
  });
}

export default function BlogHome() {
  const posts = publishedPosts();
  const featured = posts.slice(0, 3);
  return (
    <PageShell title="Guides" path="/blog" wide dek="Platform fees, payments and pricing, one clear question at a time. Every number is sourced and dated, and every guide links to the calculator that does the math for you.">
      {featured.length > 0 ? (
        <ul className="grid gap-4 md:grid-cols-3">
          {featured.map((p) => (
            <li key={`${p.category}/${p.slug}`}>
              <Link href={`/blog/${p.category}/${p.slug}`} className="float float-lift block h-full p-6">
                <span className="eyebrow">{BLOG_CATEGORIES.find((c) => c.slug === p.category)?.name}</span>
                <span className="mt-2 block text-[1.15rem] font-[640] leading-snug text-ink">{p.title}</span>
                <span className="mt-2 block text-[0.92rem] text-ink-3">{p.description}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="float p-7 text-[1rem] text-ink-2">
          The first guides are being written. Meanwhile, every calculator page explains its platform’s fees in full.{" "}
          <Link href="/" className="link">
            Browse the calculators
          </Link>
        </div>
      )}
      <h2 className="eyebrow mb-4 mt-14">Topics</h2>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {BLOG_CATEGORIES.map((c) => {
          const n = postsIn(c.slug).length;
          return (
            <li key={c.slug}>
              <Link href={`/blog/${c.slug}`} className="float float-lift block h-full p-5">
                <span className="block text-[1.02rem] font-[640] text-ink">{c.name}</span>
                <span className="mt-1 block text-[0.86rem] leading-snug text-ink-3">{c.description}</span>
                <span className="mt-3 block text-[0.78rem] text-ink-4">{n ? `${n} guide${n === 1 ? "" : "s"}` : "Coming soon"}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </PageShell>
  );
}
