/**
 * ATLAS Scheduler — Cron-based Report Execution Engine
 * ──────────────────────────────────────────────────────
 * - Loads active scheduled tasks from DB every minute
 * - Executes due tasks: generates Excel report → uploads to S3 → saves to DB
 * - Sends email notification with download link (if SMTP configured)
 * - Updates task status: lastRunAt, nextRunAt, runCount
 */

import cron from "node-cron";
import nodemailer from "nodemailer";
import * as XLSX from "xlsx";
import { nanoid } from "nanoid";
import { streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { ENV } from "./_core/env";
import { createPatchedFetch } from "./_core/patchedFetch";
import { storagePut, storageGet } from "./storage";
import { getDb } from "./db";
import { scheduledTasks, reports, sessions } from "../drizzle/schema";
import { eq, and, lte, isNull, or, ne } from "drizzle-orm";

// ── LLM ──────────────────────────────────────────────────────────────────────

function createLLM() {
  const baseURL = ENV.forgeApiUrl.endsWith("/v1")
    ? ENV.forgeApiUrl
    : `${ENV.forgeApiUrl}/v1`;
  return createOpenAI({
    baseURL,
    apiKey: ENV.forgeApiKey,
    fetch: createPatchedFetch(fetch),
  });
}

// ── Email ─────────────────────────────────────────────────────────────────────

async function sendReportEmail(opts: {
  to: string;
  taskName: string;
  reportTitle: string;
  downloadUrl: string;
  insights: string;
}): Promise<boolean> {
  if (!ENV.smtpHost || !ENV.smtpUser || !ENV.smtpPass) {
    console.log("[Scheduler] SMTP not configured, skipping email for:", opts.to);
    return false;
  }

  const transporter = nodemailer.createTransport({
    host: ENV.smtpHost,
    port: ENV.smtpPort,
    secure: ENV.smtpPort === 465,
    auth: { user: ENV.smtpUser, pass: ENV.smtpPass },
  });

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; padding: 20px;">
  <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
    <div style="background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%); padding: 32px; text-align: center;">
      <h1 style="color: white; margin: 0; font-size: 24px;">📊 ATLAS 报表已生成</h1>
      <p style="color: rgba(255,255,255,0.8); margin: 8px 0 0;">定时任务：${opts.taskName}</p>
    </div>
    <div style="padding: 32px;">
      <h2 style="color: #1e3a5f; margin-top: 0;">${opts.reportTitle}</h2>
      <div style="background: #f8fafc; border-left: 4px solid #2563eb; padding: 16px; border-radius: 0 8px 8px 0; margin: 16px 0;">
        <p style="margin: 0; color: #475569; line-height: 1.6;">${opts.insights.replace(/\n/g, "<br>")}</p>
      </div>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${opts.downloadUrl}"
           style="background: #2563eb; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px; display: inline-block;">
          📥 下载报表
        </a>
      </div>
      <p style="color: #94a3b8; font-size: 12px; text-align: center; margin: 0;">
        此报表由 ATLAS 自动生成，下载链接 24 小时内有效。
      </p>
    </div>
  </div>
</body>
</html>`;

  try {
    await transporter.sendMail({
      from: ENV.smtpFrom || ENV.smtpUser,
      to: opts.to,
      subject: `📊 ${opts.reportTitle} — ATLAS 定时报表`,
      html,
    });
    console.log(`[Scheduler] Email sent to ${opts.to} for task: ${opts.taskName}`);
    return true;
  } catch (err) {
    console.error("[Scheduler] Email send failed:", err);
    return false;
  }
}

// ── Report generation ─────────────────────────────────────────────────────────

async function generateReportForTask(opts: {
  sessionId: string;
  requirement: string;
  userId: number;
}): Promise<{ reportId: string; reportUrl: string; title: string; insights: string }> {
  const { sessionId, requirement, userId } = opts;
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Load session from DB
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
  if (!session) throw new Error(`Session not found: ${sessionId}`);

  const dfInfo = session.dfInfo as any;
  const filename = session.originalName;

  // Load data from S3
  const dataKey = `atlas-data/${sessionId}-data.json`;
  const { url: dataUrl } = await storageGet(dataKey);
  const dataRes = await fetch(dataUrl);
  if (!dataRes.ok) throw new Error("Session data expired. Please re-upload the file.");
  const data: Record<string, unknown>[] = await dataRes.json();

  // AI report generation
  const openai = createLLM();
  const fieldNames = (dfInfo?.fields || []).map((f: any) => f.name).join(", ");
  const sampleRows = JSON.stringify(data.slice(0, 20), null, 2);

  const aiPrompt = `你是数据分析专家。根据以下数据和需求，生成一份报表数据。

数据文件：${filename}（${dfInfo?.row_count || 0}行 × ${dfInfo?.col_count || 0}列）
字段：${fieldNames}

数据样例（前20行）：
${sampleRows}

用户需求：${requirement}

请返回一个 JSON 对象，格式如下：
{
  "title": "报表标题",
  "sheets": [
    {
      "name": "Sheet名称",
      "headers": ["列1", "列2", "列3"],
      "rows": [["值1", "值2", "值3"]],
      "summary": "本sheet的说明"
    }
  ],
  "insights": "关键发现和建议（2-3条）"
}

要求：最多3个Sheet，每个Sheet最多50行，只返回JSON，不要其他文字`;

  let reportData: any;
  try {
    const aiResult = await streamText({
      model: openai.chat("gemini-2.5-flash"),
      messages: [{ role: "user", content: aiPrompt }],
    });
    const rawText = await aiResult.text;
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("AI did not return valid JSON");
    reportData = JSON.parse(jsonMatch[0]);
  } catch (e) {
    const headers = (dfInfo?.fields || []).map((f: any) => f.name);
    reportData = {
      title: requirement.slice(0, 30),
      sheets: [{
        name: "数据汇总",
        headers,
        rows: data.slice(0, 30).map((row: any) => headers.map((h: string) => row[h] ?? "")),
        summary: "原始数据",
      }],
      insights: `已导出 ${Math.min(data.length, 30)} 行数据。`,
    };
  }

  // Generate Excel
  const workbook = XLSX.utils.book_new();
  for (const sheet of reportData.sheets) {
    const wsData = [sheet.headers, ...sheet.rows];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws["!cols"] = sheet.headers.map((h: string) => ({ wch: Math.max(h.length * 2, 12) }));
    XLSX.utils.book_append_sheet(workbook, ws, sheet.name.slice(0, 31));
  }
  const excelBuffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  // Upload to S3
  const reportId = nanoid();
  const safeTitle = (reportData.title || "report").replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, "_").slice(0, 40);
  const reportKey = `atlas-reports/${reportId}-${safeTitle}.xlsx`;
  const { url: reportUrl } = await storagePut(reportKey, excelBuffer, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

  // Save to DB
  await db.insert(reports).values({
    id: reportId,
    sessionId,
    userId,
    title: reportData.title || safeTitle,
    filename: `${safeTitle}.xlsx`,
    fileKey: reportKey,
    fileUrl: reportUrl,
    fileSizeKb: Math.ceil(excelBuffer.length / 1024),
    prompt: requirement,
    status: "completed",
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });

  return { reportId, reportUrl, title: reportData.title || safeTitle, insights: reportData.insights || "" };
}

// ── Calculate next run time from cron expression ──────────────────────────────

export function calculateNextCronRun(cronExpr: string): Date {
  const now = new Date();

  try {
    const parts = cronExpr.trim().split(/\s+/);
    if (parts.length !== 5) return new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const [minute, hour, dom, month, dow] = parts;

    // Daily: "0 9 * * *"
    if (minute !== "*" && hour !== "*" && dom === "*" && month === "*" && dow === "*") {
      const targetHour = parseInt(hour);
      const targetMinute = parseInt(minute);
      const next = new Date(now);
      next.setHours(targetHour, targetMinute, 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      return next;
    }

    // Weekly: "0 9 * * 1"
    if (minute !== "*" && hour !== "*" && dom === "*" && month === "*" && dow !== "*") {
      const targetDow = parseInt(dow);
      const targetHour = parseInt(hour);
      const targetMinute = parseInt(minute);
      const next = new Date(now);
      next.setHours(targetHour, targetMinute, 0, 0);
      const daysUntilTarget = (targetDow - next.getDay() + 7) % 7;
      next.setDate(next.getDate() + (daysUntilTarget === 0 && next <= now ? 7 : daysUntilTarget));
      return next;
    }

    // Hourly: "0 * * * *"
    if (minute !== "*" && hour === "*") {
      const targetMinute = parseInt(minute);
      const next = new Date(now);
      next.setMinutes(targetMinute, 0, 0);
      if (next <= now) next.setHours(next.getHours() + 1);
      return next;
    }

    // Default: next day at 9am
    const next = new Date(now);
    next.setDate(next.getDate() + 1);
    next.setHours(9, 0, 0, 0);
    return next;
  } catch {
    return new Date(now.getTime() + 24 * 60 * 60 * 1000);
  }
}

// ── Main scheduler loop ───────────────────────────────────────────────────────

let schedulerStarted = false;

export function startScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  console.log("[Scheduler] Starting ATLAS cron scheduler...");

  // Check every minute for due tasks
  cron.schedule("* * * * *", async () => {
    try {
      const db = await getDb();
      if (!db) return; // DB not available
      const now = new Date();

      // Find active tasks that are due (nextRunAt <= now OR nextRunAt is null)
      const dueTasks = await db
        .select()
        .from(scheduledTasks)
        .where(
          and(
            eq(scheduledTasks.status, "active"),
            or(
              isNull(scheduledTasks.nextRunAt),
              lte(scheduledTasks.nextRunAt, now)
            )
          )
        )
        .limit(10);

      if (dueTasks.length === 0) return;

      console.log(`[Scheduler] Processing ${dueTasks.length} due task(s)...`);

      for (const task of dueTasks) {
        try {
          console.log(`[Scheduler] Running task: ${task.name} (${task.id})`);

          if (!task.cronExpr || !cron.validate(task.cronExpr)) {
            console.warn(`[Scheduler] Invalid cron for task ${task.id}: ${task.cronExpr}`);
            continue;
          }

          // Prevent duplicate runs within same minute
          if (task.lastRunAt) {
            const timeSinceLastRun = now.getTime() - new Date(task.lastRunAt).getTime();
            if (timeSinceLastRun < 55 * 1000) continue;
          }

          // Lock task by setting nextRunAt far in future
          await db!
            .update(scheduledTasks)
            .set({ nextRunAt: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000) })
            .where(eq(scheduledTasks.id, task.id));

          const sessionId = task.lastSessionId;
          if (!sessionId) {
            console.warn(`[Scheduler] Task ${task.id} has no sessionId, skipping`);
            continue;
          }

          const { reportUrl, title, insights } = await generateReportForTask({
            sessionId,
            requirement: task.templatePrompt || "生成数据汇总报表",
            userId: task.userId,
          });

          const nextRun = calculateNextCronRun(task.cronExpr);

          await db!
            .update(scheduledTasks)
            .set({
              lastRunAt: now,
              nextRunAt: nextRun,
              runCount: (task.runCount || 0) + 1,
              status: "active",
              updatedAt: now,
            })
            .where(eq(scheduledTasks.id, task.id));

          console.log(`[Scheduler] Task ${task.id} completed. Report: ${reportUrl}`);

          // Send email if configured
          if (task.notifyEmail) {
            await sendReportEmail({
              to: task.notifyEmail,
              taskName: task.name,
              reportTitle: title,
              downloadUrl: reportUrl,
              insights,
            });
          }
        } catch (taskErr: any) {
          console.error(`[Scheduler] Task ${task.id} failed:`, taskErr);
          const nextRun = calculateNextCronRun(task.cronExpr || "0 9 * * *");
          const dbErr = await getDb();
          if (!dbErr) return;
          await dbErr
            .update(scheduledTasks)
            .set({
              lastRunAt: now,
              nextRunAt: nextRun,
              status: "error",
              updatedAt: now,
            })
            .where(eq(scheduledTasks.id, task.id));
        }
      }
    } catch (err) {
      console.error("[Scheduler] Scheduler loop error:", err);
    }
  });

  console.log("[Scheduler] Cron scheduler started. Checking every minute.");
}
