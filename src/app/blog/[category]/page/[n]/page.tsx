import { notFound } from "next/navigation";
import { BLOG_CATEGORIES, categoryBySlug } from "@/content/blog-categories";
import { PAGE_SIZE, postsIn } from "@/lib/blog";
import { pageMetadata } from "@/lib/seo";
import { CategoryHub } from "../../hub";

export const dynamicParams = false;

export function generateStaticParams() {
  return BLOG_CATEGORIES.flatMap((c) => {
    const pages = Math.ceil(postsIn(c.slug).length / PAGE_SIZE);
    return Array.from({ length: Math.max(0, pages - 1) }, (_, i) => ({ category: c.slug, n: String(i + 2) }));
  });
}

export async function generateMetadata({ params }: { params: Promise<{ category: string; n: string }> }) {
  const { category, n } = await params;
  const cat = categoryBySlug(category);
  if (!cat) notFound();
  return pageMetadata({ title: `${cat.title} (page ${n})`, description: cat.description, path: `/blog/${cat.slug}/page/${n}` });
}

export default async function Page({ params }: { params: Promise<{ category: string; n: string }> }) {
  const { category, n } = await params;
  const page = Number(n);
  if (!Number.isInteger(page) || page < 2) notFound();
  return <CategoryHub slug={category} page={page} />;
}
