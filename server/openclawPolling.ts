/**
 * OpenClaw Polling API
 *
 * Provides two REST endpoints for the OpenClaw agent to poll tasks:
 *   GET  /api/openclaw/tasks/pending  — fetch pending tasks
 *   POST /api/openclaw/tasks/result   — submit task result
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
  content_base64: string;
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

    // Verify task exists and is in processing state
    const [task] = await db
      .select()
      .from(openclawTasks)
      .where(eq(openclawTasks.id, task_id))
      .limit(1);

    if (!task) {
      res.status(404).json({ error: "Task not found." });
      return;
    }

    // Upload output files to S3
    const savedFiles: Array<{ name: string; fileKey: string; fileUrl: string; mimeType: string }> = [];

    if (Array.isArray(output_files) && output_files.length > 0) {
      for (const f of output_files) {
        if (!f.content_base64 || !f.name) continue;
        try {
          const buffer = Buffer.from(f.content_base64, "base64");
          const ext = f.name.split(".").pop() ?? "bin";
          const fileKey = `openclaw-results/${task_id}/${nanoid(8)}-${f.name}`;
          const { url } = await storagePut(fileKey, buffer, f.mime_type || `application/${ext}`);
          savedFiles.push({ name: f.name, fileKey, fileUrl: url, mimeType: f.mime_type });
        } catch (uploadErr) {
          console.error(`[OpenClaw] Failed to upload output file "${f.name}":`, uploadErr);
        }
      }
    }

    // Update task record
    await db!
      .update(openclawTasks)
      .set({
        status:      "completed",
        reply,
        outputFiles: savedFiles.length > 0 ? savedFiles : null,
        completedAt: new Date(),
      })
      .where(eq(openclawTasks.id, task_id));

    console.log(
      `[OpenClaw] Task ${task_id} completed. Files saved: ${savedFiles.length}`
    );

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

// ── Register routes ────────────────────────────────────────────────────────────

export function registerOpenClawPollingRoutes(app: Express) {
  app.get("/api/openclaw/tasks/pending", getPendingTasks);
  app.post("/api/openclaw/tasks/result", submitTaskResult);
  console.log("[OpenClaw] Polling routes registered: GET /api/openclaw/tasks/pending, POST /api/openclaw/tasks/result");
}
