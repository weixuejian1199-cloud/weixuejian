/**
 * OpenClaw Polling API
 *
 * Provides two REST endpoints for the OpenClaw agent to poll tasks:
 *   GET  /api/openclaw/tasks/pending  — fetch pending tasks
 *   POST /api/openclaw/tasks/result   — submit task result
 *
 * Also integrates Telegram notifications:
 *   - When a task is created, ATLAS sends it to Telegram
 *   - A background poller reads replies from Telegram and updates task status
 *
 * Authentication: Authorization: Bearer <OPENCLAW_SESSION_KEY>
 */
import { Express, Request, Response } from "express";
import { getDb } from "./db";
import { openclawTasks, OpenclawTask } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { storagePut } from "./storage";
import { ENV } from "./_core/env";
import { nanoid } from "nanoid";
import {
  sendTaskToTelegram,
  pollTelegramUpdates,
  parseTelegramReply,
} from "./telegramNotify";

// ── Auth middleware ────────────────────────────────────────────────────────────

function requireOpenClawAuth(req: Request, res: Response): boolean {
  const authHeader = req.headers["authorization"] ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const expected = ENV.openClawSessionKey;

  if (!expected) {
    res.status(503).json({ error: "OpenClaw polling is not configured on this server." });
    return false;
  }
  if (token !== expected) {
    res.status(401).json({ error: "Invalid session key." });
    return false;
  }
  return true;
}

// ── GET /api/openclaw/tasks/pending ───────────────────────────────────────────

