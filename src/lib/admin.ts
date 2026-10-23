import { createHmac, timingSafeEqual } from "node:crypto";

/*
 * The owner's back office has no user accounts behind it (the public site needs none): one
 * password (ADMIN_PASSWORD) exchanges for a signed, HttpOnly session cookie. The cookie value is
 * `<expiry unix seconds>.<hex HMAC-SHA256(expiry, ADMIN_SESSION_SECRET)>`, so it can be checked in
 * the proxy without a database round trip and rotating the secret signs everyone out.
 */

export const ADMIN_COOKIE = "admin_session";
export const ADMIN_SESSION_DAYS = 14;

function secret(): string | null {
  const s = process.env.ADMIN_SESSION_SECRET?.trim();
  return s && s.length >= 32 ? s : null;
}

function sign(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

export function createSessionValue(now = Date.now()): string | null {
  const key = secret();
  if (!key) return null;
  const exp = Math.floor(now / 1000) + ADMIN_SESSION_DAYS * 86400;
  return `${exp}.${sign(String(exp), key)}`;
}

export function verifySessionValue(value: string | undefined | null, now = Date.now()): boolean {
  const key = secret();
  if (!key || !value) return false;
  const [expRaw, mac] = value.split(".");
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || !mac || exp * 1000 < now) return false;
  return safeEqual(mac, sign(String(exp), key));
}

export function passwordMatches(given: string | undefined | null): boolean {
  const expected = process.env.ADMIN_PASSWORD?.trim();
  if (!expected || !given) return false;
  // Compare HMACs of both sides so lengths never leak through timing.
  const k = "admin-password-compare";
  return safeEqual(sign(given, k), sign(expected, k));
}

/** `Authorization: Bearer <secret>` check for machine callers (health detail, cron, fee watch). */
export function bearerMatches(req: Request, expected: string | undefined): boolean {
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return Boolean(presented) && safeEqual(sign(presented, "bearer"), sign(expected, "bearer"));
}

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  const m = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : undefined;
}
