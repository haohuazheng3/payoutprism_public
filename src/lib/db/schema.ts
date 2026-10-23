import { pgTable, text, integer, boolean, timestamp, jsonb, primaryKey, uniqueIndex, index, doublePrecision, date } from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

/* ------------------------------------------------------------------ operations */

/** Self-hosted error inbox: one row per fingerprint (error name + first stack frame + route). */
export const errorGroups = pgTable(
  "error_groups",
  {
    id: text("id").primaryKey(),
    fingerprint: text("fingerprint").notNull(),
    name: text("name").notNull(),
    message: text("message").notNull(),
    route: text("route"),
    source: text("source").notNull(), // server | client | edge | worker | cron
    severity: text("severity").notNull().default("error"), // error | warn
    firstFrame: text("first_frame"),
    stack: text("stack"),
    context: jsonb("context").$type<Record<string, unknown>>(),
    count: integer("count").notNull().default(1),
    firstSeen: timestamp("first_seen", { withTimezone: true }).notNull().defaultNow(),
    lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("error_groups_fingerprint_uq").on(t.fingerprint), index("error_groups_resolved_idx").on(t.resolvedAt)],
);

export const contactMessages = pgTable(
  "contact_messages",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    email: text("email").notNull(),
    topic: text("topic").notNull(),
    message: text("message").notNull(),
    page: text("page"),
    ipHash: text("ip_hash"),
    userAgent: text("user_agent"),
    status: text("status").notNull().default("new"), // new | replied | archived
    notified: integer("notified").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("contact_messages_created_idx").on(t.createdAt)],
);

/** "Was this accurate?" answers and fee-error reports from calculator pages. */
export const feedback = pgTable(
  "feedback",
  {
    id: text("id").primaryKey(),
    calculator: text("calculator").notNull(),
    market: text("market"),
    helpful: boolean("helpful").notNull(),
    note: text("note"),
    inputs: jsonb("inputs").$type<Record<string, unknown>>(),
    ipHash: text("ip_hash"),
    status: text("status").notNull().default("new"), // new | reviewed
    createdAt: createdAt(),
  },
  (t) => [index("feedback_calc_idx").on(t.calculator, t.createdAt)],
);

/**
 * Official fee pages we watch for changes. A GitHub Actions job fetches each URL, normalises the
 * text and compares hashes; a change opens a review (fee numbers are only edited by a person
 * after reading the new page).
 */
export const feeWatch = pgTable(
  "fee_watch",
  {
    url: text("url").primaryKey(),
    calculator: text("calculator").notNull(),
    hash: text("hash"),
    excerpt: text("excerpt"),
    httpStatus: integer("http_status"),
    status: text("status").notNull().default("new"), // new | ok | changed | unreachable
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    changedAt: timestamp("changed_at", { withTimezone: true }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (t) => [index("fee_watch_calc_idx").on(t.calculator)],
);

/** Fixed-window rate limiter state. */
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull().defaultNow(),
  count: integer("count").notNull().default(0),
});

/** Daily Search Console rows pulled by the GSC job. */
export const gscDaily = pgTable(
  "gsc_daily",
  {
    day: date("day").notNull(),
    page: text("page").notNull(),
    query: text("query").notNull(),
    clicks: integer("clicks").notNull().default(0),
    impressions: integer("impressions").notNull().default(0),
    ctr: doublePrecision("ctr").notNull().default(0),
    position: doublePrecision("position").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.day, t.page, t.query] })],
);

/** Small key/value store for operational state (last fee-watch run…). */
export const appState = pgTable("app_state", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>(),
  updatedAt: updatedAt(),
});
