#!/usr/bin/env -S npx tsx
/**
 * Daily watch on every official fee page the calculators are built on.
 *
 *   DATABASE_URL=… npx tsx scripts/fee-watch.ts [--dry]
 *
 * For each source URL (from the calculator modules themselves, so the list can never drift):
 * download the page, keep only the fee-bearing text (segments that mention a fee/rate/charge and
 * contain a number), hash it and compare with the last run stored in `fee_watch`. A change marks
 * the row "changed", opens one GitHub issue listing every changed page with the lines that
 * appeared/disappeared, and emails the owner. A person then reads the new page and updates the
 * calculator; nothing is changed automatically. Pages that refuse plain HTTP are marked
 * "unreachable" and listed for a manual check instead.
 */
import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { ALL } from "../src/fees/all";

const DRY = process.argv.includes("--dry");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const FEE_WORD = /(fee|fees|rate|charge|commission|percent|processing|transaction|listing|payout|withdraw|subscription|per order|per sale|minimum|maximum|cap)/i;
const HAS_NUMBER = /(\d+(\.\d+)?\s?%|[$£€¥₹]\s?\d|\d+\s?(USD|GBP|EUR|CAD|AUD|cents?))/i;

function textOf(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|template)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|tr|td|th|h[1-6]|div|section|article|dt|dd)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#36;|&dollar;/g, "$")
    .replace(/&pound;/g, "£")
    .replace(/&euro;/g, "€")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&[a-z]+;/gi, " ");
}

const clean = (l: string) => l.replace(/\b(\d+)\s+(minutes?|hours?|days?)\s+ago\b/gi, "").replace(/©\s?\d{4}/g, "").replace(/\b[a-f0-9]{16,}\b/gi, "").trim();

/**
 * The fee-bearing lines of a page, normalised so cosmetic changes don't count: sentences that
 * name a fee and carry a number, plus short lines with a rate or amount (table cells such as
 * "0.48%"). Pages with almost no such lines fall back to all of their text.
 */
export function feeFingerprint(html: string): string[] {
  const all = textOf(html)
    .split(/\n|(?<=[.!?])\s+(?=[A-Z])/)
    .map((l) => clean(l.replace(/\s+/g, " ")))
    .filter((l) => l.length >= 2 && l.length <= 600);
  const fee = all.filter((l) => HAS_NUMBER.test(l) && (FEE_WORD.test(l) || l.length <= 80));
  return [...new Set(fee.length >= 3 ? fee : all.filter((l) => l.length >= 12))];
}

