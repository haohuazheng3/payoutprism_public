import { bearerMatches } from "@/lib/admin";
import { env } from "@/lib/env";
import { checkHealth } from "@/lib/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public answer: booleans and counts only. Names of missing variables, the commit and the
 * database error text only for `Authorization: Bearer CRON_SECRET`.
 */
export async function GET(req: Request) {
  const { ok, body } = await checkHealth(bearerMatches(req, env("CRON_SECRET")));
  return Response.json(body, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}
