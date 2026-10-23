import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { appState } from "@/lib/db/schema";

/** Small key → JSON store for operational state (health probe throttle, fee-watch summary…). */
export async function setAppState(key: string, value: unknown): Promise<void> {
  await db
    .insert(appState)
    .values({ key, value })
    .onConflictDoUpdate({ target: appState.key, set: { value, updatedAt: sql`now()` } });
}

export async function getAppState(key: string): Promise<{ value: unknown; updatedAt: Date } | null> {
  const rows = await db.select({ value: appState.value, updatedAt: appState.updatedAt }).from(appState).where(eq(appState.key, key)).limit(1);
  return rows[0] ?? null;
}
