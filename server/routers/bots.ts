/**
 * ATLAS Bot Router (tRPC)
 * 机器人管理，对标飞书机器人模式
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, adminProcedure, publicProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { bots, botMessages } from "../../drizzle/schema";
import { eq, desc, and, gt } from "drizzle-orm";
import crypto from "crypto";
import { ENV } from "../_core/env";

function generateBotToken(): string {
  return "atlas_bot_" + crypto.randomBytes(20).toString("hex");
}

function generateId(): string {
  return crypto.randomBytes(16).toString("hex");
}

export const botsRouter = router({
  // 获取所有机器人列表（Admin only）
  list: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
    const list = await db.select().from(bots).orderBy(desc(bots.createdAt));
    return list;
  }),

  // 创建机器人（Admin only）
  create: adminProcedure
    .input(z.object({
      name: z.string().min(1, "名称必填").max(50),
      description: z.string().max(200).optional(),
      avatar: z.string().max(10).optional(),
      webhookUrl: z.string().url("请输入有效的 URL").optional().or(z.literal("")),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
      const bot = {
        id: generateId(),
        name: input.name,
        description: input.description || null,
        avatar: input.avatar || "🤖",
        token: generateBotToken(),
        webhookUrl: input.webhookUrl || null,
        enabled: 1 as const,
        createdBy: ctx.user.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await db.insert(bots).values(bot);
      return bot;
    }),

  // 更新机器人（Admin only）
  update: adminProcedure
    .input(z.object({
      id: z.string(),
      name: z.string().min(1).max(50).optional(),
      description: z.string().max(200).optional(),
      avatar: z.string().max(10).optional(),
      webhookUrl: z.string().url("请输入有效的 URL").optional().or(z.literal("")),
      enabled: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name !== undefined) updates.name = input.name;
      if (input.description !== undefined) updates.description = input.description;
      if (input.avatar !== undefined) updates.avatar = input.avatar;
      if (input.webhookUrl !== undefined) updates.webhookUrl = input.webhookUrl || null;
      if (input.enabled !== undefined) updates.enabled = input.enabled ? 1 : 0;
      await db.update(bots).set(updates).where(eq(bots.id, input.id));
      return { success: true };
    }),

  // 删除机器人（Admin only）
  delete: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
      await db.delete(bots).where(eq(bots.id, input.id));
      return { success: true };
    }),

  // 重新生成 Token（Admin only）
  regenerateToken: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
      const newToken = generateBotToken();
      await db.update(bots).set({ token: newToken, updatedAt: new Date() }).where(eq(bots.id, input.id));
      return { token: newToken };
    }),

  // 发消息给机器人（用户操作，触发 Webhook 推送）
  sendMessage: publicProcedure
    .input(z.object({
      botId: z.string(),
      content: z.string().min(1).max(4000),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
      if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录" });

      // 查找机器人
      const botRows = await db.select().from(bots).where(eq(bots.id, input.botId)).limit(1);
      const bot = botRows[0];
      if (!bot || !bot.enabled) throw new TRPCError({ code: "NOT_FOUND", message: "机器人不存在或已禁用" });

      // 存储用户消息
      const msgId = generateId();
      await db.insert(botMessages).values({
        id: msgId,
        botId: input.botId,
        role: "user",
        content: input.content,
        userId: ctx.user.id,
        createdAt: new Date(),
      });

      // 推送到机器人 Webhook（异步，不阻断用户操作）
      if (bot.webhookUrl) {
        const fromUserName = ctx.user.name || ctx.user.username || "用户";
        // OpenClaw hooks/agent 格式：message 字段 + Authorization Bearer token
        // 将 atlasMetadata 嵌入 message 文本，确保 Claude 能读取回调信息
        const replyUrl = `${ENV.appBaseUrl}/api/bots/${input.botId}/reply`;
        const replyToken = bot.token;
        const payload = {
          message: `[来自 ATLAS 用户 ${fromUserName}]: ${input.content}

---ATLAS_METADATA---
replyUrl: ${replyUrl}
replyToken: ${replyToken}
fromUserId: ${ctx.user.id}
msgId: ${msgId}
---END_ATLAS_METADATA---

处理完后必须用 curl 回调 replyUrl，带上 Authorization: Bearer replyToken，body: {"content":"你的回复","userId":"${ctx.user.id}"}`,
          name: "ATLAS",
        };
        console.log(`[Bot] Pushing webhook to: ${bot.webhookUrl}`);
        fetch(bot.webhookUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer atlas_webhook_token_20260309`,
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10000),
        }).then(async (res) => {
          if (!res.ok) {
            const text = await res.text().catch(() => "");
            console.warn(`[Bot] Webhook push failed (${res.status}):`, text);
          } else {
            console.log(`[Bot] Webhook pushed to ${bot.webhookUrl}, runId:`, (await res.json().catch(() => ({}))).runId);
          }
        }).catch((e) => {
          console.warn("[Bot] Webhook push failed:", e);
        });
      }

      return { success: true, msgId };
    }),

  // 获取与机器人的消息历史
  getMessages: publicProcedure
    .input(z.object({
      botId: z.string(),
      since: z.number().optional(), // Unix timestamp ms，只获取此时间之后的消息
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
      if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录" });

      const baseCondition = eq(botMessages.botId, input.botId);
      const whereClause = input.since
        ? and(baseCondition, gt(botMessages.createdAt, new Date(input.since)))
        : baseCondition;

      const messages = await db
        .select()
        .from(botMessages)
        .where(whereClause)
        .orderBy(botMessages.createdAt)
        .limit(100);

      return messages;
    }),
});
