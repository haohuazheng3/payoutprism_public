import { createHash, randomBytes } from "node:crypto";

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"; // Crockford-ish, no i/l/o/u

export type IdPrefix = "err" | "msg" | "fbk" | "fwe";

/** Short, URL-safe random id with a type prefix, e.g. `msg_k3v9…`. */
export function newId(prefix: IdPrefix, length = 16): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return `${prefix}_${out}`;
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
