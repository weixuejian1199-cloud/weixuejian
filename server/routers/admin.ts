/**
 * ATLAS Admin Router
 * Provides admin-only procedures for user management, report management, and system stats.
 * All procedures require admin role (enforced by adminProcedure middleware).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { users, reports, sessions } from "../../drizzle/schema";
import { eq, desc, count, sql } from "drizzle-orm";
import { storageDelete } from "../storage";

export const adminRouter = router({
  // ── System Stats ──────────────────────────────────────────────────────────
  stats: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });

    const [userCount, reportCount, sessionCount] = await Promise.all([
      db.select({ count: count() }).from(users),
      db.select({ count: count() }).from(reports),
      db.select({ count: count() }).from(sessions),
    ]);

    // Recent 7 days report counts per day
    const recentReports = await db
      .select({
        date: sql<string>`DATE(${reports.createdAt})`,
        count: count(),
      })
      .from(reports)
      .where(sql`${reports.createdAt} >= DATE_SUB(NOW(), INTERVAL 7 DAY)`)
      .groupBy(sql`DATE(${reports.createdAt})`)
      .orderBy(sql`DATE(${reports.createdAt})`);

    return {
      totalUsers: userCount[0]?.count ?? 0,
      totalReports: reportCount[0]?.count ?? 0,
      totalSessions: sessionCount[0]?.count ?? 0,
      recentReports,
    };
  }),

  // ── User Management ───────────────────────────────────────────────────────
  listUsers: adminProcedure
    .input(z.object({
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(20),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });

      const offset = (input.page - 1) * input.pageSize;
      const [rows, totalRows] = await Promise.all([
        db.select({
          id: users.id,
          username: users.username,
          name: users.name,
          email: users.email,
          role: users.role,
          plan: users.plan,
          credits: users.credits,
          createdAt: users.createdAt,
          lastSignedIn: users.lastSignedIn,
        })
          .from(users)
          .orderBy(desc(users.createdAt))
          .limit(input.pageSize)
          .offset(offset),
        db.select({ count: count() }).from(users),
      ]);

      return {
        users: rows,
        total: totalRows[0]?.count ?? 0,
        page: input.page,
        pageSize: input.pageSize,
      };
    }),

  setUserRole: adminProcedure
    .input(z.object({
      userId: z.number(),
      role: z.enum(["user", "admin"]),
    }))
    .mutation(async ({ input, ctx }) => {
      if (input.userId === ctx.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "不能修改自己的角色" });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });

      await db.update(users).set({ role: input.role }).where(eq(users.id, input.userId));
      return { success: true };
    }),

  deleteUser: adminProcedure
    .input(z.object({ userId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      if (input.userId === ctx.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "不能删除自己的账号" });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });

      await db.delete(users).where(eq(users.id, input.userId));
      return { success: true };
    }),

  // ── Report Management ─────────────────────────────────────────────────────
  listReports: adminProcedure
    .input(z.object({
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(20),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });

      const offset = (input.page - 1) * input.pageSize;
      const [rows, totalRows] = await Promise.all([
        db.select({
          id: reports.id,
          title: reports.title,
          filename: reports.filename,
          fileUrl: reports.fileUrl,
          fileSizeKb: reports.fileSizeKb,
          status: reports.status,
          userId: reports.userId,
          createdAt: reports.createdAt,
          expiresAt: reports.expiresAt,
          // join username
          username: users.username,
          userName: users.name,
        })
          .from(reports)
          .leftJoin(users, eq(reports.userId, users.id))
          .orderBy(desc(reports.createdAt))
          .limit(input.pageSize)
          .offset(offset),
        db.select({ count: count() }).from(reports),
      ]);

      return {
        reports: rows,
        total: totalRows[0]?.count ?? 0,
        page: input.page,
        pageSize: input.pageSize,
      };
    }),

  deleteReport: adminProcedure
    .input(z.object({ reportId: z.string() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });

      // Get report to delete S3 file
      const [report] = await db.select().from(reports).where(eq(reports.id, input.reportId));
      if (!report) throw new TRPCError({ code: "NOT_FOUND", message: "报表不存在" });

      // Delete from S3 if fileKey exists
      if (report.fileKey) {
        try { await storageDelete(report.fileKey); } catch (_) { /* ignore */ }
      }

      await db.delete(reports).where(eq(reports.id, input.reportId));
      return { success: true };
    }),
});
