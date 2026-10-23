import "server-only";
import { evaluate } from "@mdx-js/mdx";
import * as runtime from "react/jsx-runtime";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import type { ComponentType, ReactNode } from "react";
import { rehypeAutolink, type AutolinkOptions } from "./autolink";

export type MdxComponents = Record<string, ComponentType<Record<string, unknown>>>;

/**
 * Compiles one article body to React at build time (static pages) or per request (admin preview).
 * GFM tables/lists, heading ids for the table of contents, and automatic internal links.
 */
export async function renderMdx(
  source: string,
  opts: {
    format: "md" | "mdx";
    components?: MdxComponents;
    autolink?: AutolinkOptions["terms"];
    self?: string;
  },
): Promise<ReactNode> {
  const { default: Content } = await evaluate(source, {
    ...(runtime as unknown as Parameters<typeof evaluate>[1]),
    format: opts.format,
    remarkPlugins: [remarkGfm],
    rehypePlugins: [rehypeSlug, [rehypeAutolink, { terms: opts.autolink ?? [], self: opts.self }]],
    development: false,
  });
  return <Content components={opts.components} />;
}
