import { and, eq, gt, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, sessions, reports, scheduledTasks, reportFeedback, messageFeedback } from "../drizzle/schema";
import type { InsertSession, InsertReport, InsertScheduledTask, InsertReportFeedback, InsertMessageFeedback } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

/**
 * Reset the cached DB connection so the next call to getDb() creates a fresh one.
 * Call this when you catch ECONNRESET / ECONNREFUSED / PROTOCOL_CONNECTION_LOST.
 */
export function resetDb() {
  _db = null;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserByUsername(username: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.username, username)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function createUser(data: { username: string; passwordHash: string; name?: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const inviteCode = generateInviteCode();
  await db.insert(users).values({
    username: data.username,
    passwordHash: data.passwordHash,
    name: data.name ?? data.username,
    loginMethod: "password",
    inviteCode,
    lastSignedIn: new Date(),
  });
  const created = await getUserByUsername(data.username);
  return created!;
}

export async function updateUserPassword(userId: number, passwordHash: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
}

// ── Sessions ──────────────────────────────────────────────────────────────────

export async function createSession(data: InsertSession) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(sessions).values(data);
  return data;
}

export async function updateSession(id: string, data: Partial<InsertSession>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(sessions).set(data).where(eq(sessions.id, id));
}

export async function getSession(id: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
  return result[0];
}

export async function getUserSessions(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(sessions)
    .where(and(eq(sessions.userId, userId), eq(sessions.isMerged, 0)))
    .orderBy(sessions.createdAt);
}

export async function deleteSession(id: string) {
  const db = await getDb();
  if (!db) return;
  await db.delete(sessions).where(eq(sessions.id, id));
}

// ── Reports ───────────────────────────────────────────────────────────────────

export async function createReport(data: InsertReport) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(reports).values(data);
  return data;
}

export async function updateReport(id: string, data: Partial<InsertReport>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(reports).set(data).where(eq(reports.id, id));
}

export async function getReport(id: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(reports)
    .where(eq(reports.id, id))
    .limit(1);
  return result[0];
}

export async function getUserReports(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(reports)
    .where(eq(reports.userId, userId))
    .orderBy(reports.createdAt);
}

export async function deleteReport(id: string) {
  const db = await getDb();
  if (!db) return;
  await db.delete(reports).where(eq(reports.id, id));
}

/** Delete expired reports (expiresAt <= now) and return their S3 keys for cleanup */
export async function deleteExpiredReports() {
  const db = await getDb();
  if (!db) return [];
  const expired = await db.select({ id: reports.id, fileKey: reports.fileKey })
    .from(reports).where(lt(reports.expiresAt, new Date()));
  if (expired.length > 0) {
    await db.delete(reports).where(lt(reports.expiresAt, new Date()));
  }
  return expired;
}

// ── Scheduled Tasks ───────────────────────────────────────────────────────────

export async function createScheduledTask(data: InsertScheduledTask) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(scheduledTasks).values(data);
  return data;
}

export async function updateScheduledTask(id: string, data: Partial<InsertScheduledTask>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(scheduledTasks).set(data).where(eq(scheduledTasks.id, id));
}

export async function getUserScheduledTasks(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(scheduledTasks)
    .where(eq(scheduledTasks.userId, userId))
    .orderBy(scheduledTasks.createdAt);
}

export async function deleteScheduledTask(id: string) {
  const db = await getDb();
  if (!db) return;
  await db.delete(scheduledTasks).where(eq(scheduledTasks.id, id));
}

// ── Invite & Credits ──────────────────────────────────────────────────────────

import { nanoid } from "nanoid";
import { inviteRecords } from "../drizzle/schema";
import type { InsertInviteRecord } from "../drizzle/schema";

/** Generate a short unique invite code (8 chars) */
export function generateInviteCode(): string {
  return nanoid(8).toUpperCase();
}

/** Get user by invite code */
export async function getUserByInviteCode(inviteCode: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users)
    .where(eq(users.inviteCode, inviteCode))
    .limit(1);
  return result[0];
}

