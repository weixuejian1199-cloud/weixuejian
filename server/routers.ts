import { z } from "zod";
import { nanoid } from "nanoid";
import { TRPCError } from "@trpc/server";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import {
  createSession, updateSession, getSession, getUserSessions, deleteSession,
  createReport, updateReport, getReport, getUserReports, deleteReport,
  createScheduledTask, updateScheduledTask, getUserScheduledTasks, deleteScheduledTask,
  ensureInviteCode, redeemInviteCode, getInviteStats, getUserCredits,
  createReportFeedback, getReportFeedback, updateReportFeedback, getSimilarExamples,
} from "./db";
import { storageDelete } from "./storage";

// Returns a Date 24 hours from now
function in24Hours() {
  return new Date(Date.now() + 24 * 60 * 60 * 1000);
}

export const appRouter = router({
  system: systemRouter,

  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // ── Sessions ──────────────────────────────────────────────────────────────────

  session: router({
    create: protectedProcedure
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
        const id = nanoid();
        await createSession({
          id,
          userId: ctx.user.id,
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

    get: protectedProcedure
      .input(z.object({ id: z.string() }))
      .query(async ({ ctx, input }) => {
        const session = await getSession(input.id);
        if (!session || session.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        return session;
      }),

    list: protectedProcedure.query(async ({ ctx }) => {
      return getUserSessions(ctx.user.id);
    }),

    delete: protectedProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const session = await getSession(input.id);
        if (!session || session.userId !== ctx.user.id) {
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

    merge: protectedProcedure
      .input(z.object({ sessionIds: z.array(z.string()).min(2) }))
      .mutation(async ({ ctx, input }) => {
        for (const sid of input.sessionIds) {
          const s = await getSession(sid);
          if (!s || s.userId !== ctx.user.id) {
            throw new TRPCError({ code: "NOT_FOUND", message: `Session ${sid} not found` });
          }
        }
        const id = nanoid();
        await createSession({
          id,
          userId: ctx.user.id,
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
    list: protectedProcedure.query(async ({ ctx }) => {
      return getUserReports(ctx.user.id);
    }),

    get: protectedProcedure
      .input(z.object({ id: z.string() }))
      .query(async ({ ctx, input }) => {
        const report = await getReport(input.id);
        if (!report || report.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        return report;
      }),

    create: protectedProcedure
      .input(z.object({
        sessionId: z.string(),
        title: z.string(),
        prompt: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const id = nanoid();
        await createReport({
          id,
          sessionId: input.sessionId,
          userId: ctx.user.id,
          title: input.title,
          filename: `${input.title}_${id}.xlsx`,
          prompt: input.prompt,
          status: "generating",
          expiresAt: in24Hours(),
        });
        return { id };
      }),

    complete: protectedProcedure
      .input(z.object({
        id: z.string(),
        fileKey: z.string(),
        fileUrl: z.string(),
        fileSizeKb: z.number().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const report = await getReport(input.id);
        if (!report || report.userId !== ctx.user.id) {
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

    fail: protectedProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const report = await getReport(input.id);
        if (!report || report.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        await updateReport(input.id, { status: "failed" });
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const report = await getReport(input.id);
        if (!report || report.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        await deleteReport(input.id);
        return { success: true };
      }),
  }),

  // ── Scheduled Tasks ───────────────────────────────────────────────────────────

  scheduledTask: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return getUserScheduledTasks(ctx.user.id);
    }),

    create: protectedProcedure
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
        const id = nanoid();
        await createScheduledTask({
          id,
          userId: ctx.user.id,
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

    update: protectedProcedure
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

    delete: protectedProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ ctx, input }) => {
        await deleteScheduledTask(input.id);
        return { success: true };
      }),
  }),

  // ── Stats / Dashboard ───────────────────────────────────────────────────────

  stats: router({
    dashboard: protectedProcedure.query(async ({ ctx }) => {
      const [sessions, reports, tasks, credits] = await Promise.all([
        getUserSessions(ctx.user.id),
        getUserReports(ctx.user.id),
        getUserScheduledTasks(ctx.user.id),
        getUserCredits(ctx.user.id),
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
    submit: protectedProcedure
      .input(z.object({
        reportId: z.string(),
        rating: z.number().int().min(1).max(5),
        comment: z.string().max(500).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const report = await getReport(input.reportId);
        if (!report || report.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "报表不存在" });
        }
        const session = await getSession(report.sessionId);
        const dfInfo = session?.dfInfo as Array<{ column?: string }> | null;
        const columnSignature = dfInfo
          ? dfInfo.map(c => c.column ?? "").join(",")
          : "";
        const existing = await getReportFeedback(input.reportId, ctx.user.id);
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
          userId: ctx.user.id,
          rating: input.rating,
          comment: input.comment ?? null,
          columnSignature,
          prompt: report.prompt,
          exampleDataKey: null,
        });
        return { created: true };
      }),

    /** Get my feedback for a report */
    getMine: protectedProcedure
      .input(z.object({ reportId: z.string() }))
      .query(async ({ ctx, input }) => {
        return getReportFeedback(input.reportId, ctx.user.id);
      }),
  }),

  // ── Invite & Credits ───────────────────────────────────────────────────────────────────────────────────────

  invite: router({
    /** Get current user's invite code (generates one if not exists) */
    getMyCode: protectedProcedure.query(async ({ ctx }) => {
      const code = await ensureInviteCode(ctx.user.id);
      const stats = await getInviteStats(ctx.user.id);
      const credits = await getUserCredits(ctx.user.id);
      return { code, ...stats, credits };
    }),

    /** Redeem an invite code (called after user registers) */
    redeem: protectedProcedure
      .input(z.object({ code: z.string().min(1).max(16) }))
      .mutation(async ({ ctx, input }) => {
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
    getCredits: protectedProcedure.query(async ({ ctx }) => {
      const credits = await getUserCredits(ctx.user.id);
      return { credits };
    }),
  }),

  // ── Search ────────────────────────────────────────────────────────────────────

  search: router({
    /** Global search across sessions and reports */
    query: protectedProcedure
      .input(z.object({ q: z.string().min(1).max(100) }))
      .query(async ({ ctx, input }) => {
        const q = input.q.toLowerCase().trim();
        const [sessions, reports] = await Promise.all([
          getUserSessions(ctx.user.id),
          getUserReports(ctx.user.id),
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
    recent: protectedProcedure.query(async ({ ctx }) => {
      const [sessions, reports] = await Promise.all([
        getUserSessions(ctx.user.id),
        getUserReports(ctx.user.id),
      ]);
      return {
        sessions: sessions.slice(0, 5),
        reports: reports.slice(0, 5),
      };
    }),
  }),
});
export type AppRouter = typeof appRouter;
