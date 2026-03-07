import {
  int, mysqlEnum, mysqlTable, text,
  timestamp, varchar, json,
} from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  plan: mysqlEnum("plan", ["free", "pro", "enterprise"]).default("free").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ── File Sessions ─────────────────────────────────────────────────────────────
// Each uploaded file creates a session. Multiple sessions can be merged.

export const sessions = mysqlTable("sessions", {
  id:           varchar("id", { length: 64 }).primaryKey(),
  userId:       int("userId").notNull(),
  filename:     varchar("filename", { length: 255 }).notNull(),
  originalName: varchar("originalName", { length: 255 }).notNull(),
  fileKey:      varchar("fileKey", { length: 512 }),
  fileUrl:      text("fileUrl"),
  fileSizeKb:   int("fileSizeKb"),
  rowCount:     int("rowCount"),
  colCount:     int("colCount"),
  dfInfo:       json("dfInfo"),
  mergedFrom:   json("mergedFrom"),
  isMerged:     int("isMerged").default(0).notNull(),
  status:       mysqlEnum("status", ["uploading", "ready", "error", "merged"])
                  .default("uploading").notNull(),
  createdAt:    timestamp("createdAt").defaultNow().notNull(),
  updatedAt:    timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Session = typeof sessions.$inferSelect;
export type InsertSession = typeof sessions.$inferInsert;

// ── Reports ───────────────────────────────────────────────────────────────────
// Reports are kept for 24 hours for download, then auto-deleted (no long-term storage)

export const reports = mysqlTable("reports", {
  id:         varchar("id", { length: 64 }).primaryKey(),
  sessionId:  varchar("sessionId", { length: 64 }).notNull(),
  userId:     int("userId").notNull(),
  title:      varchar("title", { length: 255 }).notNull(),
  filename:   varchar("filename", { length: 255 }).notNull(),
  fileKey:    varchar("fileKey", { length: 512 }),
  fileUrl:    text("fileUrl"),
  fileSizeKb: int("fileSizeKb"),
  prompt:     text("prompt"),
  status:     mysqlEnum("status", ["generating", "completed", "failed"])
                .default("generating").notNull(),
  // Auto-expire after 24 hours
  expiresAt:  timestamp("expiresAt").notNull(),
  createdAt:  timestamp("createdAt").defaultNow().notNull(),
  updatedAt:  timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Report = typeof reports.$inferSelect;
export type InsertReport = typeof reports.$inferInsert;

// ── Scheduled Tasks ───────────────────────────────────────────────────────────

export const scheduledTasks = mysqlTable("scheduled_tasks", {
  id:             varchar("id", { length: 64 }).primaryKey(),
  userId:         int("userId").notNull(),
  name:           varchar("name", { length: 255 }).notNull(),
  templatePrompt: text("templatePrompt").notNull(),
  templateName:   varchar("templateName", { length: 100 }),
  cronExpr:       varchar("cronExpr", { length: 100 }).notNull(),
  scheduleDesc:   varchar("scheduleDesc", { length: 100 }),
  notifyEmail:    text("notifyEmail"),
  lastSessionId:  varchar("lastSessionId", { length: 64 }),
  status:         mysqlEnum("status", ["active", "paused", "error"])
                    .default("active").notNull(),
  lastRunAt:      timestamp("lastRunAt"),
  nextRunAt:      timestamp("nextRunAt"),
  lastReportId:   varchar("lastReportId", { length: 64 }),
  runCount:       int("runCount").default(0).notNull(),
  createdAt:      timestamp("createdAt").defaultNow().notNull(),
  updatedAt:      timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ScheduledTask = typeof scheduledTasks.$inferSelect;
export type InsertScheduledTask = typeof scheduledTasks.$inferInsert;