async function getPendingTasks(req: Request, res: Response) {
  if (!requireOpenClawAuth(req, res)) return;

  try {
    const db = await getDb();
    if (!db) { res.status(503).json({ error: "Database not available." }); return; }

    const tasks: OpenclawTask[] = await db
      .select()
      .from(openclawTasks)
      .where(eq(openclawTasks.status, "pending"))
      .limit(10);

    // Mark fetched tasks as "processing" so they won't be double-polled
    if (tasks.length > 0) {
      const ids = tasks.map((t: OpenclawTask) => t.id);
      for (const id of ids) {
        await db
          .update(openclawTasks)
          .set({ status: "processing", pickedUpAt: new Date() })
          .where(and(eq(openclawTasks.id, id), eq(openclawTasks.status, "pending")));
      }
    }

    const payload = tasks.map((t: OpenclawTask) => ({
      task_id:    t.id,
      message:    t.message,
      file_urls:  (t.fileUrls as string[]) ?? [],
      file_names: (t.fileNames as string[]) ?? [],
      user_id:    t.externalUserId ?? String(t.userId),
      created_at: t.createdAt.toISOString(),
    }));

    console.log(`[OpenClaw] Polling: returned ${payload.length} pending task(s)`);
    res.json({ tasks: payload });
  } catch (err) {
    console.error("[OpenClaw] getPendingTasks error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

// ── POST /api/openclaw/tasks/result ───────────────────────────────────────────

interface OutputFileInput {
  name: string;
  content_base64?: string;
  url?: string;
  mime_type: string;
}

async function submitTaskResult(req: Request, res: Response) {
  if (!requireOpenClawAuth(req, res)) return;

  const { task_id, reply, output_files } = req.body as {
    task_id: string;
    reply: string;
    output_files?: OutputFileInput[];
  };

  if (!task_id || typeof reply !== "string") {
    res.status(400).json({ error: "task_id and reply are required." });
    return;
  }

  try {
    const db = await getDb();
    if (!db) { res.status(503).json({ error: "Database not available." }); return; }

    const [task] = await db
      .select()
      .from(openclawTasks)
      .where(eq(openclawTasks.id, task_id))
      .limit(1);

    if (!task) {
      res.status(404).json({ error: "Task not found." });
      return;
    }

    await saveTaskResult(task_id, reply, output_files);

    const savedFiles = await getTaskOutputFiles(task_id);
    res.json({
      success: true,
      task_id,
      files_saved: savedFiles.length,
      download_urls: savedFiles.map((f) => ({ name: f.name, url: f.fileUrl })),
    });
  } catch (err) {
    console.error("[OpenClaw] submitTaskResult error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

// ── Shared helpers ─────────────────────────────────────────────────────────────

async function getTaskOutputFiles(task_id: string) {
  const db = await getDb();
  if (!db) return [];
  const [task] = await db.select().from(openclawTasks).where(eq(openclawTasks.id, task_id)).limit(1);
  return (task?.outputFiles as Array<{ name: string; fileKey: string; fileUrl: string; mimeType: string }>) ?? [];
}

async function saveTaskResult(
  task_id: string,
  reply: string,
  output_files?: OutputFileInput[]
) {
  const db = await getDb();
  if (!db) return;

  const savedFiles: Array<{ name: string; fileKey: string; fileUrl: string; mimeType: string }> = [];

  if (Array.isArray(output_files) && output_files.length > 0) {
    for (const f of output_files) {
      if (!f.name) continue;
      try {
        // Support both base64 content and direct URL
        if (f.content_base64) {
          const buffer = Buffer.from(f.content_base64, "base64");
          const ext = f.name.split(".").pop() ?? "bin";
          const fileKey = `openclaw-results/${task_id}/${nanoid(8)}-${f.name}`;
          const { url } = await storagePut(fileKey, buffer, f.mime_type || `application/${ext}`);
          savedFiles.push({ name: f.name, fileKey, fileUrl: url, mimeType: f.mime_type });
        } else if (f.url) {
          // Direct URL from Telegram reply
          savedFiles.push({ name: f.name, fileKey: "", fileUrl: f.url, mimeType: f.mime_type });
        }
      } catch (uploadErr) {
        console.error(`[OpenClaw] Failed to upload output file "${f.name}":`, uploadErr);
      }
    }
  }

  await db
    .update(openclawTasks)
    .set({
      status:      "completed",
      reply,
      outputFiles: savedFiles.length > 0 ? savedFiles : null,
      completedAt: new Date(),
    })
    .where(eq(openclawTasks.id, task_id));

  console.log(`[OpenClaw] Task ${task_id} completed. Files saved: ${savedFiles.length}`);
}

// ── Telegram background poller ─────────────────────────────────────────────────

let telegramOffset = 0;

async function pollTelegramReplies() {
  if (!ENV.telegramBotToken || !ENV.telegramChatId) return;

  try {
    const { updates, nextOffset } = await pollTelegramUpdates(telegramOffset);
    telegramOffset = nextOffset;

    for (const update of updates) {
      const text = update.message?.text;
      if (!text) continue;

      const parsed = parseTelegramReply(text);
      if (!parsed) continue;

      console.log(`[Telegram] Received reply for task ${parsed.task_id}, status: ${parsed.status}`);

      const db = await getDb();
      if (!db) continue;

      // Check task exists
      const [task] = await db
        .select()
        .from(openclawTasks)
        .where(eq(openclawTasks.id, parsed.task_id))
        .limit(1);

      if (!task) {
        console.warn(`[Telegram] Task ${parsed.task_id} not found in DB`);
        continue;
      }

      const outputFiles = parsed.output_files?.map((f) => ({
        name: f.name,
        content_base64: undefined,
        url: f.url,
        mime_type: f.mime_type ?? "application/octet-stream",
      }));

      await saveTaskResult(parsed.task_id, parsed.reply, outputFiles);
    }
  } catch (err) {
    console.error("[Telegram] Poll error:", err);
  }
}

// ── Public helpers ─────────────────────────────────────────────────────────────

/**
 * Called when a new OpenClaw task is created — sends it to Telegram
 */
export async function notifyTelegramNewTask(task: {
  id: string;
  message: string;
  fileUrls: string[];
  fileNames: string[];
  userId: number | null;
  externalUserId: string | null;
}) {
  if (!ENV.telegramBotToken || !ENV.telegramChatId) return;

  await sendTaskToTelegram({
    task_id: task.id,
    message: task.message,
    file_urls: (task.fileUrls as string[]) ?? [],
    file_names: (task.fileNames as string[]) ?? [],
    user_id: task.externalUserId ?? String(task.userId ?? "unknown"),
  });
}

// ─// ── GET /api/atlas/task/:taskId/status ────────────────────────────────
// Frontend polls this to check if Telegram task has been completed

async function getTaskStatus(req: Request, res: Response) {
  const { taskId } = req.params;
  if (!taskId) { res.status(400).json({ error: "taskId required" }); return; }

  try {
    const db = await getDb();
    if (!db) { res.status(503).json({ error: "Database not available" }); return; }

    const [task] = await db
      .select()
      .from(openclawTasks)
      .where(eq(openclawTasks.id, taskId))
      .limit(1);

    if (!task) { res.status(404).json({ error: "Task not found" }); return; }

    res.json({
      task_id: task.id,
      status: task.status,
      reply: task.reply ?? null,
      output_files: (task.outputFiles as Array<{ name: string; fileKey: string; fileUrl: string; mimeType: string }>) ?? [],
      created_at: task.createdAt.toISOString(),
      completed_at: task.completedAt?.toISOString() ?? null,
    });
  } catch (err) {
    console.error("[Atlas] getTaskStatus error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

// -- Register routes --

export function registerOpenClawPollingRoutes(app: Express) {
  app.get("/api/openclaw/tasks/pending", getPendingTasks);
  app.post("/api/openclaw/tasks/result", submitTaskResult);
  app.get("/api/atlas/task/:taskId/status", getTaskStatus);
  console.log("[OpenClaw] Polling routes registered: GET /api/openclaw/tasks/pending, POST /api/openclaw/tasks/result, GET /api/atlas/task/:taskId/status");

  // Start Telegram background poller (every 30 seconds)
  if (ENV.telegramBotToken && ENV.telegramChatId) {
    setInterval(pollTelegramReplies, 30_000);
    console.log("[Telegram] Background poller started (30s interval)");
  }
}
