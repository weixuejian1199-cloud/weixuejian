/**
 * ATLAS Bot Router
 * 机器人管理 API，对标飞书机器人：
 * - Admin 创建机器人，生成唯一 Token
 * - 外部服务（OpenClaw）用 Token 调用 /api/bot/:botId/message 发消息
 * - 用户发消息时，ATLAS 推送到机器人的 Webhook URL
 */
import { Router, Request, Response } from "express";
import { getDb } from "./db";
import { bots, botMessages } from "../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";
import crypto from "crypto";

const router = Router();

// ── 生成唯一 Token ─────────────────────────────────────────────────────────────
function generateBotToken(): string {
  return "atlas_bot_" + crypto.randomBytes(20).toString("hex");
}

function generateId(): string {
  return crypto.randomBytes(16).toString("hex");
}

// ── 鉴权中间件（Admin 才能管理机器人）────────────────────────────────────────
function requireAdmin(req: Request, res: Response, next: Function) {
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: "未登录" });
  if (user.role !== "admin") return res.status(403).json({ error: "需要管理员权限" });
  next();
}

// ── Bot Token 鉴权（外部服务调用）─────────────────────────────────────────────
async function getBotByToken(token: string, db: Awaited<ReturnType<typeof getDb>>) {
  if (!db) return null;
  const rows = await db.select().from(bots).where(eq(bots.token, token)).limit(1);
  return rows[0] || null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Admin 管理接口
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/bots — 获取所有机器人列表
router.get("/", requireAdmin, async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ error: "数据库不可用" });
    const list = await db.select().from(bots).orderBy(desc(bots.createdAt));
    // 隐藏 token 的后半部分
    const safeList = list.map((b: typeof bots.$inferSelect) => ({
      ...b,
      tokenPreview: b.token.substring(0, 20) + "...",
      token: b.token, // Admin 可以看到完整 token
    }));
    res.json({ bots: safeList });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/bots — 创建机器人
router.post("/", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { name, description, avatar, webhookUrl } = req.body;
    if (!name) return res.status(400).json({ error: "name 必填" });

    const db = await getDb();
    if (!db) return res.status(503).json({ error: "数据库不可用" });
    const user = (req as any).user;
    const bot = {
      id: generateId(),
      name,
      description: description || null,
      avatar: avatar || "🤖",
      token: generateBotToken(),
      webhookUrl: webhookUrl || null,
      enabled: 1,
      createdBy: user.id,
    };

    await db.insert(bots).values(bot as any);
    res.json({ success: true, bot });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/bots/:id — 更新机器人（名称、描述、webhookUrl、enabled）
router.put("/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { name, description, avatar, webhookUrl, enabled } = req.body;
    const db = await getDb();
    if (!db) return res.status(503).json({ error: "数据库不可用" });
    const updates: any = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (avatar !== undefined) updates.avatar = avatar;
    if (webhookUrl !== undefined) updates.webhookUrl = webhookUrl;
    if (enabled !== undefined) updates.enabled = enabled ? 1 : 0;

    await db.update(bots).set(updates).where(eq(bots.id, req.params.id));
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/bots/:id/regenerate-token — 重新生成 Token
router.post("/:id/regenerate-token", requireAdmin, async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ error: "数据库不可用" });
    const newToken = generateBotToken();
    await db.update(bots).set({ token: newToken }).where(eq(bots.id, req.params.id));
    res.json({ success: true, token: newToken });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/bots/:id — 删除机器人
router.delete("/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ error: "数据库不可用" });
    await db.delete(bots).where(eq(bots.id, req.params.id));
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 用户与机器人对话接口
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/bots/:id/messages — 获取对话历史
router.get("/:id/messages", async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "未登录" });
    const db = await getDb();
    if (!db) return res.status(503).json({ error: "数据库不可用" });

    const limit = parseInt(req.query.limit as string) || 50;
    const msgs = await db
      .select()
      .from(botMessages)
      .where(and(eq(botMessages.botId, req.params.id), eq(botMessages.userId, user.id)))
      .orderBy(desc(botMessages.createdAt))
      .limit(limit);

    res.json({ messages: msgs.reverse() });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/bots/:id/send — 用户发消息给机器人
router.post("/:id/send", async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "未登录" });
    const db = await getDb();
    if (!db) return res.status(503).json({ error: "数据库不可用" });

    const { content } = req.body;
    if (!content) return res.status(400).json({ error: "content 必填" });

    // 查找机器人
    const botRows = await db.select().from(bots).where(eq(bots.id, req.params.id)).limit(1);
    const bot = botRows[0];
    if (!bot) return res.status(404).json({ error: "机器人不存在" });
    if (!bot.enabled) return res.status(400).json({ error: "机器人已禁用" });

    // 存储用户消息
    const msgId = generateId();
    await db.insert(botMessages).values({
      id: msgId,
      botId: bot.id,
      userId: user.id,
      role: "user",
      content,
    });

    // 推送到机器人 Webhook
    if (bot.webhookUrl) {
      try {
        const payload = {
          type: "user_message",
          msgId,
          botId: bot.id,
          userId: user.id,
          userName: user.name || user.username || "用户",
          content,
          timestamp: new Date().toISOString(),
          replyUrl: `${process.env.VITE_APP_ID ? "https://atlascore.cn" : ""}/api/bots/${bot.id}/reply`,
          replyToken: bot.token,
        };

        fetch(bot.webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10000),
        }).catch((err: Error) => {
          console.warn(`[Bot] Webhook push failed for bot ${bot.id}:`, err.message);
        });
      } catch (e) {
        // Webhook 失败不影响消息存储
      }
    }

    res.json({ success: true, msgId });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 外部服务（OpenClaw）调用接口
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/bots/:id/reply — 机器人回复用户（外部服务调用，用 Token 鉴权）
router.post("/:id/reply", async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) return res.status(401).json({ error: "缺少 Authorization Token" });
    const db = await getDb();
    if (!db) return res.status(503).json({ error: "数据库不可用" });

    const bot = await getBotByToken(token, db);
    if (!bot) return res.status(401).json({ error: "Token 无效" });
    if (bot.id !== req.params.id) return res.status(403).json({ error: "Token 与机器人不匹配" });

    const { content, userId, externalId } = req.body;
    if (!content) return res.status(400).json({ error: "content 必填" });
    if (!userId) return res.status(400).json({ error: "userId 必填" });

    // 幂等去重：相同 externalId 不重复插入
    if (externalId) {
      const existing = await db
        .select()
        .from(botMessages)
        .where(eq(botMessages.externalId, externalId))
        .limit(1);
      if (existing.length > 0) {
        return res.json({ success: true, msgId: existing[0].id, duplicate: true });
      }
    }

    const msgId = generateId();
    await db.insert(botMessages).values({
      id: msgId,
      botId: bot.id,
      userId: parseInt(userId),
      role: "bot",
      content,
      externalId: externalId || null,
    });

    res.json({ success: true, msgId });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
