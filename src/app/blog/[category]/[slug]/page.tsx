import Link from "next/link";
import { notFound } from "next/navigation";
import { categoryBySlug } from "@/content/blog-categories";
import { getPost, publishedPosts } from "@/lib/blog";
import { renderMdx, type MdxComponents } from "@/lib/mdx";
import { articleLd, breadcrumbLd, faqLd, pageMetadata } from "@/lib/seo";
import { JsonLd } from "@/components/JsonLd";
import { CalcLink, Callout } from "@/components/page/content-blocks";
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
  return pageMetadata({ title: post.title, description: post.description, path: `/blog/${category}/${slug}`, type: "article" });
}

function formatDate(iso: string) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export default async function Article({ params }: { params: Promise<{ category: string; slug: string }> }) {
  const { category, slug } = await params;
  const post = getPost(category, slug);
  const cat = categoryBySlug(category);
  if (!post || !cat) notFound();
  const path = `/blog/${category}/${slug}`;
  const components: MdxComponents = { CalcLink: CalcLink as unknown as MdxComponents[string], Callout: Callout as unknown as MdxComponents[string] };
  const autolink = CATALOG.flatMap((c) => [{ phrase: `${c.name} fee calculator`, href: c.path }, { phrase: `${c.name} fees`, href: c.path }]);
  const body = await renderMdx(post.body, { format: "mdx", components, autolink, self: path });
  return (
    <div className="mx-auto max-w-[1180px] px-3 sm:px-5">
      <JsonLd data={articleLd({ title: post.title, description: post.description, path, publishedAt: post.publishedAt, updatedAt: post.updatedAt })} />
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
      <article className="max-w-[740px]">
        <header className="pb-8 pt-5">
          <h1 className="display text-[2.3rem] text-ink sm:text-[3rem]">{post.title}</h1>
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
        <div className="prose-quiet">{body}</div>
      </article>
    </div>
  );
}
