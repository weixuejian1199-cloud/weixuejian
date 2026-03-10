import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { authenticateRequest } from "./auth";
import { getOrCreateAnonUser } from "../db";
import { ANON_COOKIE_NAME, COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { nanoid } from "nanoid";
import { getSessionCookieOptions } from "./cookies";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  /** Returns the authenticated user's id, or lazily creates/returns an anon user id */
  getEffectiveUserId: () => Promise<number>;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  try {
    user = await authenticateRequest(opts.req);
  } catch {
    user = null;
  }

  // If there's a session cookie but it failed to authenticate (expired/invalid JWT),
  // clear the stale cookie so the browser doesn't keep sending it and the user
  // can see they need to log in again.
  const cookies = opts.req.cookies as Record<string, string>;
  if (!user && cookies[COOKIE_NAME]) {
    const cookieOpts = getSessionCookieOptions(opts.req);
    opts.res.clearCookie(COOKIE_NAME, { ...cookieOpts });
  }

  const getEffectiveUserId = async (): Promise<number> => {
    if (user) return user.id;
    // Get or create anon id from cookie
    let anonId = cookies[ANON_COOKIE_NAME];
    if (!anonId) {
      anonId = nanoid(16);
      // Use same cookie options as session cookie (sameSite: "none", secure on HTTPS)
      // to ensure it works correctly in cross-origin environments (e.g., manus.space)
      const cookieOpts = getSessionCookieOptions(opts.req);
      opts.res.cookie(ANON_COOKIE_NAME, anonId, { ...cookieOpts, maxAge: ONE_YEAR_MS });
    }
    const anon = await getOrCreateAnonUser(anonId);
    return anon.id;
  };

  return {
    req: opts.req,
    res: opts.res,
    user,
    getEffectiveUserId,
  };
}
