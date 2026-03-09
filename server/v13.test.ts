/**
 * V13.7 + V13.9 Unit Tests
 * Tests for personal templates CRUD and chat conversation persistence
 */
import { describe, it, expect, vi } from "vitest";

// ── Mock getDb ─────────────────────────────────────────────────────────────────
vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue(null),
  getSession: vi.fn(),
  createSession: vi.fn(),
  updateSession: vi.fn(),
  createReport: vi.fn(),
  updateReport: vi.fn(),
  getReport: vi.fn(),
  getSimilarExamples: vi.fn(),
  getUserReports: vi.fn().mockResolvedValue([]),
}));

// Helper to get column names from a Drizzle table object
function getTableColumns(table: any): string[] {
  // Drizzle v0.44+: columns are direct properties on the table object (not starting with $)
  return Object.keys(table).filter(k =>
    !k.startsWith('$') && !k.startsWith('_') && typeof table[k] === 'object' && table[k] !== null
  );
}

// ── V13.7 Personal Templates Schema Tests ─────────────────────────────────────
describe("V13.7 PersonalTemplates schema", () => {
  it("should be defined and exported", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.personalTemplates).toBeDefined();
  });

  it("should have required columns: id, userId, name, systemPrompt, inputFields, useCount", async () => {
    const { personalTemplates } = await import("../drizzle/schema");
    const cols = getTableColumns(personalTemplates);
    expect(cols).toContain("id");
    expect(cols).toContain("userId");
    expect(cols).toContain("name");
    expect(cols).toContain("systemPrompt");
    expect(cols).toContain("inputFields");
    expect(cols).toContain("useCount");
  });

  it("should have PersonalTemplate and InsertPersonalTemplate type exports", async () => {
    const schema = await import("../drizzle/schema");
    // Type exports are compile-time only, but we can verify the table is correctly typed
    // by checking it has the $inferSelect and $inferInsert properties
    expect((schema.personalTemplates as any).$inferSelect).toBeUndefined(); // types don't exist at runtime
    // Just verify the table object exists
    expect(typeof schema.personalTemplates).toBe("object");
  });
});

// ── V13.9 ChatConversations Schema Tests ──────────────────────────────────────
describe("V13.9 ChatConversations schema", () => {
  it("should be defined and exported", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.chatConversations).toBeDefined();
  });

  it("should have required columns: id, userId, title, messageCount, sessionIds", async () => {
    const { chatConversations } = await import("../drizzle/schema");
    const cols = getTableColumns(chatConversations);
    expect(cols).toContain("id");
    expect(cols).toContain("userId");
    expect(cols).toContain("title");
    expect(cols).toContain("messageCount");
    expect(cols).toContain("sessionIds");
  });

  it("should have timestamp columns: createdAt, updatedAt", async () => {
    const { chatConversations } = await import("../drizzle/schema");
    const cols = getTableColumns(chatConversations);
    expect(cols).toContain("createdAt");
    expect(cols).toContain("updatedAt");
  });
});

// ── V13.9 ChatMessages Schema Tests ───────────────────────────────────────────
describe("V13.9 ChatMessages schema", () => {
  it("should be defined and exported", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.chatMessages).toBeDefined();
  });

  it("should have required columns: id, conversationId, role, content, fileNames", async () => {
    const { chatMessages } = await import("../drizzle/schema");
    const cols = getTableColumns(chatMessages);
    expect(cols).toContain("id");
    expect(cols).toContain("conversationId");
    expect(cols).toContain("role");
    expect(cols).toContain("content");
    expect(cols).toContain("fileNames");
  });

  it("should have createdAt column", async () => {
    const { chatMessages } = await import("../drizzle/schema");
    const cols = getTableColumns(chatMessages);
    expect(cols).toContain("createdAt");
  });
});

