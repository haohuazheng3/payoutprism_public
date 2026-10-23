import "server-only";
import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { db } from "./db";
import { errorGroups } from "./db/schema";
import { missingEnv, REQUIRED_ENV, VERCEL_ENV, isIndexable, adsenseClient } from "./env";
import { captureError, HEALTH_SOURCES } from "./errors";
import { ALL } from "@/fees/all";

export interface Health {
  ok: boolean;
  body: Record<string, unknown>;
}

/**
 * Self-diagnosis shared by /api/health and the 30-minute cron probe. Not ok when the database
 * is unreachable, a required variable is missing, or the error inbox holds unresolved errors of
 * severity "error" raised by our own code (anonymous browser reports never count).
 */
export async function checkHealth(detailed: boolean): Promise<Health> {
  const started = Date.now();
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
  return {
    ok,
    body: {
      ok,
      env: VERCEL_ENV,
      time: new Date().toISOString(),
      db: { ok: dbOk, ms: dbMs, ...(detailed && dbError ? { error: dbError } : {}) },
      config: { required: REQUIRED_ENV.length, missingCount: missing.length, ...(detailed ? { missing } : {}) },
      // There are no payments on this site, so there is no Stripe key to report as live or test.
      payments: "none",
      indexable: isIndexable(),
      ads: adsenseClient() ? "adsense" : "off",
      calculators: { count: ALL.length, oldestVerification: oldest },
      errors: { unresolvedSevere: unresolved },
      ...(detailed ? { commit: (process.env.VERCEL_GIT_COMMIT_SHA ?? "local").slice(0, 12) } : {}),
      tookMs: Date.now() - started,
    },
  };
}
