/**
 * ATLAS — 独立认证模块
 * 替换 Manus OAuth，提供：
 *   - bcrypt 密码哈希/验证
 *   - JWT session 签发/验证
 *   - 从 HTTP 请求中提取当前用户
 */
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { parse as parseCookieHeader } from "cookie";
import { ENV } from "./env";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import * as db from "../db";
import type { Request } from "express";

// ── Password ──────────────────────────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ── JWT Session ───────────────────────────────────────────────────────────────

function getSecretKey() {
  return new TextEncoder().encode(ENV.cookieSecret || "atlas-fallback-secret-change-in-prod");
}

export interface SessionPayload {
  userId: number;
  username: string;
}

export async function createSessionToken(payload: SessionPayload): Promise<string> {
  const expiresInMs = ONE_YEAR_MS;
  const expirationSeconds = Math.floor((Date.now() + expiresInMs) / 1000);
  return new SignJWT({ userId: payload.userId, username: payload.username })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime(expirationSeconds)
    .sign(getSecretKey());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey(), { algorithms: ["HS256"] });
    const { userId, username } = payload as Record<string, unknown>;
    if (typeof userId !== "number" || typeof username !== "string") return null;
    return { userId, username };
  } catch {
    return null;
  }
}

// ── Request Authentication ────────────────────────────────────────────────────

export async function authenticateRequest(req: Request) {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;

  const cookies = parseCookieHeader(cookieHeader);
  const token = cookies[COOKIE_NAME];
  if (!token) return null;

  const session = await verifySessionToken(token);
  if (!session) return null;

  const user = await db.getUserById(session.userId);
  if (!user) return null;

  return user;
}