/** Ensure user has an invite code, generate one if missing */
export async function ensureInviteCode(userId: number): Promise<string> {
  const db = await getDb();
  if (!db) return generateInviteCode();

  const result = await db.select({ inviteCode: users.inviteCode })
    .from(users).where(eq(users.id, userId)).limit(1);

  if (result[0]?.inviteCode) return result[0].inviteCode;

  // Generate and save a new invite code
  const code = generateInviteCode();
  await db.update(users).set({ inviteCode: code }).where(eq(users.id, userId));
  return code;
}

/** Award credits to a user */
export async function addCredits(userId: number, amount: number) {
  const db = await getDb();
  if (!db) return;
  // Use raw SQL increment to avoid race conditions
  await db.execute(
    `UPDATE users SET credits = credits + ${amount} WHERE id = ${userId}`
  );
}

/** Create an invite record and award credits to both parties */
export async function redeemInviteCode(inviteeUserId: number, inviteCode: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  // Find inviter
  const inviter = await getUserByInviteCode(inviteCode);
  if (!inviter) return false;
  if (inviter.id === inviteeUserId) return false; // Can't invite yourself

  // Check if already redeemed
  const existing = await db.select().from(inviteRecords)
    .where(eq(inviteRecords.inviteeUserId, inviteeUserId))
    .limit(1);
  if (existing.length > 0) return false; // Already redeemed an invite

  // Record the invite
  const record: InsertInviteRecord = {
    id: nanoid(),
    inviterUserId: inviter.id,
    inviteeUserId,
    inviteCode,
    inviterCredits: 500,
    inviteeCredits: 500,
    status: "completed",
  };
  await db.insert(inviteRecords).values(record);

  // Mark invitee as invited by this code
  await db.update(users).set({ invitedBy: inviteCode }).where(eq(users.id, inviteeUserId));

  // Award credits to both
  await addCredits(inviter.id, 500);
  await addCredits(inviteeUserId, 500);

  return true;
}

/** Get invite stats for a user */
export async function getInviteStats(userId: number) {
  const db = await getDb();
  if (!db) return { inviteCount: 0, totalCreditsEarned: 0 };

  const records = await db.select().from(inviteRecords)
    .where(eq(inviteRecords.inviterUserId, userId));

  return {
    inviteCount: records.length,
    totalCreditsEarned: records.reduce((sum, r) => sum + r.inviterCredits, 0),
  };
}

/** Get user's current credits balance */
export async function getUserCredits(userId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const result = await db.select({ credits: users.credits })
    .from(users).where(eq(users.id, userId)).limit(1);
  return result[0]?.credits ?? 0;
}

// ── Report Feedback (Self-Learning / RAG) ──────────────────────────────────────

/** Save user feedback for a report */
export async function createReportFeedback(data: InsertReportFeedback) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(reportFeedback).values(data);
  return data;
}

/** Get existing feedback for a report by a user */
export async function getReportFeedback(reportId: string, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(reportFeedback)
    .where(and(eq(reportFeedback.reportId, reportId), eq(reportFeedback.userId, userId)))
    .limit(1);
  return result[0];
}

/** Update existing feedback */
export async function updateReportFeedback(id: string, data: Partial<InsertReportFeedback>) {
  const db = await getDb();
  if (!db) return;
  await db.update(reportFeedback).set(data).where(eq(reportFeedback.id, id));
}

/**
 * RAG: Retrieve top-rated similar examples based on column signature overlap.
 * Returns up to `limit` examples with rating >= 4 that share column names.
 */
