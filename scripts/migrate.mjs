// Applies drizzle/ migrations (idempotent: drizzle records what already ran).
// Runs before every Vercel build; skips cleanly when no database is configured (CI).
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.log("[migrate] no DATABASE_URL: skipping migrations");
  process.exit(0);
}
if (typeof WebSocket !== "undefined") neonConfig.webSocketConstructor = WebSocket;
const pool = new Pool({ connectionString: url });
try {
  await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
  console.log("[migrate] migrations applied");
} catch (err) {
  console.error("[migrate] failed:", err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
