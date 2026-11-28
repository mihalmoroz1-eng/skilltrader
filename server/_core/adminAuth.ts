import { scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { ENV } from "./env";

const scrypt = promisify(scryptCallback);
const attempts = new Map<string, { count: number; resetAt: number }>();

export function consumeAdminLoginAttempt(key: string): boolean {
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + 15 * 60_000 });
    return true;
  }
  if (current.count >= 8) return false;
  current.count += 1;
  return true;
}

export async function verifyAdminCredentials(email: string, password: string): Promise<boolean> {
  const expectedEmail = ENV.adminEmail.trim().toLowerCase();
  const suppliedEmail = email.trim().toLowerCase();
  const encoded = ENV.adminPasswordHash;
  if (!expectedEmail || !encoded || ENV.cookieSecret.length < 32 || suppliedEmail !== expectedEmail) return false;

  const [scheme, salt, expectedHex] = encoded.split("$");
  if (scheme !== "scrypt" || !salt || !expectedHex || !/^[a-f0-9]{128}$/i.test(expectedHex)) return false;

  try {
    const actual = (await scrypt(password, salt, 64)) as Buffer;
    const expected = Buffer.from(expectedHex, "hex");
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
