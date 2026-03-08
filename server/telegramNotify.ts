/**
 * Telegram 双向通信服务
 * ATLAS 任务推送到 Telegram，轮询读取用户回复并解析结果
 */

import { ENV } from "./_core/env";

const TELEGRAM_API = "https://api.telegram.org";

export interface TelegramTaskReply {
  task_id: string;
  status: "done" | "error";
  reply: string;
  output_files?: Array<{
    name: string;
    url: string;
    mime_type?: string;
  }>;
}

/**
 * 发送任务通知到 Telegram
 */
export async function sendTaskToTelegram(params: {
  task_id: string;
  message: string;
  file_urls: string[];
  file_names: string[];
  user_id: string;
}): Promise<boolean> {
  const token = ENV.telegramBotToken;
  const chatId = ENV.telegramChatId;

  if (!token || !chatId) {
    console.warn("[Telegram] Bot token or chat ID not configured");
    return false;
  }

  const fileList =
    params.file_names.length > 0
      ? `\n📎 文件：${params.file_names.join("、")}`
      : "";

  const text =
    `🔔 【ATLAS 新任务】\n\n` +
    `任务ID：${params.task_id}\n` +
    `用户：${params.user_id}\n` +
    `需求：${params.message}${fileList}\n\n` +
    `📥 文件下载：\n${params.file_urls.map((u, i) => `${i + 1}. ${u}`).join("\n") || "无附件"}\n\n` +
    `─────────────────\n` +
    `处理完后请回复 JSON 格式：\n` +
    `{\n  "task_id": "${params.task_id}",\n  "status": "done",\n  "reply": "处理结果说明"\n}\n\n` +
    `或简化格式：\n` +
    `DONE ${params.task_id}\n结果说明\n文件：https://...`;

  try {
    const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
      }),
    });
    const data = (await res.json()) as { ok: boolean };
    if (data.ok) {
      console.log(`[Telegram] Task ${params.task_id} sent successfully`);
      return true;
    }
    console.error("[Telegram] Send failed:", data);
    return false;
  } catch (err) {
    console.error("[Telegram] Send error:", err);
    return false;
  }
}

/**
 * 轮询 Telegram getUpdates，返回新消息（offset 之后的）
 */
export async function pollTelegramUpdates(offset?: number): Promise<{
  updates: Array<{ update_id: number; message?: { message_id: number; text?: string; date: number } }>;
  nextOffset: number;
}> {
  const token = ENV.telegramBotToken;
  if (!token) return { updates: [], nextOffset: offset ?? 0 };

  try {
    const params = new URLSearchParams({ timeout: "0", limit: "100" });
    if (offset !== undefined) params.set("offset", String(offset));

    const res = await fetch(`${TELEGRAM_API}/bot${token}/getUpdates?${params}`);
    const data = (await res.json()) as {
      ok: boolean;
      result: Array<{ update_id: number; message?: { message_id: number; text?: string; date: number } }>;
    };

    if (!data.ok || !data.result.length) {
      return { updates: [], nextOffset: offset ?? 0 };
    }

    const nextOffset = data.result[data.result.length - 1].update_id + 1;
    return { updates: data.result, nextOffset };
  } catch (err) {
    console.error("[Telegram] Poll error:", err);
    return { updates: [], nextOffset: offset ?? 0 };
  }
}

/**
 * 解析用户回复，支持 JSON 格式和简化格式
 * JSON: {"task_id":"xxx","status":"done","reply":"...","output_files":[...]}
 * 简化: DONE task_xxx\n结果说明\n文件：https://...
 */
export function parseTelegramReply(text: string): TelegramTaskReply | null {
  if (!text) return null;

  // 尝试 JSON 解析
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as Partial<TelegramTaskReply>;
      if (parsed.task_id && parsed.reply) {
        return {
          task_id: parsed.task_id,
          status: parsed.status === "error" ? "error" : "done",
          reply: parsed.reply,
          output_files: parsed.output_files,
        };
      }
    } catch {
      // 继续尝试简化格式
    }
  }

  // 简化格式：DONE task_xxx\n结果说明\n文件：https://...
  const doneMatch = text.match(/^DONE\s+(\S+)\s*\n([\s\S]*)/i);
  if (doneMatch) {
    const task_id = doneMatch[1];
    const rest = doneMatch[2].trim();
    const lines = rest.split("\n");
    const fileLines = lines.filter((l) => l.startsWith("文件：") || l.startsWith("File:"));
    const replyLines = lines.filter((l) => !l.startsWith("文件：") && !l.startsWith("File:"));

    const output_files = fileLines.map((l) => {
      const url = l.replace(/^(文件：|File:)\s*/i, "").trim();
      const name = url.split("/").pop() ?? "output.xlsx";
      return { name, url, mime_type: "application/octet-stream" };
    });

    return {
      task_id,
      status: "done",
      reply: replyLines.join("\n").trim(),
      output_files: output_files.length > 0 ? output_files : undefined,
    };
  }

  return null;
}
