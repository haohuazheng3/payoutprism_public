import Link from "next/link";
import { notFound } from "next/navigation";
import { categoryBySlug } from "@/content/blog-categories";
import { getPost, publishedPosts } from "@/lib/blog";
import { renderMdx, type MdxComponents } from "@/lib/mdx";
import { articleLd, breadcrumbLd, faqLd, pageMetadata } from "@/lib/seo";
import { JsonLd } from "@/components/JsonLd";
import { CalcLink, Callout, Figure, Photo, Scenarios, Verdict } from "@/components/page/content-blocks";
import { CATALOG } from "@/fees/catalog";
import { SITE } from "@/lib/site";

export const dynamicParams = false;

export function generateStaticParams() {
  return publishedPosts().map((p) => ({ category: p.category, slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ category: string; slug: string }> }) {
  const { category, slug } = await params;
  const post = getPost(category, slug);
  if (!post) notFound();
  return pageMetadata({ title: post.title, description: post.description, path: `/blog/${category}/${slug}`, type: "article", absoluteTitle: true });
}

function formatDate(iso: string) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

const c = <T,>(x: T) => x as unknown as MdxComponents[string];

export default async function Article({ params }: { params: Promise<{ category: string; slug: string }> }) {
  const { category, slug } = await params;
  const post = getPost(category, slug);
  const cat = categoryBySlug(category);
  if (!post || !cat) notFound();
  const path = `/blog/${category}/${slug}`;
  const components: MdxComponents = { CalcLink: c(CalcLink), Callout: c(Callout), Figure: c(Figure), Photo: c(Photo), Scenarios: c(Scenarios), Verdict: c(Verdict) };
  const autolink = CATALOG.flatMap((x) => [{ phrase: `${x.name} fee calculator`, href: x.path }, { phrase: `${x.name} fees`, href: x.path }]);
  const body = await renderMdx(post.body, { format: "mdx", components, autolink, self: path });
  const related = post.related.map((s) => CATALOG.find((x) => x.slug === s)).filter((x): x is (typeof CATALOG)[number] => Boolean(x));
  const firstImage = /<Figure[^>]*src="([^"]+)"/.exec(post.body)?.[1];
  return (
    <div className="mx-auto max-w-[1180px] px-3 sm:px-5">
      <JsonLd data={articleLd({ title: post.title, description: post.description, path, publishedAt: post.publishedAt, updatedAt: post.updatedAt, image: firstImage })} />
      <JsonLd data={breadcrumbLd([{ name: "Home", path: "/" }, { name: "Guides", path: "/blog" }, { name: cat.name, path: `/blog/${category}` }, { name: post.title, path }])} />
      {post.faq.length > 0 && <JsonLd data={faqLd(post.faq)} />}
      <nav aria-label="Breadcrumb" className="pt-8 text-[0.84rem] text-ink-3">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link href="/" className="hover:text-ink">
              Home
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li>
            <Link href="/blog" className="hover:text-ink">
              Guides
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li>
            <Link href={`/blog/${category}`} className="hover:text-ink">
              {cat.name}
            </Link>
          </li>
        </ol>
      </nav>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,740px)_220px] lg:gap-14">
        <article className="min-w-0">
          <header className="pb-6 pt-5">
            <h1 className="display text-[2.2rem] text-ink sm:text-[3rem]">{post.title}</h1>
            <p className="mt-4 text-[1.08rem] leading-relaxed text-ink-3">{post.description}</p>
            <p className="mt-4 text-[0.86rem] text-ink-4">
              By {SITE.name} · Published <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>
              {post.updatedAt !== post.publishedAt && (
                <>
                  {" "}
                  · Updated <time dateTime={post.updatedAt}>{formatDate(post.updatedAt)}</time>
                </>
              )}{" "}
              · {post.readingMinutes} min read
            </p>
          </header>
          {post.headings.length >= 4 && (
            <nav aria-label="Contents" className="float mb-8 px-5 py-4 lg:hidden">
              <div className="eyebrow mb-2">Contents</div>
              <ol className="list-decimal space-y-1 pl-5 text-[0.93rem] text-ink-2">
                {post.headings.map((h) => (
                  <li key={h.id}>
                    <a href={`#${h.id}`} className="hover:text-ink">
                      {h.text}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          )}
          <div className="prose-quiet">{body}</div>

          {post.faq.length > 0 && (
            <section id="faq" className="mt-16" aria-labelledby="faq-h">
              <h2 id="faq-h" className="display text-[1.9rem] text-ink sm:text-[2.1rem]">
                Questions people ask
              </h2>
              <div className="mt-6 space-y-3">
                {post.faq.map((f) => (
                  <details key={f.q} className="float group px-5 py-1 [&_summary::-webkit-details-marker]:hidden">
                    <summary className="flex min-h-[56px] list-none items-center justify-between gap-4 py-3 text-[1rem] font-[600] text-ink">
                      {f.q}
                      <span aria-hidden className="grid h-7 w-7 flex-none place-items-center rounded-full bg-card-2 text-ink-3 transition-transform group-open:rotate-45">
                        +
                      </span>
                    </summary>
                    <p className="pb-4 text-[0.98rem] leading-relaxed text-ink-2">{f.a}</p>
                  </details>
                ))}
              </div>
            </section>
          )}

          {related.length > 0 && (
            <section className="mt-16" aria-labelledby="next-h">
              <h2 id="next-h" className="display text-[1.9rem] text-ink sm:text-[2.1rem]">
                Run your own numbers
              </h2>
              <ul className="mt-6 grid gap-3 sm:grid-cols-2">
                {related.map((r) => (
                  <li key={r.slug}>
                    <Link href={r.path} className="float float-lift flex h-full flex-col px-5 py-4">
                      <span className="text-[1.02rem] font-[650] text-ink">{r.name} calculator</span>
                      <span className="mt-1 text-[0.88rem] leading-snug text-ink-3">{r.blurb}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {post.sources.length > 0 && (
            <section id="sources" className="mt-16" aria-labelledby="sources-h">
              <h2 id="sources-h" className="display text-[1.9rem] text-ink sm:text-[2.1rem]">
                Sources
              </h2>
              <p className="mt-3 text-[0.96rem] leading-relaxed text-ink-2">
                Fee figures come from each platform’s own pages and were run through our calculators on {formatDate(post.updatedAt)}.{" "}
                <Link href="/methodology" className="link">
                  How we check fees
                </Link>
              </p>
              <ul className="mt-5 space-y-2.5">
                {post.sources.map((s) => (
                  <li key={s.url} className="text-[0.93rem] leading-snug">
                    <a href={s.url} target="_blank" rel="noopener noreferrer" className="link font-[540]">
                      {s.publisher ? `${s.publisher}: ` : ""}
                      {s.title}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </article>
        <aside className="hidden lg:block">
          {post.headings.length >= 4 && (
            <nav aria-label="On this page" className="sticky top-28 pt-8">
              <div className="eyebrow mb-3">On this page</div>
              <ul className="space-y-2 border-l border-line text-[0.88rem]">
                {post.headings.map((h) => (
                  <li key={h.id}>
                    <a href={`#${h.id}`} className="-ml-px block border-l border-transparent pl-3 text-ink-3 hover:border-ink-3 hover:text-ink">
                      {h.text}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </aside>
      </div>
    </div>
  );
}
