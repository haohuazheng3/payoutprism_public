import { notFound } from "next/navigation";
import { BLOG_CATEGORIES, categoryBySlug } from "@/content/blog-categories";
import { postsIn } from "@/lib/blog";
import { pageMetadata } from "@/lib/seo";
import { CategoryHub } from "./hub";

export const dynamicParams = false;

export function generateStaticParams() {
  return BLOG_CATEGORIES.map((c) => ({ category: c.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ category: string }> }) {
  const { category } = await params;
  const cat = categoryBySlug(category);
  if (!cat) notFound();
  return pageMetadata({ title: cat.title, description: cat.description, path: `/blog/${cat.slug}`, noindex: postsIn(cat.slug).length === 0 });
}

export default async function Page({ params }: { params: Promise<{ category: string }> }) {
  const { category } = await params;
  return <CategoryHub slug={category} page={1} />;
}
