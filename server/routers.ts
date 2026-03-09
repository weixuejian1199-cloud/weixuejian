import { z } from "zod";
import { nanoid } from "nanoid";
import { TRPCError } from "@trpc/server";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { adminRouter } from "./routers/admin";
import { publicProcedure, router } from "./_core/trpc";
import {
  createSession, updateSession, getSession, getUserSessions, deleteSession,
  createReport, updateReport, getReport, getUserReports, deleteReport,
  createScheduledTask, updateScheduledTask, getUserScheduledTasks, deleteScheduledTask,
  ensureInviteCode, redeemInviteCode, getInviteStats, getUserCredits,
  createReportFeedback, getReportFeedback, updateReportFeedback, getSimilarExamples,
  getUserByUsername, createUser, updateUserPassword, getUserById,
  createMessageFeedback, getMessageFeedbacks,
} from "./db";
import { users } from "../drizzle/schema";
import { storageDelete } from "./storage";
import { hashPassword, verifyPassword, createSessionToken } from "./_core/auth";

// Returns a Date 24 hours from now
function in24Hours() {
  return new Date(Date.now() + 24 * 60 * 60 * 1000);
}

export const appRouter = router({
  system: systemRouter,
  admin: adminRouter,

  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),

    register: publicProcedure
      .input(z.object({
        username: z.string().min(3, "用户名至少3位").max(64),
        password: z.string().min(6, "密码至少6位").max(128),
        name: z.string().max(64).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const existing = await getUserByUsername(input.username);
        if (existing) throw new TRPCError({ code: "CONFLICT", message: "该用户名已被注册" });
        const passwordHash = await hashPassword(input.password);
        const user = await createUser({ username: input.username, passwordHash, name: input.name });
        const token = await createSessionToken({ userId: user.id, username: user.username! });
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: ONE_YEAR_MS });
        return { success: true, user: { id: user.id, username: user.username, name: user.name, role: user.role } };
      }),

    login: publicProcedure
      .input(z.object({
        username: z.string().min(1, "请输入用户名"),
        password: z.string().min(1, "请输入密码"),
      }))
      .mutation(async ({ ctx, input }) => {
        const user = await getUserByUsername(input.username);
        if (!user || !user.passwordHash) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "用户名或密码错误" });
        }
        const valid = await verifyPassword(input.password, user.passwordHash);
        if (!valid) throw new TRPCError({ code: "UNAUTHORIZED", message: "用户名或密码错误" });
        const token = await createSessionToken({ userId: user.id, username: user.username! });
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: ONE_YEAR_MS });
        return { success: true, user: { id: user.id, username: user.username, name: user.name, role: user.role } };
      }),

    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),

    changePassword: publicProcedure
      .input(z.object({
        oldPassword: z.string().min(1, "请输入旧密码"),
        newPassword: z.string().min(6, "新密码至少6位").max(128),
      }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录" });
        const user = await getUserById(ctx.user.id);
        if (!user?.passwordHash) throw new TRPCError({ code: "BAD_REQUEST", message: "该账号不支持密码修改" });
        const valid = await verifyPassword(input.oldPassword, user.passwordHash);
        if (!valid) throw new TRPCError({ code: "UNAUTHORIZED", message: "旧密码错误" });
        const newHash = await hashPassword(input.newPassword);
        await updateUserPassword(ctx.user.id, newHash);
        return { success: true };
      }),

    /** Reset password by username only — no old password required (test-phase convenience) */
    resetPassword: publicProcedure
      .input(z.object({
        username: z.string().min(1, "请输入用户名"),
        newPassword: z.string().min(6, "新密码至少6位").max(128),
      }))
      .mutation(async ({ input }) => {
        const user = await getUserByUsername(input.username);
        if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "该用户名不存在" });
        const newHash = await hashPassword(input.newPassword);
        await updateUserPassword(user.id, newHash);
        return { success: true };
      }),
  }),

  // ── Sessions ──────────────────────────────────────────────────────────────────

  session: router({
    create: publicProcedure
      .input(z.object({
        filename: z.string(),
        originalName: z.string(),
        fileKey: z.string().optional(),
        fileUrl: z.string().optional(),
        fileSizeKb: z.number().optional(),
        rowCount: z.number().optional(),
        colCount: z.number().optional(),
        dfInfo: z.any().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const userId = await ctx.getEffectiveUserId();
        const id = nanoid();
        await createSession({
          id,
          userId,
          filename: input.filename,
          originalName: input.originalName,
          fileKey: input.fileKey,
          fileUrl: input.fileUrl,
          fileSizeKb: input.fileSizeKb,
          rowCount: input.rowCount,
          colCount: input.colCount,
          dfInfo: input.dfInfo,
          isMerged: 0,
          status: "ready",
        });
        return { id };
      }),

    get: publicProcedure
      .input(z.object({ id: z.string() }))
      .query(async ({ ctx, input }) => {
        const userId = await ctx.getEffectiveUserId();
        const session = await getSession(input.id);
        if (!session || session.userId !== userId) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        return session;
      }),

    list: publicProcedure.query(async ({ ctx }) => {
      const userId = await ctx.getEffectiveUserId();
      return getUserSessions(userId);
    }),

    delete: publicProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const userId = await ctx.getEffectiveUserId();
        const session = await getSession(input.id);
        if (!session || session.userId !== userId) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        if (session.fileKey) {
          try { await storageDelete(session.fileKey); } catch (e) {
            console.warn("[S3] Failed to delete session file:", e);
          }
        }
        await deleteSession(input.id);
        return { success: true };
      }),

    merge: publicProcedure
      .input(z.object({ sessionIds: z.array(z.string()).min(2) }))
      .mutation(async ({ ctx, input }) => {
        const userId = await ctx.getEffectiveUserId();
        for (const sid of input.sessionIds) {
          const s = await getSession(sid);
          if (!s || s.userId !== userId) {
            throw new TRPCError({ code: "NOT_FOUND", message: `Session ${sid} not found` });
          }
        }
        const id = nanoid();
        await createSession({
          id,
          userId,
          filename: `merged_${id}`,
          originalName: `合并会话 (${input.sessionIds.length} 个文件)`,
          isMerged: 1,
          mergedFrom: input.sessionIds,
          status: "ready",
        });
        for (const sid of input.sessionIds) {
          await updateSession(sid, { status: "merged" });
        }
        return { id };
      }),
  }),

  // ── Reports ───────────────────────────────────────────────────────────────────

  report: router({
    list: publicProcedure.query(async ({ ctx }) => {
      const userId = await ctx.getEffectiveUserId();
      return getUserReports(userId);
    }),

    get: publicProcedure
      .input(z.object({ id: z.string() }))
      .query(async ({ ctx, input }) => {
        const userId = await ctx.getEffectiveUserId();
        const report = await getReport(input.id);
        if (!report || report.userId !== userId) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        return report;
      }),

    create: publicProcedure
      .input(z.object({
        sessionId: z.string(),
        title: z.string(),
        prompt: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const userId = await ctx.getEffectiveUserId();
        const id = nanoid();
        await createReport({
          id,
          sessionId: input.sessionId,
          userId,
          title: input.title,
          filename: `${input.title}_${id}.xlsx`,
          prompt: input.prompt,
          status: "generating",
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        });
        return { id };
      }),

    complete: publicProcedure
      .input(z.object({
        id: z.string(),
        fileKey: z.string(),
        fileUrl: z.string(),
        fileSizeKb: z.number().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const userId = await ctx.getEffectiveUserId();
        const report = await getReport(input.id);
        if (!report || report.userId !== userId) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        await updateReport(input.id, {
          fileKey: input.fileKey,
          fileUrl: input.fileUrl,
          fileSizeKb: input.fileSizeKb,
          status: "completed",
        });
        return { success: true };
      }),

    fail: publicProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const userId = await ctx.getEffectiveUserId();
        const report = await getReport(input.id);
        if (!report || report.userId !== userId) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        await updateReport(input.id, { status: "failed" });
        return { success: true };
      }),

    delete: publicProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const userId = await ctx.getEffectiveUserId();
        const report = await getReport(input.id);
        if (!report || report.userId !== userId) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        await deleteReport(input.id);
        return { success: true };
      }),
  }),

  // ── Scheduled Tasks ───────────────────────────────────────────────────────────

  scheduled: router({
    list: publicProcedure.query(async ({ ctx }) => {
      const userId = await ctx.getEffectiveUserId();
      return getUserScheduledTasks(userId);
    }),

    create: publicProcedure
      .input(z.object({
        name: z.string(),
        templatePrompt: z.string(),
        templateName: z.string().optional(),
        cronExpr: z.string(),
        scheduleDesc: z.string().optional(),
        notifyEmail: z.string().optional(),
        lastSessionId: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const userId = await ctx.getEffectiveUserId();
        const id = nanoid();
        await createScheduledTask({
          id,
          userId,
          name: input.name,
          templatePrompt: input.templatePrompt,
          templateName: input.templateName,
          cronExpr: input.cronExpr,
          scheduleDesc: input.scheduleDesc,
          notifyEmail: input.notifyEmail,
          lastSessionId: input.lastSessionId,
          status: "active",
          runCount: 0,
        });
        return { id };
      }),

    update: publicProcedure
      .input(z.object({
        id: z.string(),
        name: z.string().optional(),
        cronExpr: z.string().optional(),
        scheduleDesc: z.string().optional(),
        notifyEmail: z.string().optional(),
        status: z.enum(["active", "paused", "error"]).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { id, ...data } = input;
        await updateScheduledTask(id, data);
        return { success: true };
      }),

    delete: publicProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ ctx, input }) => {
        await deleteScheduledTask(input.id);
        return { success: true };
      }),
  }),

  // ── Stats / Dashboard ───────────────────────────────────────────────────────

  stats: router({
    dashboard: publicProcedure.query(async ({ ctx }) => {
      const userId = await ctx.getEffectiveUserId();
      const [sessions, reports, tasks, credits] = await Promise.all([
        getUserSessions(userId),
        getUserReports(userId),
        getUserScheduledTasks(userId),
        getUserCredits(userId),
      ]);
      const completedReports = reports.filter(r => r.status === "completed");
      const activeTasks = tasks.filter(t => t.status === "active");
      // Build recent activity (last 7 days)
      const now = Date.now();
      const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
      const recentReports = completedReports.filter(r => r.createdAt && new Date(r.createdAt).getTime() > sevenDaysAgo);
      // Daily report counts for the past 7 days
      const dailyCounts: Record<string, number> = {};
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now - i * 24 * 60 * 60 * 1000);
        const key = `${d.getMonth() + 1}/${d.getDate()}`;
        dailyCounts[key] = 0;
      }
      for (const r of recentReports) {
        if (!r.createdAt) continue;
        const d = new Date(r.createdAt);
        const key = `${d.getMonth() + 1}/${d.getDate()}`;
        if (key in dailyCounts) dailyCounts[key]++;
      }
      const trendData = Object.entries(dailyCounts).map(([date, count]) => ({ date, count }));
      return {
        totalSessions: sessions.length,
        totalReports: completedReports.length,
        activeScheduledTasks: activeTasks.length,
        credits,
        recentReports: completedReports.slice(-5).reverse().map(r => ({
          id: r.id,
          title: r.title,
          createdAt: r.createdAt,
          fileSizeKb: r.fileSizeKb,
        })),
        trendData,
      };
    }),
  }),

  // ── Feedback (Self-Learning / RAG) ──────────────────────────────────────────

  feedback: router({
    /** Submit or update rating for a report (1-5 stars) */
    submit: publicProcedure
      .input(z.object({
        reportId: z.string(),
        rating: z.number().int().min(1).max(5),
        comment: z.string().max(500).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const userId = await ctx.getEffectiveUserId();
        const report = await getReport(input.reportId);
        if (!report || report.userId !== userId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "报表不存在" });
        }
        const session = await getSession(report.sessionId);
        const dfInfo = session?.dfInfo as Array<{ column?: string }> | null;
        const columnSignature = dfInfo
          ? dfInfo.map(c => c.column ?? "").join(",")
          : "";
        const existing = await getReportFeedback(input.reportId, userId);
        if (existing) {
          await updateReportFeedback(existing.id, {
            rating: input.rating,
            comment: input.comment ?? null,
          });
          return { updated: true };
        }
        await createReportFeedback({
          id: nanoid(),
          reportId: input.reportId,
          sessionId: report.sessionId,
          userId,
          rating: input.rating,
          comment: input.comment ?? null,
          columnSignature,
          prompt: report.prompt,
          exampleDataKey: null,
        });
        return { created: true };
      }),

    /** Get my feedback for a report */
    getMine: publicProcedure
      .input(z.object({ reportId: z.string() }))
      .query(async ({ ctx, input }) => {
        const userId = await ctx.getEffectiveUserId();
        return getReportFeedback(input.reportId, userId);
      }),
  }),

  // ── Message Feedback (👍/👎) ─────────────────────────────────────────────────

  messageFeedback: router({
    /** Submit 👍/👎 rating for an AI message */
    submit: publicProcedure
      .input(z.object({
        rating: z.number().int().refine(v => v === 1 || v === -1),
        messagePreview: z.string().max(500).optional(),
        comment: z.string().max(500).optional(),
        context: z.string().max(128).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const feedbackId = nanoid();
        await createMessageFeedback({
          id: feedbackId,
          userId: (ctx as any).user?.id ?? null,
          rating: input.rating,
          messagePreview: input.messagePreview ?? null,
          comment: input.comment ?? null,
          context: input.context ?? null,
        });
        // Push to OpenClaw Webhook if configured (only push negative feedback to avoid noise)
        const webhookUrl = process.env.OPENCLAW_WEBHOOK_URL;
        if (webhookUrl && input.rating === -1) {
          fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              event: "user_feedback",
              feedbackId,
              rating: input.rating,
              messagePreview: input.messagePreview,
              comment: input.comment,
              userId: (ctx as any).user?.id ?? null,
              timestamp: new Date().toISOString(),
            }),
          }).catch(e => console.warn("[Webhook] Failed to push feedback:", e));
        }
        return { ok: true };
      }),
    /** List all message feedbacks (admin only) */
    list: publicProcedure.query(async ({ ctx }) => {
      if (!ctx.user || ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      return getMessageFeedbacks(200);
    }),
  }),

  // ── Invite & Credits ─────────────────────────────────────────────────────────

  invite: router({
    /** Get current user's invite code — requires login */
    getMyCode: publicProcedure.query(async ({ ctx }) => {
      if (!ctx.user) return null;
      const code = await ensureInviteCode(ctx.user.id);
      const stats = await getInviteStats(ctx.user.id);
      const credits = await getUserCredits(ctx.user.id);
      return { code, ...stats, credits };
    }),

    /** Redeem an invite code — requires login */
    redeem: publicProcedure
      .input(z.object({ code: z.string().min(1).max(16) }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录" });
        const success = await redeemInviteCode(ctx.user.id, input.code.toUpperCase());
        if (!success) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "邀请码无效或已使用",
          });
        }
        return { success: true, creditsAwarded: 500 };
      }),

    /** Get credits balance */
    getCredits: publicProcedure.query(async ({ ctx }) => {
      if (!ctx.user) return { credits: 0 };
      const credits = await getUserCredits(ctx.user.id);
      return { credits };
    }),
  }),

  // ── IM ──────────────────────────────────────────────────────────────────────

  im: router({
    /** Get a short-lived WebSocket auth token — requires login */
    getWsToken: publicProcedure.query(async ({ ctx }) => {
      if (!ctx.user) return { token: null };
      const token = await createSessionToken({ userId: ctx.user.id, username: ctx.user.username ?? "" });
      return { token };
    }),

    /** Get OpenClaw (小虾米) connection status — admin only */
    getOpenClawStatus: publicProcedure.query(async ({ ctx }) => {
      if (!ctx.user || ctx.user.role !== "admin") {
        return { connected: false, adminOnly: true };
      }
      const { isOpenClawConnected } = await import("./im/wsServer");
      return { connected: isOpenClawConnected(), adminOnly: false };
    }),

    /** Get all users for the contacts list */
    getContacts: publicProcedure.query(async ({ ctx }) => {
      const { drizzle } = await import("drizzle-orm/mysql2");
      const db = drizzle(process.env.DATABASE_URL!);
      const allUsers = await db
        .select({
          id: users.id,
          name: users.name,
          username: users.username,
          role: users.role,
        })
        .from(users)
        .orderBy(users.name);
      const currentUserId = ctx.user?.id ?? 0;
      return allUsers
        .filter(u => u.id !== currentUserId && !u.username?.startsWith("anon_"))
        .map(u => ({
          ...u,
          displayName: u.name || u.username || `用户${u.id}`,
        }));
    }),
  }),

  // ── Search ────────────────────────────────────────────────────────────────────

  search: router({
    /** Global search across sessions and reports */
    query: publicProcedure
      .input(z.object({ q: z.string().min(1).max(100) }))
      .query(async ({ ctx, input }) => {
        const userId = await ctx.getEffectiveUserId();
        const q = input.q.toLowerCase().trim();
        const [sessions, reports] = await Promise.all([
          getUserSessions(userId),
          getUserReports(userId),
        ]);
        const matchedSessions = sessions.filter(s =>
          s.filename?.toLowerCase().includes(q) ||
          s.originalName?.toLowerCase().includes(q)
        ).slice(0, 10);
        const matchedReports = reports.filter(r =>
          r.title?.toLowerCase().includes(q) ||
          r.prompt?.toLowerCase().includes(q) ||
          r.filename?.toLowerCase().includes(q)
        ).slice(0, 10);
        return { sessions: matchedSessions, reports: matchedReports };
      }),

    /** Get recent sessions and reports for empty state */
    recent: publicProcedure.query(async ({ ctx }) => {
      const userId = await ctx.getEffectiveUserId();
      const [sessions, reports] = await Promise.all([
        getUserSessions(userId),
        getUserReports(userId),
      ]);
      return {
        sessions: sessions.slice(0, 5),
        reports: reports.slice(0, 5),
      };
    }),
  }),
});
export type AppRouter = typeof appRouter;
