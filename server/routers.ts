import { z } from "zod";
import { nanoid } from "nanoid";
import { TRPCError } from "@trpc/server";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import {
  createSession, updateSession, getSession, getUserSessions, deleteSession,
  createReport, updateReport, getReport, getUserReports,
  createScheduledTask, updateScheduledTask, getUserScheduledTasks, deleteScheduledTask,
  ensureInviteCode, redeemInviteCode, getInviteStats, getUserCredits,
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

  // ── Invite & Credits ──────────────────────────────────────────────────────────────

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
});

export type AppRouter = typeof appRouter;