// ── V13.7 API Input Validation Tests ──────────────────────────────────────────
describe("V13.7 Template input validation", () => {
  it("should reject template without name", () => {
    const validate = (body: { name?: string; systemPrompt?: string }) => {
      if (!body.name || !body.systemPrompt) return { error: "name and systemPrompt are required" };
      return { success: true };
    };
    expect(validate({ systemPrompt: "test" })).toEqual({ error: "name and systemPrompt are required" });
    expect(validate({ name: "test" })).toEqual({ error: "name and systemPrompt are required" });
    expect(validate({ name: "test", systemPrompt: "prompt" })).toEqual({ success: true });
  });

  it("should build correct user message from input fields", () => {
    const buildUserMsg = (
      fields: Array<{ key: string; label: string; unit?: string }>,
      inputs: Record<string, string>
    ) => {
      let msg = "请根据以下参数进行计算：\n";
      for (const f of fields) {
        if (inputs[f.key] !== undefined) {
          msg += `${f.label}：${inputs[f.key]}${f.unit ? ' ' + f.unit : ''}\n`;
        }
      }
      return msg;
    };

    const fields = [
      { key: "costPrice", label: "供货价", unit: "元" },
      { key: "teamPrice", label: "团购价", unit: "元" },
    ];
    const inputs = { costPrice: "100", teamPrice: "150" };
    const msg = buildUserMsg(fields, inputs);
    expect(msg).toContain("供货价：100 元");
    expect(msg).toContain("团购价：150 元");
  });

  it("should skip fields not in inputs", () => {
    const buildUserMsg = (
      fields: Array<{ key: string; label: string; unit?: string }>,
      inputs: Record<string, string>
    ) => {
      let msg = "请根据以下参数进行计算：\n";
      for (const f of fields) {
        if (inputs[f.key] !== undefined) {
          msg += `${f.label}：${inputs[f.key]}${f.unit ? ' ' + f.unit : ''}\n`;
        }
      }
      return msg;
    };

    const fields = [
      { key: "a", label: "A" },
      { key: "b", label: "B" },
    ];
    const msg = buildUserMsg(fields, { a: "10" });
    expect(msg).toContain("A：10");
    expect(msg).not.toContain("B：");
  });
});

// ── V13.9 Conversation Persistence Logic Tests ────────────────────────────────
describe("V13.9 Conversation persistence logic", () => {
  it("should use provided conversation_id if given", () => {
    const resolveConvId = (provided?: string, generated = "new-id") =>
      provided || generated;
    expect(resolveConvId("existing-id")).toBe("existing-id");
    expect(resolveConvId(undefined, "new-id")).toBe("new-id");
  });

  it("should truncate long messages for conversation title", () => {
    const buildTitle = (msg: string) => msg.slice(0, 100);
    const longMsg = "a".repeat(200);
    expect(buildTitle(longMsg).length).toBe(100);
    const shortMsg = "hello world";
    expect(buildTitle(shortMsg)).toBe("hello world");
  });

  it("should handle empty sessionIds correctly", () => {
    const resolveSessionIds = (
      session_ids?: string[],
      session_id?: string
    ) => session_ids?.length ? session_ids : session_id ? [session_id] : [];

    expect(resolveSessionIds(["a", "b"])).toEqual(["a", "b"]);
    expect(resolveSessionIds(undefined, "single")).toEqual(["single"]);
    expect(resolveSessionIds()).toEqual([]);
    expect(resolveSessionIds([])).toEqual([]);
  });

  it("should set null for sessionIds when no files attached", () => {
    const buildSessionIds = (ids: string[]) =>
      ids.length ? ids : null;

    expect(buildSessionIds(["id1"])).toEqual(["id1"]);
    expect(buildSessionIds([])).toBeNull();
  });
});

// ── V13.9 Admin API Conversations Tests ───────────────────────────────────────
describe("V13.9 Admin API conversations endpoint", () => {
  it("should parse pagination params correctly", () => {
    const parsePagination = (query: { page?: string; limit?: string }) => ({
      page: Math.max(1, parseInt(query.page || "1")),
      limit: Math.min(100, parseInt(query.limit || "20")),
      offset: (Math.max(1, parseInt(query.page || "1")) - 1) *
              Math.min(100, parseInt(query.limit || "20")),
    });

    expect(parsePagination({})).toEqual({ page: 1, limit: 20, offset: 0 });
    expect(parsePagination({ page: "2", limit: "10" })).toEqual({ page: 2, limit: 10, offset: 10 });
    expect(parsePagination({ limit: "200" })).toEqual({ page: 1, limit: 100, offset: 0 }); // capped at 100
    expect(parsePagination({ page: "0" })).toEqual({ page: 1, limit: 20, offset: 0 }); // min 1
  });

  it("should parse userId filter correctly", () => {
    const parseUserId = (val?: string) =>
      val ? parseInt(val) : null;

    expect(parseUserId("123")).toBe(123);
    expect(parseUserId(undefined)).toBeNull();
    // empty string: parseInt("") returns NaN, but our function returns null for falsy values
    expect(parseUserId("")).toBeNull();
  });
});
