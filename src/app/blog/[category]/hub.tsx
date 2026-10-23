import Link from "next/link";
import { notFound } from "next/navigation";
import { PageShell } from "@/components/PageShell";
import { categoryBySlug } from "@/content/blog-categories";
import { PAGE_SIZE, postsIn } from "@/lib/blog";

function formatDate(iso: string) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Shared by /blog/<category> and /blog/<category>/page/<n>. */
export function CategoryHub({ slug, page }: { slug: string; page: number }) {
  const cat = categoryBySlug(slug);
  if (!cat) notFound();
  const all = postsIn(slug);
  const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  if (page > pages) notFound();
  const list = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const path = page === 1 ? `/blog/${slug}` : `/blog/${slug}/page/${page}`;
  return (
    <PageShell title={cat.title} crumb={cat.name} path={path} wide dek={cat.intro}>
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
