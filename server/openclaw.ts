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