/** A JSON API answer (e.g. Zendesk help-center article) → its text fields, as HTML-ish text. */
function jsonText(raw: string): string {
  const out: string[] = [];
  const walk = (v: unknown, key = "") => {
    if (typeof v === "string") {
      if (!/(_at|url|id)$/i.test(key)) out.push(v);
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  try {
    walk(JSON.parse(raw));
  } catch {
    return raw;
  }
  return out.join("\n");
}

interface Row {
  url: string;
  hash: string | null;
  excerpt: string | null;
  status: string;
}

async function main() {
  const urls = new Map<string, string>();
  // Watch the machine-readable twin when a page blocks plain HTTP (e.g. a help center's JSON API).
  for (const d of ALL) for (const s of d.sources) if (!urls.has(s.watch ?? s.url)) urls.set(s.watch ?? s.url, d.slug);
  const sql = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null;
  if (!sql && !DRY) throw new Error("DATABASE_URL is required (or pass --dry)");

  const changed: { url: string; calculator: string; added: string[]; removed: string[] }[] = [];
  const newlyUnreachable: { url: string; calculator: string; status: number | string }[] = [];
  let ok = 0;

  for (const [url, calculator] of urls) {
    let status = 0;
    let lines: string[] = [];
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9" }, redirect: "follow", signal: AbortSignal.timeout(25000) });
      status = res.status;
      if (res.ok) {
        const raw = await res.text();
        lines = (res.headers.get("content-type") ?? "").includes("json") ? feeFingerprint(jsonText(raw)) : feeFingerprint(raw);
      }
    } catch (e) {
      status = -1;
      console.log(`! ${url}: ${e instanceof Error ? e.message : String(e)}`);
    }
    const reachable = status >= 200 && status < 300 && lines.length >= 1;
    const hash = reachable ? createHash("sha256").update(lines.join("\n")).digest("hex") : null;
    const prev = sql ? ((await sql`SELECT url, hash, excerpt, status FROM fee_watch WHERE url = ${url}`) as Row[])[0] : undefined;
    console.log(`${reachable ? (prev?.hash && prev.hash !== hash ? "CHANGED" : "ok     ") : "UNREACH"} ${status} ${calculator} ${url} (${lines.length} fee lines)`);
    if (DRY || !sql) continue;

    if (!reachable) {
      if (prev?.status !== "unreachable") newlyUnreachable.push({ url, calculator, status });
      await sql`INSERT INTO fee_watch (url, calculator, http_status, status, checked_at)
        VALUES (${url}, ${calculator}, ${status}, 'unreachable', now())
        ON CONFLICT (url) DO UPDATE SET http_status = ${status}, status = CASE WHEN fee_watch.status = 'changed' THEN 'changed' ELSE 'unreachable' END, checked_at = now(), calculator = ${calculator}`;
      continue;
    }
    const excerpt = lines.join("\n").slice(0, 20000);
    if (!prev || !prev.hash) {
      await sql`INSERT INTO fee_watch (url, calculator, hash, excerpt, http_status, status, checked_at)
        VALUES (${url}, ${calculator}, ${hash}, ${excerpt}, ${status}, 'ok', now())
        ON CONFLICT (url) DO UPDATE SET hash = ${hash}, excerpt = ${excerpt}, http_status = ${status}, status = 'ok', checked_at = now(), calculator = ${calculator}`;
      ok++;
      continue;
    }
    if (prev.hash !== hash) {
      const before = new Set((prev.excerpt ?? "").split("\n"));
      const after = new Set(lines);
      changed.push({ url, calculator, added: lines.filter((l) => !before.has(l)).slice(0, 25), removed: [...before].filter((l) => l && !after.has(l)).slice(0, 25) });
      await sql`UPDATE fee_watch SET hash = ${hash}, excerpt = ${excerpt}, http_status = ${status}, status = 'changed', changed_at = now(), checked_at = now() WHERE url = ${url}`;
    } else {
      ok++;
      await sql`UPDATE fee_watch SET http_status = ${status}, checked_at = now(), status = CASE WHEN status = 'changed' THEN 'changed' ELSE 'ok' END WHERE url = ${url}`;
    }
  }

  if (sql) await sql`INSERT INTO app_state (key, value, updated_at) VALUES ('feewatch:last', ${JSON.stringify({ at: new Date().toISOString(), urls: urls.size, ok, changed: changed.length, unreachable: newlyUnreachable.length })}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now()`;
  console.log(`\n${urls.size} pages · ${ok} unchanged · ${changed.length} changed · ${newlyUnreachable.length} newly unreachable`);
  if (DRY || (!changed.length && !newlyUnreachable.length)) return;

  const body = [
    changed.length ? "## Fee pages that changed\n\nRead each page, update the calculator module and its `changes`, bump `verifiedAt`, then mark the row reviewed in /admin?tab=watch.\n" : "",
    ...changed.map(
      (c) =>
        `### ${c.calculator}: ${c.url}\n\n**New lines**\n${c.added.map((l) => `- ${l}`).join("\n") || "- (none)"}\n\n**Gone**\n${c.removed.map((l) => `- ${l}`).join("\n") || "- (none)"}\n`,
    ),
    newlyUnreachable.length ? `## Pages that stopped answering plain HTTP (check by hand)\n\n${newlyUnreachable.map((u) => `- ${u.calculator}: ${u.url} (${u.status})`).join("\n")}\n` : "",
  ].join("\n");
  const title = `Fee watch: ${changed.length} page(s) changed${newlyUnreachable.length ? `, ${newlyUnreachable.length} unreachable` : ""} (${new Date().toISOString().slice(0, 10)})`;

  if (process.env.GITHUB_TOKEN && process.env.GITHUB_REPOSITORY) {
    const res = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/issues`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
      body: JSON.stringify({ title, body: body.slice(0, 60000), labels: ["fee-watch"] }),
    });
    console.log(`GitHub issue: ${res.status}`);
  }
  if (process.env.MAIL_WORKER_URL && process.env.MAIL_WORKER_TOKEN) {
    const res = await fetch(`${process.env.MAIL_WORKER_URL.replace(/\/$/, "")}/notify`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.MAIL_WORKER_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ subject: title, text: body.slice(0, 19000) }),
    });
    console.log(`owner notified: ${res.status}`);
  }
}

if (!process.env.VITEST) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
