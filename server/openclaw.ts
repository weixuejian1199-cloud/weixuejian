/**
 * OpenClaw Integration — 小虾米 Agent
 *
 * Dual-channel design:
 *   - If OPENCLAW_API_KEY is configured → route through OpenClaw (小虾米)
 *   - Otherwise → fall back to Qwen3-Max (阿里百炼)
 *
 * File transfer: S3 presigned URL (read-only, 10 min expiry)
 * Output: OpenClaw returns base64 files → ATLAS stores to S3
 */

import { ENV } from "./_core/env";
import { storagePut, storageGet } from "./storage";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OpenClawRequest {
  message: string;
  /** S3 presigned URLs for uploaded files */
  file_urls?: string[];
  /** Original file names (for format detection) */
  file_names?: string[];
  /** User identifier */
  user_id?: string;
  /** Source tag */
  source?: string;
}

export interface OpenClawOutputFile {
  name: string;
  content_base64: string;
  mime_type: string;
}

export interface OpenClawResponse {
  success: boolean;
  reply: string;
  output_files?: OpenClawOutputFile[];
  error?: string;
}

export interface OpenClawResult {
  reply: string;
  /** S3 URLs of saved output files */
  savedFiles: Array<{ name: string; url: string; key: string; mimeType: string }>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Check whether OpenClaw is configured.
 * Returns true if OPENCLAW_API_KEY is set and non-empty.
 */
export function isOpenClawEnabled(): boolean {
  return Boolean(ENV.openClawApiKey && ENV.openClawApiKey.trim().length > 0);
}

/**
 * Generate S3 presigned read URLs for a list of session data keys.
 * These are passed to OpenClaw so it can download the files.
 */
export async function getPresignedUrlsForSessions(
  sessionDataKeys: string[]
): Promise<string[]> {
  const urls: string[] = [];
  for (const key of sessionDataKeys) {
    try {
      const { url } = await storageGet(key);
      urls.push(url);
    } catch (err) {
      console.warn(`[OpenClaw] Failed to get presigned URL for key ${key}:`, err);
    }
  }
  return urls;
}

/**
 * Save base64-encoded output files from OpenClaw to S3.
 * Returns array of saved file metadata.
 */
export async function saveOpenClawOutputFiles(
  outputFiles: OpenClawOutputFile[],
  userId: string
): Promise<Array<{ name: string; url: string; key: string; mimeType: string }>> {
  const saved: Array<{ name: string; url: string; key: string; mimeType: string }> = [];

  for (const file of outputFiles) {
    try {
      const buffer = Buffer.from(file.content_base64, "base64");
      const safeName = file.name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5._-]/g, "_");
      const timestamp = Date.now();
      const key = `openclaw-outputs/${userId}/${timestamp}-${safeName}`;

      const { url } = await storagePut(key, buffer, file.mime_type);
      saved.push({ name: file.name, url, key, mimeType: file.mime_type });
      console.log(`[OpenClaw] Saved output file: ${file.name} → ${key}`);
    } catch (err) {
      console.error(`[OpenClaw] Failed to save output file ${file.name}:`, err);
    }
  }

  return saved;
}

// ── Main API Call ─────────────────────────────────────────────────────────────

/**
 * Call OpenClaw API (小虾米 Agent).
 * Sends message + file presigned URLs, receives reply + optional base64 output files.
 * Output files are automatically saved to S3.
 */
export async function callOpenClaw(
  request: OpenClawRequest,
  userId = "anonymous"
): Promise<OpenClawResult> {
  const endpoint = ENV.openClawEndpoint;
  const apiKey = ENV.openClawApiKey;

  if (!apiKey) {
    throw new Error("[OpenClaw] API key not configured");
  }

  const payload = {
    message: request.message,
    ...(request.file_urls?.length ? { file_urls: request.file_urls } : {}),
    ...(request.file_names?.length ? { file_names: request.file_names } : {}),
    user_id: userId,
    source: request.source ?? "atlas",
  };

  console.log(`[OpenClaw] Calling ${endpoint} with message: "${request.message.slice(0, 80)}..."`);
  if (request.file_urls?.length) {
    console.log(`[OpenClaw] Attaching ${request.file_urls.length} file(s)`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300_000); // 300s timeout

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`[OpenClaw] API error ${response.status}: ${errorText}`);
  }

  const data = (await response.json()) as OpenClawResponse;

  if (!data.success) {
    throw new Error(`[OpenClaw] Request failed: ${data.error ?? "Unknown error"}`);
  }

  // Save any output files to S3
  const savedFiles = data.output_files?.length
    ? await saveOpenClawOutputFiles(data.output_files, userId)
    : [];

  console.log(`[OpenClaw] Reply received (${data.reply.length} chars), ${savedFiles.length} output file(s) saved`);

  return {
    reply: data.reply,
    savedFiles,
  };
}

