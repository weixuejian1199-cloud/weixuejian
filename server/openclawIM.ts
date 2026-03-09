/**
 * ATLAS ↔ OpenClaw HTTP API（飞书机器人模式）
 *
 * 接口 1：POST /api/openclaw/send
 *   - OpenClaw 调用此接口，把消息发给 ATLAS（显示给 admin）
 *   - 鉴权：Bearer Token = OPENCLAW_SESSION_KEY
 *
 * 接口 2：Webhook 推送（admin 发消息时触发）
 *   - Admin 在 ATLAS 发消息 → ATLAS 存库 → ATLAS POST 到 OpenClaw 的 Webhook URL
 *   - Webhook URL 由 admin 在设置页配置（OPENCLAW_WEBHOOK_URL 环境变量）
 *
 * 接口 3：GET /api/openclaw/messages
 *   - 前端轮询，获取对话历史
 *   - 鉴权：admin session cookie
 *
 * 接口 4：GET/POST /api/openclaw/config
 *   - 查看/设置 Webhook URL
 *   - 鉴权：admin session cookie
 */

import type { Express, Request, Response } from "express";
import { drizzle } from "drizzle-orm/mysql2";
import { desc, eq } from "drizzle-orm";
import { imMessages, users } from "../drizzle/schema";
import { nanoid } from "nanoid";
import { verifySessionToken } from "./_core/auth";
import { parse as parseCookieHeader } from "cookie";
import { ENV } from "./_core/env";

const OPENCLAW_CONV_ID = "openclaw-direct";

function getDb() {
  return drizzle(process.env.DATABASE_URL!);
}

/** 验证 admin session cookie */
async function requireAdmin(req: Request, res: Response): Promise<{ userId: number; userName: string } | null> {
  const cookieHeader = req.headers.cookie ?? "";
  const cookies = parseCookieHeader(cookieHeader);
  const token = cookies["app_session_id"] ?? null;

  if (!token) {
    res.status(401).json({ error: "未登录" });
    return null;
  }

  const session = await verifySessionToken(token);
  if (!session) {
    res.status(401).json({ error: "Token 无效" });
    return null;
  }

  const db = getDb();
  const rows = await db
    .select({ id: users.id, name: users.name, username: users.username, role: users.role })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);

  if (rows.length === 0 || rows[0].role !== "admin") {
    res.status(403).json({ error: "需要管理员权限" });
    return null;
  }

  return {
    userId: rows[0].id,
    userName: rows[0].name || rows[0].username || `用户${rows[0].id}`,
  };
}

/** 验证 OpenClaw Bearer Token */
function requireOpenClawToken(req: Request, res: Response): boolean {
  const auth = req.headers.authorization ?? "";
  const token = auth.replace("Bearer ", "").trim();
  const expected = ENV.openClawSessionKey;

  if (!expected || token !== expected) {
    res.status(401).json({ error: "Invalid token" });
    return false;
  }
  return true;
}

/** 推送消息给 OpenClaw Webhook */
async function pushToOpenClawWebhook(payload: {
  type: string;
  msgId: string;
  fromUserId: number;
  fromUserName: string;
  content: string;
  timestamp: string;
}): Promise<{ status: string }> {
  const webhookUrl = process.env.OPENCLAW_WEBHOOK_URL ?? "";
  if (!webhookUrl) {
    console.log("[OpenClaw] No OPENCLAW_WEBHOOK_URL configured, skipping push");
    return { status: "no_webhook_configured" };
  }

  try {
    const resp = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${ENV.openClawSessionKey}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    const status = resp.ok ? "delivered" : `http_${resp.status}`;
    console.log(`[OpenClaw] Webhook push status=${status}`);
    return { status };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[OpenClaw] Webhook push failed:", msg);
    return { status: `error:${msg}` };
  }
}

