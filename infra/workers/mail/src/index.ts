/**
 * Mail worker.
 *
 * fetch()     POST /notify (Bearer NOTIFY_TOKEN) emails the owner through the send_email binding.
 *             POST /probe runs the health probe now. GET /health answers 200.
 * scheduled() Every 30 minutes: probe <APP_URL>/api/health. On failure, email the owner (at most
 *             every 3 hours while it stays down); email again when it recovers.
 */
import { EmailMessage } from "cloudflare:email";

export interface Env {
  APP_URL: string;
  OWNER_EMAIL: string;
  FROM_ADDRESS: string;
  BRAND: string;
  NOTIFY_TOKEN: string;
  OWNER_MAIL: { send(message: EmailMessage): Promise<void> };
}

const MAX_BODY_CHARS = 200_000;
const ALERT_EVERY_MS = 3 * 60 * 60 * 1000;
const STATE_URL = "https://mail-worker.internal/health-state";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

function bearerMatches(req: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!presented) return false;
  const a = new TextEncoder().encode(presented);
  const b = new TextEncoder().encode(secret);
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function base64Utf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function wrap76(s: string): string {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += 76) out.push(s.slice(i, i + 76));
  return out.join("\r\n");
}

function headerWord(s: string): string {
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?utf-8?B?${base64Utf8(s)}?=`;
}

function buildMime(env: Env, subject: string, text: string, replyTo?: string): string {
  const domain = env.FROM_ADDRESS.split("@")[1] ?? "localhost";
  const headers = [
    `From: ${env.BRAND} Alerts <${env.FROM_ADDRESS}>`,
    `To: <${env.OWNER_EMAIL}>`,
    ...(replyTo && /^[^\s<>@]+@[^\s<>@]+$/.test(replyTo) ? [`Reply-To: <${replyTo}>`] : []),
    `Subject: ${headerWord(subject.replace(/[\r\n]+/g, " ").slice(0, 900))}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
  ];
  return `${headers.join("\r\n")}\r\n\r\n${wrap76(base64Utf8(text))}\r\n`;
}

async function sendToOwner(env: Env, subject: string, text: string, replyTo?: string): Promise<void> {
  await env.OWNER_MAIL.send(new EmailMessage(env.FROM_ADDRESS, env.OWNER_EMAIL, buildMime(env, subject, text, replyTo)));
}

interface ProbeState {
  failing: boolean;
  lastAlertAt: number;
  since: number;
}

async function readState(): Promise<ProbeState> {
  const hit = await caches.default.match(STATE_URL);
  if (!hit) return { failing: false, lastAlertAt: 0, since: 0 };
  try {
    return (await hit.json()) as ProbeState;
  } catch {
    return { failing: false, lastAlertAt: 0, since: 0 };
  }
}

async function writeState(s: ProbeState): Promise<void> {
  await caches.default.put(STATE_URL, new Response(JSON.stringify(s), { headers: { "cache-control": "max-age=604800" } }));
}

async function probe(env: Env): Promise<void> {
  const base = env.APP_URL.replace(/\/$/, "");
  const url = `${base}/api/health?probe=${Date.now()}`;
  let ok = false;
  let detail = "";
  try {
    const res = await fetch(url, { headers: { "user-agent": "site-health-probe/1.0" }, signal: AbortSignal.timeout(20000) });
    const body = await res.text();
    ok = res.status === 200;
    detail = `HTTP ${res.status}\n${body.slice(0, 1500)}`;
  } catch (e) {
    detail = `request failed: ${e instanceof Error ? e.message : String(e)}`;
  }
  const state = await readState();
  const now = Date.now();
  if (!ok) {
    if (!state.failing || now - state.lastAlertAt > ALERT_EVERY_MS) {
      await sendToOwner(env, `ALERT: ${new URL(base).host} health check failing`, `The health check at ${base}/api/health is failing.\n\n${detail}\n\nError inbox: ${base}/admin?tab=errors`);
      await writeState({ failing: true, lastAlertAt: now, since: state.failing ? state.since : now });
    }
  } else if (state.failing) {
    await sendToOwner(env, `Recovered: ${new URL(base).host} health check passing`, `Health is green again after ${Math.round((now - state.since) / 60000)} minutes.\n\n${detail}`);
    await writeState({ failing: false, lastAlertAt: 0, since: 0 });
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/health") return json({ ok: true, at: new Date().toISOString() });
    if (url.pathname === "/notify") {
      if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
      if (!bearerMatches(req, env.NOTIFY_TOKEN)) return json({ error: "unauthorized" }, 401);
      let b: { subject?: unknown; text?: unknown; replyTo?: unknown } | null;
      try {
        b = (await req.json()) as typeof b;
      } catch {
        return json({ error: "body must be JSON" }, 400);
      }
      const subject = typeof b?.subject === "string" ? b.subject.trim() : "";
      const text = typeof b?.text === "string" ? b.text : "";
      const replyTo = typeof b?.replyTo === "string" ? b.replyTo : undefined;
      if (!subject || !text) return json({ error: "subject and text are required" }, 400);
      if (text.length > MAX_BODY_CHARS) return json({ error: "text too long" }, 413);
      try {
        await sendToOwner(env, subject, text, replyTo);
        return json({ ok: true });
      } catch (e) {
        console.error("[mail] notify failed", e instanceof Error ? e.message : String(e));
        return json({ error: "send failed" }, 500);
      }
    }
    if (url.pathname === "/probe" && req.method === "POST") {
      if (!bearerMatches(req, env.NOTIFY_TOKEN)) return json({ error: "unauthorized" }, 401);
      await probe(env);
      return json({ ok: true, state: await readState() });
    }
    return json({ error: "not found" }, 404);
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(probe(env));
  },
};
