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
  /** Legacy OAuth identifier — kept for backward compat, nullable for new accounts */
  openId: varchar("openId", { length: 64 }).unique(),
  /** Username: phone number or email address used for login */
  username: varchar("username", { length: 320 }).unique(),
  /** bcrypt hashed password */
  passwordHash: varchar("passwordHash", { length: 255 }),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  plan: mysqlEnum("plan", ["free", "pro", "enterprise"]).default("free").notNull(),
  /** Unique invite code for sharing, auto-generated on first login */
  inviteCode: varchar("inviteCode", { length: 16 }).unique(),
  /** Invited by which user's inviteCode */
  invitedBy: varchar("invitedBy", { length: 16 }),
  /** Credits balance */
  credits: int("credits").default(0).notNull(),
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

// ── Invite Records ────────────────────────────────────────────────────────────
// Tracks successful invitations and credit awards

export const inviteRecords = mysqlTable("invite_records", {
  id:            varchar("id", { length: 64 }).primaryKey(),
  inviterUserId: int("inviterUserId").notNull(),
  inviteeUserId: int("inviteeUserId").notNull(),
  inviteCode:    varchar("inviteCode", { length: 16 }).notNull(),
  /** Credits awarded to inviter */
  inviterCredits: int("inviterCredits").default(500).notNull(),
  /** Credits awarded to invitee */
  inviteeCredits: int("inviteeCredits").default(500).notNull(),
  status:        mysqlEnum("status", ["pending", "completed"]).default("completed").notNull(),
  createdAt:     timestamp("createdAt").defaultNow().notNull(),
});

export type InviteRecord = typeof inviteRecords.$inferSelect;
export type InsertInviteRecord = typeof inviteRecords.$inferInsert;

// ── Report Feedback (Self-Learning) ──────────────────────────────────────────
// Users rate reports; high-rated examples are used as RAG few-shot context

export const reportFeedback = mysqlTable("report_feedback", {
  id:         varchar("id", { length: 64 }).primaryKey(),
  reportId:   varchar("reportId", { length: 64 }).notNull(),
  sessionId:  varchar("sessionId", { length: 64 }).notNull(),
  userId:     int("userId").notNull(),
  rating:     int("rating").notNull(), // 1-5 stars
  comment:    text("comment"),
  /** Snapshot of dfInfo columns for similarity matching */
  columnSignature: text("columnSignature"),
  /** The prompt used to generate this report */
  prompt:     text("prompt"),
  /** S3 key of the example data (first 50 rows JSON) */
  exampleDataKey: varchar("exampleDataKey", { length: 512 }),
  createdAt:  timestamp("createdAt").defaultNow().notNull(),
});

export type ReportFeedback = typeof reportFeedback.$inferSelect;
export type InsertReportFeedback = typeof reportFeedback.$inferInsert;
// ── HR: Payslip Records ────────────────────────────────────────────────────────
// Each payslip generation batch creates one record

export const hrPayslipRecords = mysqlTable("hr_payslip_records", {
  id:             varchar("id", { length: 64 }).primaryKey(),
  userId:         int("userId").notNull(),
  filename:       varchar("filename", { length: 255 }).notNull(),
  fileKey:        varchar("fileKey", { length: 512 }),
  fileUrl:        text("fileUrl"),
  fileSizeKb:     int("fileSizeKb"),
  employeeCount:  int("employeeCount"),
  period:         varchar("period", { length: 20 }),   // e.g. "2024-03"
  /** JSON: { nameCol, emailCol, baseSalaryCol, bonusCol, deductionCol, insuranceCol } */
  fieldMap:       json("fieldMap"),
  /** JSON: { totalPayroll, avgSalary, totalTax, totalNetPay } */
  summary:        json("summary"),
  reportFileKey:  varchar("reportFileKey", { length: 512 }),
  reportFileUrl:  text("reportFileUrl"),
  emailStatus:    varchar("emailStatus", { length: 20 }),  // null | 'sending' | 'done' | 'partial'
  emailSentCount: int("emailSentCount").default(0),
  expiresAt:      timestamp("expiresAt").notNull(),          // 1h expiry for sensitive data
  status:         mysqlEnum("status", ["generating", "ready", "error"]).default("generating").notNull(),
  createdAt:      timestamp("createdAt").defaultNow().notNull(),
  updatedAt:      timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type HrPayslipRecord = typeof hrPayslipRecords.$inferSelect;
export type InsertHrPayslipRecord = typeof hrPayslipRecords.$inferInsert;

// ── HR: Attendance Sessions ────────────────────────────────────────────────────
// Each attendance analysis creates one record

export const hrAttendanceSessions = mysqlTable("hr_attendance_sessions", {
  id:             varchar("id", { length: 64 }).primaryKey(),
  userId:         int("userId").notNull(),
  filename:       varchar("filename", { length: 255 }).notNull(),
  fileKey:        varchar("fileKey", { length: 512 }),
  fileUrl:        text("fileUrl"),
  fileSizeKb:     int("fileSizeKb"),
  rowCount:       int("rowCount"),
  period:         varchar("period", { length: 20 }),   // e.g. "2024-03"
  /** JSON: { nameCol, dateCol, checkInCol, checkOutCol, deptCol } */
  fieldMap:       json("fieldMap"),
  /** JSON: { totalEmployees, attendanceRate, lateCount, absentCount, overtimeHours } */
  summary:        json("summary"),
  reportFileKey:  varchar("reportFileKey", { length: 512 }),
  reportFileUrl:  text("reportFileUrl"),
  status:         mysqlEnum("status", ["analyzing", "ready", "error"]).default("analyzing").notNull(),
  createdAt:      timestamp("createdAt").defaultNow().notNull(),
  updatedAt:      timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type HrAttendanceSession = typeof hrAttendanceSessions.$inferSelect;
export type InsertHrAttendanceSession = typeof hrAttendanceSessions.$inferInsert;

// ── OpenClaw Tasks (Polling Architecture) ─────────────────────────────────────
// Tasks created when users send messages with files; polled by OpenClaw agent

export const openclawTasks = mysqlTable("openclaw_tasks", {
  id:          varchar("id", { length: 64 }).primaryKey(),
  userId:      int("userId").notNull(),
  /** External user identifier passed to OpenClaw */
  externalUserId: varchar("externalUserId", { length: 128 }),
  message:     text("message").notNull(),
  /** JSON array of S3 presigned URLs */
  fileUrls:    json("fileUrls").$type<string[]>(),
  /** JSON array of original file names */
  fileNames:   json("fileNames").$type<string[]>(),
  /** Reply text returned by OpenClaw */
  reply:       text("reply"),
  /** JSON array of output files: { name, fileKey, fileUrl, mimeType } */
  outputFiles: json("outputFiles").$type<Array<{ name: string; fileKey: string; fileUrl: string; mimeType: string }>>(),
  status:      mysqlEnum("status", ["pending", "processing", "completed", "failed"])
                 .default("pending").notNull(),
  errorMsg:    text("errorMsg"),
  /** Milliseconds since epoch when task was picked up by OpenClaw */
  pickedUpAt:  timestamp("pickedUpAt"),
  /** Milliseconds since epoch when task was completed */
  completedAt: timestamp("completedAt"),
  createdAt:   timestamp("createdAt").defaultNow().notNull(),
  updatedAt:   timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type OpenclawTask = typeof openclawTasks.$inferSelect;
export type InsertOpenclawTask = typeof openclawTasks.$inferInsert;
