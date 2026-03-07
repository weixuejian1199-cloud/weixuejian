/**
 * OpenClaw Polling API Tests
 *
 * Tests for GET /api/openclaw/tasks/pending and POST /api/openclaw/tasks/result
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { registerOpenClawPollingRoutes } from "./openclawPolling";

// Mock env
vi.mock("./_core/env", () => ({
  ENV: {
    openClawSessionKey: "test_session_key_abc123",
  },
}));

// Mock getDb — must use vi.hoisted so mockDb is available inside vi.mock factory
const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    select: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue(mockDb),
}));

// Mock storagePut
vi.mock("./storage", () => ({
  storagePut: vi.fn().mockResolvedValue({ key: "test-key", url: "https://s3.example.com/test.xlsx" }),
}));

// Mock nanoid
vi.mock("nanoid", () => ({
  nanoid: vi.fn().mockReturnValue("abc12345"),
}));

// Setup express app
function buildApp() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  registerOpenClawPollingRoutes(app);
  return app;
}

const VALID_AUTH = "Bearer test_session_key_abc123";
const INVALID_AUTH = "Bearer wrong_key";

describe("OpenClaw Polling API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Auth tests ──────────────────────────────────────────────────────────────

  describe("Authentication", () => {
    it("GET /api/openclaw/tasks/pending returns 401 with wrong key", async () => {
      const app = buildApp();
      const res = await request(app)
        .get("/api/openclaw/tasks/pending")
        .set("Authorization", INVALID_AUTH);
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Invalid session key.");
    });

    it("GET /api/openclaw/tasks/pending returns 401 with no auth header", async () => {
      const app = buildApp();
      const res = await request(app).get("/api/openclaw/tasks/pending");
      expect(res.status).toBe(401);
    });

    it("POST /api/openclaw/tasks/result returns 401 with wrong key", async () => {
      const app = buildApp();
      const res = await request(app)
        .post("/api/openclaw/tasks/result")
        .set("Authorization", INVALID_AUTH)
        .send({ task_id: "t1", reply: "done" });
      expect(res.status).toBe(401);
    });
  });

  // ── GET /pending tests ──────────────────────────────────────────────────────

  describe("GET /api/openclaw/tasks/pending", () => {
    it("returns empty tasks array when no pending tasks", async () => {
      // Chain mock: select().from().where().limit() → []
      const limitMock = vi.fn().mockResolvedValue([]);
      const whereMock = vi.fn().mockReturnValue({ limit: limitMock });
      const fromMock = vi.fn().mockReturnValue({ where: whereMock });
      mockDb.select.mockReturnValue({ from: fromMock });

      const app = buildApp();
      const res = await request(app)
        .get("/api/openclaw/tasks/pending")
        .set("Authorization", VALID_AUTH);

      expect(res.status).toBe(200);
      expect(res.body.tasks).toEqual([]);
    });

    it("returns pending tasks and marks them as processing", async () => {
      const fakeTasks = [
        {
          id: "task_001",
          userId: 1,
          externalUserId: "huishu",
          message: "统计销售额",
          fileUrls: ["https://s3.example.com/file1.xlsx"],
          fileNames: ["店铺A.xlsx"],
          status: "pending",
          createdAt: new Date("2026-03-08T07:00:00Z"),
        },
      ];

      const limitMock = vi.fn().mockResolvedValue(fakeTasks);
      const whereMock = vi.fn().mockReturnValue({ limit: limitMock });
      const fromMock = vi.fn().mockReturnValue({ where: whereMock });
      mockDb.select.mockReturnValue({ from: fromMock });

      // Mock update chain
      const updateWhereMock = vi.fn().mockResolvedValue({});
      const updateSetMock = vi.fn().mockReturnValue({ where: updateWhereMock });
      mockDb.update.mockReturnValue({ set: updateSetMock });

      const app = buildApp();
      const res = await request(app)
        .get("/api/openclaw/tasks/pending")
        .set("Authorization", VALID_AUTH);

      expect(res.status).toBe(200);
      expect(res.body.tasks).toHaveLength(1);
      expect(res.body.tasks[0].task_id).toBe("task_001");
      expect(res.body.tasks[0].message).toBe("统计销售额");
      expect(res.body.tasks[0].file_urls).toEqual(["https://s3.example.com/file1.xlsx"]);
      expect(res.body.tasks[0].user_id).toBe("huishu");
      // Should have called update to mark as processing
      expect(mockDb.update).toHaveBeenCalledWith(expect.anything());
    });
  });

  // ── POST /result tests ──────────────────────────────────────────────────────

  describe("POST /api/openclaw/tasks/result", () => {
    it("returns 400 when task_id is missing", async () => {
      const app = buildApp();
      const res = await request(app)
        .post("/api/openclaw/tasks/result")
        .set("Authorization", VALID_AUTH)
        .send({ reply: "done" });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("task_id");
    });

    it("returns 404 when task not found", async () => {
      const limitMock = vi.fn().mockResolvedValue([]);
      const whereMock = vi.fn().mockReturnValue({ limit: limitMock });
      const fromMock = vi.fn().mockReturnValue({ where: whereMock });
      mockDb.select.mockReturnValue({ from: fromMock });

      const app = buildApp();
      const res = await request(app)
        .post("/api/openclaw/tasks/result")
        .set("Authorization", VALID_AUTH)
        .send({ task_id: "nonexistent", reply: "done" });
      expect(res.status).toBe(404);
    });

    it("saves result and returns success with no output files", async () => {
      const fakeTask = { id: "task_001", userId: 1, status: "processing" };
      const limitMock = vi.fn().mockResolvedValue([fakeTask]);
      const whereMock = vi.fn().mockReturnValue({ limit: limitMock });
      const fromMock = vi.fn().mockReturnValue({ where: whereMock });
      mockDb.select.mockReturnValue({ from: fromMock });

      const updateWhereMock = vi.fn().mockResolvedValue({});
      const updateSetMock = vi.fn().mockReturnValue({ where: updateWhereMock });
      mockDb.update.mockReturnValue({ set: updateSetMock });

      const app = buildApp();
      const res = await request(app)
        .post("/api/openclaw/tasks/result")
        .set("Authorization", VALID_AUTH)
        .send({ task_id: "task_001", reply: "已统计完成，共3个店铺，总销售额128,450元" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.task_id).toBe("task_001");
      expect(res.body.files_saved).toBe(0);
    });

    it("uploads output files to S3 and returns download URLs", async () => {
      const { storagePut } = await import("./storage");
      const fakeTask = { id: "task_002", userId: 1, status: "processing" };
      const limitMock = vi.fn().mockResolvedValue([fakeTask]);
      const whereMock = vi.fn().mockReturnValue({ limit: limitMock });
      const fromMock = vi.fn().mockReturnValue({ where: whereMock });
      mockDb.select.mockReturnValue({ from: fromMock });

      const updateWhereMock = vi.fn().mockResolvedValue({});
      const updateSetMock = vi.fn().mockReturnValue({ where: updateWhereMock });
      mockDb.update.mockReturnValue({ set: updateSetMock });

      const app = buildApp();
      const res = await request(app)
        .post("/api/openclaw/tasks/result")
        .set("Authorization", VALID_AUTH)
        .send({
          task_id: "task_002",
          reply: "已生成汇总报表",
          output_files: [
            {
              name: "汇总.xlsx",
              content_base64: Buffer.from("fake excel content").toString("base64"),
              mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.files_saved).toBe(1);
      expect(res.body.download_urls).toHaveLength(1);
      expect(res.body.download_urls[0].name).toBe("汇总.xlsx");
      expect(storagePut).toHaveBeenCalledOnce();
    });
  });
});
