import type { CookieOptions, Request } from "express";

export function getSessionCookieOptions(_req: Request): CookieOptions {
  // Same-origin application sessions do not need cross-site cookies.
  return { httpOnly: true, path: "/", sameSite: "lax", secure: true };
}
