import "server-only";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { sha256 } from "./ids";

export interface RateResult {
  ok: boolean;
  count: number;
  limit: number;
  resetIn: number;
}

/**
 * Fixed-window limiter in Postgres: one round trip, atomic via ON CONFLICT.
 * Used on top of the Vercel WAF rule for per-feature limits (contact form,
 * checkout, upload signing, script generation, job creation, error ingest).
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<RateResult> {
  const res = await db.execute(sql`
    INSERT INTO rate_limits (key, window_start, count)
    VALUES (${key}, now(), 1)
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limits.window_start < now() - make_interval(secs => ${windowSeconds})
                   THEN 1 ELSE rate_limits.count + 1 END,
      window_start = CASE WHEN rate_limits.window_start < now() - make_interval(secs => ${windowSeconds})
                   THEN now() ELSE rate_limits.window_start END
    RETURNING count,
      GREATEST(0, CEIL(EXTRACT(EPOCH FROM (window_start + make_interval(secs => ${windowSeconds}) - now()))))::int AS reset_in
  `);
  const row = (res.rows?.[0] ?? {}) as { count?: number; reset_in?: number };
  const count = Number(row.count ?? 1);
  return { ok: count <= limit, count, limit, resetIn: Number(row.reset_in ?? windowSeconds) };
}

export function clientIp(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return headers.get("x-real-ip") || headers.get("x-vercel-forwarded-for") || "0.0.0.0";
}

/** Store IPs only as salted hashes. */
export function ipHash(ip: string): string {
  return sha256(`fc:${ip}`).slice(0, 24);
}

export function tooMany(r: RateResult): Response {
  return Response.json(
    { error: "Too many requests. Please wait a moment and try again." },
    { status: 429, headers: { "Retry-After": String(Math.max(1, r.resetIn)), "Cache-Control": "no-store" } },
  );
}