export async function getSimilarExamples(columnSignature: string, limit = 3) {
  const db = await getDb();
  if (!db) return [];

  // Get all high-rated feedback with column signatures
  const examples = await db.select().from(reportFeedback)
    .where(and(
      gt(reportFeedback.rating, 3), // rating >= 4
    ))
    .orderBy(reportFeedback.createdAt)
    .limit(50);

  if (examples.length === 0) return [];

  // Simple similarity: count overlapping column names
  const inputCols = new Set(columnSignature.toLowerCase().split(',').map(c => c.trim()));

  const scored = examples
    .filter(e => e.columnSignature && e.prompt)
    .map(e => {
      const exCols = new Set(e.columnSignature!.toLowerCase().split(',').map(c => c.trim()));
      let overlap = 0;
      inputCols.forEach(c => { if (exCols.has(c)) overlap++; });
      const score = overlap / Math.max(inputCols.size, exCols.size);
      return { ...e, score };
    })
    .filter(e => e.score > 0)
    .sort((a, b) => b.score - a.score || b.rating - a.rating)
    .slice(0, limit);

  return scored;
}

// ── HR: Payslip ───────────────────────────────────────────────────────────────

import {
  hrPayslipRecords, hrAttendanceSessions,
  type InsertHrPayslipRecord, type InsertHrAttendanceSession,
} from "../drizzle/schema";

export async function createHrPayslip(data: InsertHrPayslipRecord) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(hrPayslipRecords).values(data);
  return data;
}

export async function updateHrPayslip(id: string, data: Partial<InsertHrPayslipRecord>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(hrPayslipRecords).set(data).where(eq(hrPayslipRecords.id, id));
}

export async function getHrPayslip(id: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(hrPayslipRecords)
    .where(eq(hrPayslipRecords.id, id)).limit(1);
  return result[0];
}

export async function getUserHrPayslips(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(hrPayslipRecords)
    .where(eq(hrPayslipRecords.userId, userId))
    .orderBy(hrPayslipRecords.createdAt);
}

export async function deleteHrPayslip(id: string) {
  const db = await getDb();
  if (!db) return;
  await db.delete(hrPayslipRecords).where(eq(hrPayslipRecords.id, id));
}

// ── HR: Attendance ────────────────────────────────────────────────────────────

export async function createHrAttendance(data: InsertHrAttendanceSession) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(hrAttendanceSessions).values(data);
  return data;
}

export async function updateHrAttendance(id: string, data: Partial<InsertHrAttendanceSession>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(hrAttendanceSessions).set(data).where(eq(hrAttendanceSessions.id, id));
}

export async function getHrAttendance(id: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(hrAttendanceSessions)
    .where(eq(hrAttendanceSessions.id, id)).limit(1);
  return result[0];
}

export async function getUserHrAttendances(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(hrAttendanceSessions)
    .where(eq(hrAttendanceSessions.userId, userId))
    .orderBy(hrAttendanceSessions.createdAt);
}

export async function deleteHrAttendance(id: string) {
  const db = await getDb();
  if (!db) return;
  await db.delete(hrAttendanceSessions).where(eq(hrAttendanceSessions.id, id));
}

// ── Message Feedback ──────────────────────────────────────────────────────────

export async function createMessageFeedback(data: InsertMessageFeedback) {
  const db = await getDb();
  if (!db) return;
  await db.insert(messageFeedback).values(data);
}

export async function getMessageFeedbacks(limit = 200) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(messageFeedback)
    .orderBy(messageFeedback.createdAt)
    .limit(limit);
}

// ── Anonymous User ────────────────────────────────────────────────────────────

/**
 * Get or create an anonymous user by their anon cookie ID.
 * Anonymous users have username = "anon_<anonId>", no password, loginMethod = "anon".
 * This allows unauthenticated users to use the system without registering.
 */
export async function getOrCreateAnonUser(anonId: string): Promise<{ id: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const username = `anon_${anonId}`;
  const existing = await getUserByUsername(username);
  if (existing) return { id: existing.id };
  const inviteCode = generateInviteCode();
  await db.insert(users).values({
    username,
    passwordHash: "",
    name: "访客",
    loginMethod: "anon",
    inviteCode,
    lastSignedIn: new Date(),
  });
  const created = await getUserByUsername(username);
  return { id: created!.id };
}
