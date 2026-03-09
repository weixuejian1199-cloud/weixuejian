import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// Mock db module
vi.mock("./db", () => ({
  createSession: vi.fn().mockResolvedValue(undefined),
  updateSession: vi.fn().mockResolvedValue(undefined),
  getSession: vi.fn(),
  getUserSessions: vi.fn().mockResolvedValue([]),
  deleteSession: vi.fn().mockResolvedValue(undefined),
  createReport: vi.fn().mockResolvedValue(undefined),
  updateReport: vi.fn().mockResolvedValue(undefined),
  getReport: vi.fn(),
  getUserReports: vi.fn().mockResolvedValue([]),
  createScheduledTask: vi.fn().mockResolvedValue(undefined),
  updateScheduledTask: vi.fn().mockResolvedValue(undefined),
  getUserScheduledTasks: vi.fn().mockResolvedValue([]),
  deleteScheduledTask: vi.fn().mockResolvedValue(undefined),
  upsertUser: vi.fn().mockResolvedValue(undefined),
  getUserByOpenId: vi.fn().mockResolvedValue(undefined),
}));

// Mock storage module
vi.mock("./storage", () => ({
  storagePut: vi.fn().mockResolvedValue({ key: "test-key", url: "https://example.com/test" }),
  storageGet: vi.fn().mockResolvedValue({ key: "test-key", url: "https://example.com/test" }),
  storageDelete: vi.fn().mockResolvedValue(undefined),
}));

import * as db from "./db";

function createTestContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "test-user",
      email: "test@example.com",
      name: "Test User",
      loginMethod: "manus",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    getEffectiveUserId: vi.fn().mockResolvedValue(1),
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

describe("session router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a session and returns an id", async () => {
    const ctx = createTestContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.session.create({
      filename: "sales_data.xlsx",
      originalName: "天猫销售数据.xlsx",
      rowCount: 1000,
      colCount: 12,
    });

    expect(result).toHaveProperty("id");
    expect(typeof result.id).toBe("string");
    expect(result.id.length).toBeGreaterThan(0);
    expect(db.createSession).toHaveBeenCalledOnce();
  });

  it("lists sessions for the current user", async () => {
    const ctx = createTestContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.session.list();

    expect(Array.isArray(result)).toBe(true);
    expect(db.getUserSessions).toHaveBeenCalledWith(1);
  });

  it("throws NOT_FOUND when getting a session that doesn't exist", async () => {
    vi.mocked(db.getSession).mockResolvedValueOnce(undefined);
    const ctx = createTestContext();
    const caller = appRouter.createCaller(ctx);

    await expect(caller.session.get({ id: "nonexistent" })).rejects.toThrow();
  });

  it("throws NOT_FOUND when getting another user's session", async () => {
    vi.mocked(db.getSession).mockResolvedValueOnce({
      id: "other-session",
      userId: 999, // different user
      filename: "test.xlsx",
      originalName: "test.xlsx",
      isMerged: 0,
      status: "ready",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);
    const ctx = createTestContext();
    const caller = appRouter.createCaller(ctx);

    await expect(caller.session.get({ id: "other-session" })).rejects.toThrow();
  });
});

describe("report router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a report and returns an id", async () => {
    const ctx = createTestContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.report.create({
      sessionId: "test-session-id",
      title: "经营日报",
      prompt: "生成今日经营日报",
    });

    expect(result).toHaveProperty("id");
    expect(typeof result.id).toBe("string");
    expect(db.createReport).toHaveBeenCalledOnce();
  });

  it("lists reports for the current user", async () => {
    const ctx = createTestContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.report.list();

    expect(Array.isArray(result)).toBe(true);
    expect(db.getUserReports).toHaveBeenCalledWith(1);
  });
});

describe("scheduledTask router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a scheduled task and returns an id", async () => {
    const ctx = createTestContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.scheduled.create({
      name: "每周经营周报",
      templatePrompt: "生成本周经营周报",
      templateName: "经营日报",
      cronExpr: "0 0 9 * * 1",
      scheduleDesc: "每周一早上9点",
      notifyEmail: "boss@company.com",
    });

    expect(result).toHaveProperty("id");
    expect(typeof result.id).toBe("string");
    expect(db.createScheduledTask).toHaveBeenCalledOnce();
  });

  it("lists scheduled tasks for the current user", async () => {
    const ctx = createTestContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.scheduled.list();

    expect(Array.isArray(result)).toBe(true);
    expect(db.getUserScheduledTasks).toHaveBeenCalledWith(1);
  });

  it("deletes a scheduled task", async () => {
    const ctx = createTestContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.scheduled.delete({ id: "task-123" });

    expect(result).toEqual({ success: true });
    expect(db.deleteScheduledTask).toHaveBeenCalledWith("task-123");
  });
});
