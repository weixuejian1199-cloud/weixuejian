import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { authenticateRequest } from "./auth";
import { getOrCreateAnonUser } from "../db";
import { ANON_COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { nanoid } from "nanoid";

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

  const getEffectiveUserId = async (): Promise<number> => {
    if (user) return user.id;
    // Get or create anon id from cookie
    const cookies = opts.req.cookies as Record<string, string>;
    let anonId = cookies[ANON_COOKIE_NAME];
    if (!anonId) {
      anonId = nanoid(16);
      opts.res.cookie(ANON_COOKIE_NAME, anonId, {
        httpOnly: true,
        sameSite: "lax",
        maxAge: ONE_YEAR_MS,
        path: "/",
      });
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
