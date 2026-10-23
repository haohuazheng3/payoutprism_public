import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { bearerMatches } from "@/lib/admin";
import { db } from "@/lib/db";
import { errorGroups } from "@/lib/db/schema";
import { env, missingEnv, REQUIRED_ENV, VERCEL_ENV, isIndexable, adsenseClient } from "@/lib/env";
import { captureError, HEALTH_SOURCES } from "@/lib/errors";
import { ALL } from "@/fees/all";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Self-diagnosis. Non-200 when the database is unreachable, a required variable is missing, or
 * the error inbox holds unresolved errors of severity "error" raised by our own code (server,
 * edge, worker, cron; anonymous browser reports never count). There are no payments on this
 * site, so there is no Stripe mode to report: `payments: "none"` says so explicitly.
 *
 * The public answer carries booleans and counts only. Names of missing variables, the commit
 * and the database error text are returned only to `Authorization: Bearer CRON_SECRET`.
 */
export async function GET(req: Request) {
  const started = Date.now();
  const detailed = bearerMatches(req, env("CRON_SECRET"));
  let dbOk = false;
  let dbMs = 0;
  let unresolved = -1;
  let dbError: string | undefined;
  try {
    const t = Date.now();
    const rows = await db
      .select({ n: count() })
      .from(errorGroups)
      .where(and(isNull(errorGroups.resolvedAt), eq(errorGroups.severity, "error"), inArray(errorGroups.source, [...HEALTH_SOURCES])));
    dbMs = Date.now() - t;
    dbOk = true;
    unresolved = Number(rows[0]?.n ?? 0);
  } catch (e) {
    dbError = e instanceof Error ? e.message.slice(0, 200) : "unknown";
    await captureError(e, { route: "/api/health", severity: "warn", context: { stage: "db" } });
  }

  const missing = missingEnv();
  const ok = dbOk && missing.length === 0 && unresolved === 0;
  const oldest = ALL.map((d) => d.verifiedAt).sort()[0] ?? null;
  const body = {
    ok,
    env: VERCEL_ENV,
    time: new Date().toISOString(),
    db: { ok: dbOk, ms: dbMs, ...(detailed && dbError ? { error: dbError } : {}) },
    config: { required: REQUIRED_ENV.length, missingCount: missing.length, ...(detailed ? { missing } : {}) },
    payments: "none",
    indexable: isIndexable(),
    ads: adsenseClient() ? "adsense" : "off",
    calculators: { count: ALL.length, oldestVerification: oldest },
    errors: { unresolvedSevere: unresolved },
    ...(detailed ? { commit: (process.env.VERCEL_GIT_COMMIT_SHA ?? "local").slice(0, 12) } : {}),
    tookMs: Date.now() - started,
  };
  return Response.json(body, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}