// ── SSE Streaming API Call ────────────────────────────────────────────────────

/**
 * Call OpenClaw API with SSE streaming support.
 * Pipes the SSE stream directly to the Express response.
 * Output files (if any) are returned in the final SSE event as JSON.
 *
 * SSE format expected from OpenClaw Gateway:
 *   data: {"type":"text","content":"chunk text"}
 *   data: {"type":"done","output_files":[...]}   ← optional, final event
 *   data: [DONE]
 */
export async function callOpenClawStream(
  request: OpenClawRequest,
  res: import("express").Response,
  userId = "anonymous"
): Promise<void> {
  const endpoint = ENV.openClawEndpoint;
  const apiKey = ENV.openClawApiKey;

  if (!apiKey) {
    throw new Error("[OpenClaw] API key not configured");
  }

  const payload = {
    message: request.message,
    ...(request.file_urls?.length ? { file_urls: request.file_urls } : {}),
    ...(request.file_names?.length ? { file_names: request.file_names } : {}),
    user_id: userId,
    source: request.source ?? "atlas",
    stream: true,
  };

  console.log(`[OpenClaw SSE] Calling ${endpoint} with message: "${request.message.slice(0, 80)}..."`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300_000); // 300s timeout

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err: any) {
    clearTimeout(timeout);
    throw new Error(`[OpenClaw SSE] Connection failed: ${err.message}`);
  }

  if (!upstreamRes.ok) {
    clearTimeout(timeout);
    const errorText = await upstreamRes.text().catch(() => upstreamRes.statusText);
    throw new Error(`[OpenClaw SSE] API error ${upstreamRes.status}: ${errorText}`);
  }

  // Set SSE headers on Express response (same as Vercel AI SDK pipeTextStreamToResponse)
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("X-Vercel-AI-Data-Stream", "v1");
  res.setHeader("Transfer-Encoding", "chunked");

  const reader = upstreamRes.body?.getReader();
  if (!reader) {
    clearTimeout(timeout);
    throw new Error("[OpenClaw SSE] No response body");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data:")) continue;

        const rawData = trimmed.slice(5).trim();
        if (rawData === "[DONE]") {
          // Stream finished
          res.end();
          return;
        }

        try {
          const event = JSON.parse(rawData) as {
            type: "text" | "done" | "error";
            content?: string;
            output_files?: OpenClawOutputFile[];
            error?: string;
          };

          if (event.type === "text" && event.content) {
            // Write in Vercel AI SDK text stream format: 0:"chunk"\n
            res.write(`0:${JSON.stringify(event.content)}\n`);
          } else if (event.type === "done") {
            // Handle output files if any
            if (event.output_files?.length) {
              try {
                const savedFiles = await saveOpenClawOutputFiles(event.output_files, userId);
                if (savedFiles.length > 0) {
                  const fileLinks = savedFiles.map(f => `- [${f.name}](${f.url})`).join("\n");
                  const fileMsg = `\n\n📄 **输出文件**\n${fileLinks}`;
                  res.write(`0:${JSON.stringify(fileMsg)}\n`);
                }
              } catch (fileErr) {
                console.error("[OpenClaw SSE] Failed to save output files:", fileErr);
              }
            }
            res.end();
            return;
          } else if (event.type === "error") {
            const errMsg = event.error ?? "OpenClaw 处理失败";
            res.write(`0:${JSON.stringify(`\n\n❌ ${errMsg}`)}\n`);
            res.end();
            return;
          }
        } catch {
          // Non-JSON line — might be plain text chunk, write as-is
          if (rawData && rawData !== "[DONE]") {
            res.write(`0:${JSON.stringify(rawData)}\n`);
          }
        }
      }
    }
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }

  // Ensure response is ended
  if (!res.writableEnded) {
    res.end();
  }
}
