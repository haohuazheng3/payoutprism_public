import "server-only";
import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

/**
 * Neon over HTTP: one round trip per query, no connection pool to exhaust on
 * serverless. There are no interactive transactions, so every write is designed
 * to be idempotent (unique keys + onConflict…) and credit movements are guarded
 * by conditional UPDATEs rather than read-then-write.
 *
 * The client is created lazily so pages that never touch the database (and the
 * build itself) work without DATABASE_URL.
 */
let instance: NeonHttpDatabase<typeof schema> | null = null;

export function getDb(): NeonHttpDatabase<typeof schema> {
  if (!instance) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not configured");
    instance = drizzle(neon(url), { schema });
  }
  return instance;
}

export const db = new Proxy({} as NeonHttpDatabase<typeof schema>, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb(), prop, receiver);
  },
});

export { schema };