export function registerOpenClawIMRoutes(app: Express): void {

  // ── 接口 1：OpenClaw → ATLAS（小虾米发消息给 admin）──────────────────────────

  /**
   * POST /api/openclaw/send
   * OpenClaw 调用此接口，把消息推送给 ATLAS（显示给 admin）
   * Header: Authorization: Bearer <OPENCLAW_SESSION_KEY>
   * Body: { content: string, msgId?: string }
   */
  app.post("/api/openclaw/send", async (req: Request, res: Response) => {
    if (!requireOpenClawToken(req, res)) return;

    const { content, msgId: incomingMsgId } = req.body as { content?: string; msgId?: string };
    if (!content?.trim()) {
      res.status(400).json({ error: "content is required" });
      return;
    }

    const msgId = incomingMsgId ?? nanoid();
    const db = getDb();
    const trimmedContent = content.trim();

    // 幂等处理 1：如果该 msgId 已存在，直接返回成功
    if (incomingMsgId) {
      const existing = await db
        .select({ id: imMessages.id })
        .from(imMessages)
        .where(eq(imMessages.id, incomingMsgId))
        .limit(1);
      if (existing.length > 0) {
        console.log(`[OpenClaw] Duplicate msgId=${incomingMsgId}, skipping insert`);
        res.json({ success: true, msgId: incomingMsgId, duplicate: true });
        return;
      }
    }

    // 幂等处理 2：如果相同内容在 60 秒内已存在，跳过（防止小虾米未带 msgId 重试导致重复）
    const sixtySecondsAgo = new Date(Date.now() - 60_000);
    const contentDup = await db
      .select({ id: imMessages.id, createdAt: imMessages.createdAt, content: imMessages.content })
      .from(imMessages)
      .where(eq(imMessages.conversationId, OPENCLAW_CONV_ID))
      .orderBy(desc(imMessages.createdAt))
      .limit(20);
    const contentDuplicate = contentDup.find(row => {
      const t = row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt as string);
      return row.content === trimmedContent && t > sixtySecondsAgo;
    });
    if (contentDuplicate) {
      console.log(`[OpenClaw] Duplicate content within 60s, skipping insert. Original msgId=${contentDuplicate.id}`);
      res.json({ success: true, msgId: contentDuplicate.id, duplicate: true });
      return;
    }

    await db.insert(imMessages).values({
      id: msgId,
      conversationId: OPENCLAW_CONV_ID,
      senderId: -1,          // -1 = OpenClaw 小虾米
      senderName: "小虾米",
      type: "text",
      content: content.trim(),
      createdAt: new Date(),
    });

    console.log(`[OpenClaw] Message received from OpenClaw, msgId=${msgId}`);
    res.json({ success: true, msgId });
  });

  // ── 接口 2：Admin → ATLAS → OpenClaw Webhook（admin 发消息）────────────────

  /**
   * POST /api/openclaw/admin/send
   * Admin 在 ATLAS 发消息给小虾米
   * ATLAS 存库后，自动 POST 到 OpenClaw 的 Webhook URL
   * 鉴权：admin session cookie
   * Body: { content: string }
   */
  app.post("/api/openclaw/admin/send", async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { content } = req.body as { content?: string };
    if (!content?.trim()) {
      res.status(400).json({ error: "消息内容不能为空" });
      return;
    }

    const msgId = nanoid();
    const db = getDb();

    // 1. 存库
    await db.insert(imMessages).values({
      id: msgId,
      conversationId: OPENCLAW_CONV_ID,
      senderId: admin.userId,
      senderName: admin.userName,
      type: "text",
      content: content.trim(),
      createdAt: new Date(),
    });

    // 2. 推送给 OpenClaw Webhook
    const { status: webhookStatus } = await pushToOpenClawWebhook({
      type: "admin_message",
      msgId,
      fromUserId: admin.userId,
      fromUserName: admin.userName,
      content: content.trim(),
      timestamp: new Date().toISOString(),
    });

    res.json({ success: true, msgId, webhookStatus });
  });

  // ── 接口 3：前端轮询获取对话历史 ────────────────────────────────────────────

  /**
   * GET /api/openclaw/messages?after=<ISO>
   * 前端每 3s 轮询，获取小虾米对话历史
   * 鉴权：admin session cookie
   */
  app.get("/api/openclaw/messages", async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const db = getDb();
    const afterParam = req.query.after as string | undefined;

    let rows = await db
      .select()
      .from(imMessages)
      .where(eq(imMessages.conversationId, OPENCLAW_CONV_ID))
      .orderBy(desc(imMessages.createdAt))
      .limit(200);

    rows = rows.reverse();

    // 如果有 after 参数，只返回该时间之后的消息
    if (afterParam) {
      const afterDate = new Date(afterParam);
      rows = rows.filter(r => {
        const t = r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt as string);
        return t > afterDate;
      });
    }

    const messages = rows.map(r => ({
      id: r.id,
      role: r.senderId === -1 ? "assistant" as const : "user" as const,
      content: r.content,
      senderName: r.senderName,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    }));

    res.json({ messages });
  });

  // ── 接口 4：Webhook 配置 ────────────────────────────────────────────────────

  /**
   * GET /api/openclaw/config
   * 查看当前 Webhook 配置（admin only）
   */
  app.get("/api/openclaw/config", async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const webhookUrl = process.env.OPENCLAW_WEBHOOK_URL ?? "";
    res.json({
      webhookUrl: webhookUrl || null,
      configured: !!webhookUrl,
      sendEndpoint: "POST /api/openclaw/send",
      authHeader: "Authorization: Bearer <OPENCLAW_SESSION_KEY>",
    });
  });

  /**
   * POST /api/openclaw/config
   * 运行时设置 Webhook URL（admin only）
   * 持久化请在 Secrets 管理界面设置 OPENCLAW_WEBHOOK_URL
   * Body: { webhookUrl: string }
   */
  app.post("/api/openclaw/config", async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { webhookUrl } = req.body as { webhookUrl?: string };
    if (!webhookUrl?.trim()) {
      res.status(400).json({ error: "webhookUrl 不能为空" });
      return;
    }

    process.env.OPENCLAW_WEBHOOK_URL = webhookUrl.trim();
    console.log(`[OpenClaw] Webhook URL set to: ${webhookUrl.trim()}`);

    res.json({ success: true, webhookUrl: webhookUrl.trim() });
  });

  console.log("[OpenClaw] HTTP API routes registered: /api/openclaw/*");
}
