import Link from "next/link";
import { notFound } from "next/navigation";
import { PageShell } from "@/components/PageShell";
import { categoryBySlug } from "@/content/blog-categories";
import { PAGE_SIZE, postsIn } from "@/lib/blog";
import fs from "node:fs";
import path from "node:path";
import { renderMdx, type MdxComponents } from "@/lib/mdx";
import { JsonLd } from "@/components/JsonLd";
import { absoluteUrl } from "@/lib/seo";
import { CalcLink, Callout, Figure, Photo, Scenarios, Verdict } from "@/components/page/content-blocks";

const HUBS = path.join(process.cwd(), "content", "hubs");
const k = <T,>(x: T) => x as unknown as MdxComponents[string];

/** Hub guide copy (content/hubs/<slug>.mdx): the framework above the article list. */
async function hubIntro(slug: string, self: string) {
  const file = path.join(HUBS, `${slug}.mdx`);
  if (!fs.existsSync(file)) return null;
  const body = fs.readFileSync(file, "utf8").replace(/^---[\s\S]*?---\n/, "");
  return renderMdx(body, { format: "mdx", components: { CalcLink: k(CalcLink), Callout: k(Callout), Figure: k(Figure), Photo: k(Photo), Scenarios: k(Scenarios), Verdict: k(Verdict) }, self });
}

function formatDate(iso: string) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Shared by /blog/<category> and /blog/<category>/page/<n>. */
export async function CategoryHub({ slug, page }: { slug: string; page: number }) {
  const cat = categoryBySlug(slug);
  if (!cat) notFound();
  const all = postsIn(slug);
  const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  if (page > pages) notFound();
  const list = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const here = page === 1 ? `/blog/${slug}` : `/blog/${slug}/page/${page}`;
  const intro = page === 1 ? await hubIntro(slug, here) : null;
  return (
    <PageShell title={cat.title} crumb={cat.name} path={here} wide dek={cat.intro}>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: cat.title,
          description: cat.description,
          url: absoluteUrl(here),
          hasPart: list.map((p) => ({ "@type": "Article", headline: p.title, url: absoluteUrl(`/blog/${slug}/${p.slug}`) })),
        }}
      />
      {intro && <div className="prose-quiet mb-12 max-w-[740px]">{intro}</div>}
      {list.length > 0 && intro && <h2 className="display mb-5 text-[1.9rem] text-ink">All guides</h2>}
      {list.length === 0 ? (
        <div className="float p-7 text-ink-2">
          No guides here yet.{" "}
          <Link href="/blog" className="link">
            All topics
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {list.map((p) => (
            <li key={p.slug}>
              <Link href={`/blog/${slug}/${p.slug}`} className="float float-lift block p-6">
                <span className="block text-[1.15rem] font-[640] text-ink">{p.title}</span>
                <span className="mt-1.5 block text-[0.94rem] text-ink-3">{p.description}</span>
                <span className="mt-2 block text-[0.8rem] text-ink-4">
                  {formatDate(p.updatedAt)} · {p.readingMinutes} min read
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {pages > 1 && (
        <nav className="mt-8 flex justify-between" aria-label="Pagination">
          {page > 1 ? (
            <Link className="btn btn-ghost btn-sm" href={page === 2 ? `/blog/${slug}` : `/blog/${slug}/page/${page - 1}`}>
              ← Newer
            </Link>
          ) : (
            <span />
          )}
          {page < pages && (
            <Link className="btn btn-ghost btn-sm" href={`/blog/${slug}/page/${page + 1}`}>
              Older →
            </Link>
          )}
        </nav>
      )}
    </PageShell>
  );
}
