/*
 * "Pick up where you left off": the last calculations, kept only in this browser
 * (localStorage, never sent anywhere). Every access is wrapped: private windows and
 * blocked storage simply mean no history.
 */

export interface RecentItem {
  slug: string;
  name: string;
  path: string;
  /** Query string that restores the calculation, e.g. "?price=28&shipping=5". */
  query: string;
  /** Pre-formatted headline, e.g. "$28.00 sale → keep $21.84". */
  summary: string;
  at: number;
}

const KEY = "pp:recent:v1";
const MAX = 12;
export const RECENT_EVENT = "pp:recent-changed";

export function readRecent(): RecentItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as RecentItem[]) : [];
    return Array.isArray(list) ? list.filter((x) => x && typeof x.path === "string" && typeof x.query === "string").slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function pushRecent(item: Omit<RecentItem, "at">): void {
  try {
    const list = readRecent().filter((x) => !(x.slug === item.slug && x.query === item.query));
    // One slot per calculator for consecutive edits: replace this calculator's newest entry
    // when it was saved in the last 10 minutes, so a typing session leaves one line, not ten.
    const i = list.findIndex((x) => x.slug === item.slug);
    if (i === 0 && Date.now() - list[0].at < 10 * 60 * 1000) list.splice(0, 1);
    list.unshift({ ...item, at: Date.now() });
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
    window.dispatchEvent(new Event(RECENT_EVENT));
  } catch {
    /* storage unavailable: history is a convenience, never required */
  }
}

export function clearRecent(): void {
  try {
    localStorage.removeItem(KEY);
    window.dispatchEvent(new Event(RECENT_EVENT));
  } catch {
    /* ignore */
  }
}
