/**
 * Admin REST API — for external systems like OpenClaw
 * All endpoints require Bearer token authentication via admin_api_keys table
 * Base path: /api/admin
 */
import { Router, Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { getDb } from "./db";
import {
  adminApiKeys, users, messageFeedback, openclawTasks,
  reports, sessions,
} from "../drizzle/schema";
import { eq, desc, count, sql } from "drizzle-orm";

const router = Router();

// ── Auth Middleware ────────────────────────────────────────────────────────────
async function requireAdminApiKey(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }
  const token = authHeader.slice(7);
  const hash = crypto.createHash("sha256").update(token).digest("hex");

  const db = await getDb();
  if (!db) {
    res.status(503).json({ error: "Database unavailable" });
    return;
  }
  const [keyRecord] = await db
    .select()
    .from(adminApiKeys)
    .where(eq(adminApiKeys.keyHash, hash))
    .limit(1);

  if (!keyRecord || !keyRecord.isActive) {
    res.status(401).json({ error: "Invalid or inactive API key" });
    return;
  }

  // Update lastUsedAt
  await db
    .update(adminApiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(adminApiKeys.id, keyRecord.id));

  next();
}

router.use(requireAdminApiKey);

// ── GET /api/admin/users ───────────────────────────────────────────────────────
// Query params: page (default 1), limit (default 50), role (optional)
router.get("/users", async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, parseInt(req.query.limit as string) || 50);
    const offset = (page - 1) * limit;

    const db = await getDb();
    if (!db) { res.status(503).json({ error: "Database unavailable" }); return; }
    const rows = await db
      .select({
        id: users.id,
        username: users.username,
        name: users.name,
        email: users.email,
        role: users.role,
        plan: users.plan,
        credits: users.credits,
        inviteCode: users.inviteCode,
        createdAt: users.createdAt,
        lastSignedIn: users.lastSignedIn,
      })
      .from(users)
      .orderBy(desc(users.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db.select({ total: count() }).from(users);

    res.json({
      data: rows,
      pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) },
    });
  } catch (err) {
    console.error("[Admin API] GET /users error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /api/admin/users/:id/role ───────────────────────────────────────────
// Body: { role: "admin" | "user" }
router.patch("/users/:id/role", async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.id);
    const { role } = req.body as { role: "admin" | "user" };

    if (!role || !["admin", "user"].includes(role)) {
      res.status(400).json({ error: "role must be 'admin' or 'user'" });
      return;
    }

    const db = await getDb();
    if (!db) { res.status(503).json({ error: "Database unavailable" }); return; }
    await db.update(users).set({ role }).where(eq(users.id, userId));

    const [updated] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!updated) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json({ success: true, user: { id: updated.id, username: updated.username, role: updated.role } });
  } catch (err) {
    console.error("[Admin API] PATCH /users/:id/role error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/admin/feedback ───────────────────────────────────────────────────
// Query params: page, limit, rating (-1 or 1)
router.get("/feedback", async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, parseInt(req.query.limit as string) || 50);
    const offset = (page - 1) * limit;

    const db = await getDb();
    if (!db) { res.status(503).json({ error: "Database unavailable" }); return; }
    const rows = await db
      .select()
      .from(messageFeedback)
      .orderBy(desc(messageFeedback.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db.select({ total: count() }).from(messageFeedback);

    res.json({
      data: rows,
      pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) },
    });
  } catch (err) {
    console.error("[Admin API] GET /feedback error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/admin/stats ──────────────────────────────────────────────────────
// Returns system-wide statistics
router.get("/stats", async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    if (!db) { res.status(503).json({ error: "Database unavailable" }); return; }

    const [userStats] = await db.select({ total: count() }).from(users);
    const [reportStats] = await db.select({ total: count() }).from(reports);
    const [sessionStats] = await db.select({ total: count() }).from(sessions);
    const [taskStats] = await db.select({ total: count() }).from(openclawTasks);
    const [feedbackStats] = await db.select({ total: count() }).from(messageFeedback);

    // Tasks by status
    const tasksByStatus = await db
      .select({ status: openclawTasks.status, count: count() })
      .from(openclawTasks)
      .groupBy(openclawTasks.status);

    // Feedback breakdown
    const feedbackBreakdown = await db
      .select({ rating: messageFeedback.rating, count: count() })
      .from(messageFeedback)
      .groupBy(messageFeedback.rating);

    // Today's activity
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const [todayTasks] = await db
      .select({ total: count() })
      .from(openclawTasks)
      .where(sql`${openclawTasks.createdAt} >= ${todayStart}`);
    const [todayUsers] = await db
      .select({ total: count() })
      .from(users)
      .where(sql`${users.createdAt} >= ${todayStart}`);

    res.json({
      totals: {
        users: userStats.total,
        reports: reportStats.total,
        sessions: sessionStats.total,
        tasks: taskStats.total,
        feedback: feedbackStats.total,
      },
      today: {
        newTasks: todayTasks.total,
        newUsers: todayUsers.total,
      },
      tasksByStatus: Object.fromEntries(tasksByStatus.map((r: { status: string; count: number }) => [r.status, r.count])),
      feedbackBreakdown: {
        thumbsUp: feedbackBreakdown.find((r: { rating: number; count: number }) => r.rating === 1)?.count ?? 0,
        thumbsDown: feedbackBreakdown.find((r: { rating: number; count: number }) => r.rating === -1)?.count ?? 0,
      },
    });
  } catch (err) {
    console.error("[Admin API] GET /stats error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/admin/tasks ──────────────────────────────────────────────────────
// Query params: page, limit, status (pending|processing|completed|failed)
router.get("/tasks", async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, parseInt(req.query.limit as string) || 50);
    const offset = (page - 1) * limit;

    const db = await getDb();
    if (!db) { res.status(503).json({ error: "Database unavailable" }); return; }
    const rows = await db
      .select()
      .from(openclawTasks)
      .orderBy(desc(openclawTasks.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db.select({ total: count() }).from(openclawTasks);

    res.json({
      data: rows,
      pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) },
    });
  } catch (err) {
    console.error("[Admin API] GET /tasks error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/admin/notify ────────────────────────────────────────────────────
// Push a system notification to all users or a specific user
// Body: { title, content, userId? }
router.post("/notify", async (req: Request, res: Response) => {
  try {
    const { title, content, userId } = req.body as {
      title: string;
      content: string;
      userId?: number;
    };

    if (!title || !content) {
      res.status(400).json({ error: "title and content are required" });
      return;
    }

    // Use the built-in notification helper
    const { notifyOwner } = await import("./_core/notification");
    const notifyContent = userId
      ? `[To User #${userId}]\n${content}`
      : `[Broadcast]\n${content}`;

    const ok = await notifyOwner({ title, content: notifyContent });
    res.json({ success: ok, message: ok ? "Notification sent" : "Notification service unavailable" });
  } catch (err) {
    console.error("[Admin API] POST /notify error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
