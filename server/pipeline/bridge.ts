/**
 * ATLAS V3.0 — Pipeline Bridge
 * ─────────────────────────────────────────────────────────────────
 * B 阶段交付物 B7：将新 Pipeline 接入现有 atlas.ts 上传流程
 *
 * 策略：双轨运行
 *   - 旧逻辑继续工作，保证现有功能不受影响
 *   - 新 Pipeline 在后台并行运行，生成 ResultSet 并持久化
 *   - ResultSet 存储到数据库 + S3（标准化数据行）
 *   - 后续逐步切换前端读取 ResultSet 替代旧数据
 *
 * 本文件提供：
 *   1. runPipelineInBackground() — 在 upload 端点中调用
 *   2. saveResultSet() — 将 ResultSet 持久化到 DB + S3
 *   3. getResultSetForSession() — 根据 sessionId 获取 ResultSet
 */

import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { runPipeline, runPipelineFromParsedData, type PipelineInput, type ParsedDataPipelineInput, type PipelineOutput } from "./index";
import { storagePut, storageGet } from "../storage";
import { getDb } from "../db";
import { resultSets, sessions } from "../../drizzle/schema";
import type { ResultSet } from "@shared/resultSet";

// ── 后台运行 Pipeline ──────────────────────────────────────────────

/**
 * 在上传流程的后台运行新 Pipeline。
 * 不阻塞现有上传逻辑，失败也不影响旧流程。
 */
export async function runPipelineInBackground(
  sessionId: string,
  userId: number,
  fileBuffer: Buffer,
  originalName: string,
  mimeType: string,
  templateId?: string
): Promise<void> {
  try {
    console.log(`[Pipeline] Starting background pipeline for session ${sessionId}`);

    const input: PipelineInput = {
      files: [{
        buffer: fileBuffer,
        originalName,
        mimeType,
      }],
      templateId,
      userId: String(userId),
    };

    const output = await runPipeline(input);

    if (output.success && output.resultSet) {
      // 持久化 ResultSet
      await saveResultSet(output.resultSet, sessionId, userId);
      console.log(`[Pipeline] ResultSet saved for session ${sessionId}, jobId: ${output.resultSet.jobId}`);
    } else {
      console.warn(`[Pipeline] Pipeline failed for session ${sessionId}: ${output.errorSummary}`);
      // 记录错误但不中断旧流程
      const errorCount = output.context.errors.filter(
        e => e.level === "fatal" || e.level === "critical"
      ).length;
      console.warn(`[Pipeline] ${errorCount} critical errors in pipeline`);
    }
  } catch (err: any) {
    // Pipeline 失败不影响旧流程
    console.error(`[Pipeline] Background pipeline error for session ${sessionId}:`, err?.message);
  }
}

/**
 * V3.0: 从前端已解析的 JSON 数据在后台运行 Pipeline。
 * 用于 upload-parsed 端点（前端用 SheetJS 解析后发送 JSON）。
 */
export async function runParsedPipelineInBackground(
  sessionId: string,
  userId: number,
  rows: Record<string, unknown>[],
  fileName: string,
  templateId?: string
): Promise<void> {
  try {
    console.log(`[Pipeline] Starting parsed-data pipeline for session ${sessionId}, rows=${rows.length}`);

    const input: ParsedDataPipelineInput = {
      rows,
      fileName,
      userId: String(userId),
      templateId,
    };

    const output = await runPipelineFromParsedData(input);

    if (output.success && output.resultSet) {
      await saveResultSet(output.resultSet, sessionId, userId);
      console.log(`[Pipeline] ResultSet saved for parsed session ${sessionId}, jobId: ${output.resultSet.jobId}, rows: ${output.resultSet.rowCount}`);
    } else {
      console.warn(`[Pipeline] Parsed pipeline failed for session ${sessionId}: ${output.errorSummary}`);
      const errorCount = output.context.errors.filter(
        e => e.level === "fatal" || e.level === "critical"
      ).length;
      console.warn(`[Pipeline] ${errorCount} critical errors in parsed pipeline`);
    }
  } catch (err: any) {
    console.error(`[Pipeline] Parsed pipeline error for session ${sessionId}:`, err?.message);
  }
}

// ── ResultSet 持久化 ──────────────────────────────────────────────

/**
 * 将 ResultSet 持久化到数据库和 S3。
 * - 核心元数据存 DB（result_sets 表）
 * - 标准化数据行存 S3（避免 DB 存大量行数据）
 */
export async function saveResultSet(
  rs: ResultSet,
  sessionId: string,
  userId: number
): Promise<string> {
  const db = await getDb();
  if (!db) {
    console.warn("[Pipeline] Cannot save ResultSet: database not available");
    return rs.jobId;
  }

  // 1. 将标准化数据行存到 S3
  let dataS3Key: string | null = null;
  if (rs.standardizedRows.length > 0) {
    const s3Key = `atlas-resultsets/${rs.jobId}/data.json`;
    try {
      const dataJson = JSON.stringify(rs.standardizedRows);
      await storagePut(s3Key, Buffer.from(dataJson), "application/json");
      dataS3Key = s3Key;
    } catch (err: any) {
      console.warn(`[Pipeline] Failed to save data rows to S3: ${err?.message}`);
    }
  }

  // 2. 将元数据存到 DB
  try {
    await db.insert(resultSets).values({
      id: rs.jobId,
      userId,
      sessionId,
      templateId: rs.templateId || null,
      computationVersion: rs.computationVersion,
      sourceFiles: rs.sourceFiles as any,
      filtersApplied: rs.filtersApplied as any,
      skippedRowsCount: rs.skippedRowsCount,
      skippedRowsSample: rs.skippedRowsSample as any,
      metrics: rs.metrics as any,
      rowCount: rs.rowCount,
      fields: rs.fields as any,
      dataS3Key,
      sourcePlatform: rs.sourcePlatform,
      isMultiFile: rs.isMultiFile ? 1 : 0,
      cleaningLog: rs.cleaningLog as any,
      generatedAt: rs.createdAt,
    });

    // 3. 更新 session 关联 resultSetId
    await db.update(sessions)
      .set({ resultSetId: rs.jobId })
      .where(eq(sessions.id, sessionId))
      .catch(() => {}); // 非致命

  } catch (err: any) {
    console.error(`[Pipeline] Failed to save ResultSet to DB: ${err?.message}`);
  }

  return rs.jobId;
}

// ── ResultSet 读取 ──────────────────────────────────────────────

/**
 * 根据 sessionId 获取关联的 ResultSet。
 */
export async function getResultSetForSession(
  sessionId: string
): Promise<ResultSet | null> {
  const db = await getDb();
  if (!db) return null;

  try {
    const rows = await db.select()
      .from(resultSets)
      .where(eq(resultSets.sessionId, sessionId))
      .limit(1);

    if (rows.length === 0) return null;

    const record = rows[0];

    // 从 S3 加载标准化数据行
    let standardizedRows: Record<string, string | number | null>[] = [];
    if (record.dataS3Key) {
      try {
        const { url } = await storageGet(record.dataS3Key);
        const response = await fetch(url);
        if (response.ok) {
          standardizedRows = await response.json();
        }
      } catch {
        console.warn(`[Pipeline] Failed to load data rows from S3 for ${sessionId}`);
      }
    }

    // 重建 ResultSet 对象
    const rs: ResultSet = {
      jobId: record.id,
      sourceFiles: record.sourceFiles as any || [],
      filtersApplied: record.filtersApplied as any || {},
      skippedRowsCount: record.skippedRowsCount,
      skippedRowsSample: record.skippedRowsSample as any || [],
      metrics: record.metrics as any || [],
      computationVersion: record.computationVersion,
      templateId: record.templateId || null,
      createdAt: record.generatedAt,
      rowCount: record.rowCount,
      fields: record.fields as any || [],
      standardizedRows,
      sourcePlatform: record.sourcePlatform || "unknown",
      isMultiFile: record.isMultiFile === 1,
      cleaningLog: record.cleaningLog as any || [],
    };

    return rs;
  } catch (err: any) {
    console.error(`[Pipeline] Failed to get ResultSet for session ${sessionId}: ${err?.message}`);
    return null;
  }
}

/**
 * 根据 ResultSet ID 直接获取。
 */
export async function getResultSetById(
  resultSetId: string
): Promise<ResultSet | null> {
  const db = await getDb();
  if (!db) return null;

  try {
    const rows = await db.select()
      .from(resultSets)
      .where(eq(resultSets.id, resultSetId))
      .limit(1);

    if (rows.length === 0) return null;

    const record = rows[0];

    let standardizedRows: Record<string, string | number | null>[] = [];
    if (record.dataS3Key) {
      try {
        const { url } = await storageGet(record.dataS3Key);
        const response = await fetch(url);
        if (response.ok) {
          standardizedRows = await response.json();
        }
      } catch {
        console.warn(`[Pipeline] Failed to load data rows from S3 for ${resultSetId}`);
      }
    }

    const rs: ResultSet = {
      jobId: record.id,
      sourceFiles: record.sourceFiles as any || [],
      filtersApplied: record.filtersApplied as any || {},
      skippedRowsCount: record.skippedRowsCount,
      skippedRowsSample: record.skippedRowsSample as any || [],
      metrics: record.metrics as any || [],
      computationVersion: record.computationVersion,
      templateId: record.templateId || null,
      createdAt: record.generatedAt,
      rowCount: record.rowCount,
      fields: record.fields as any || [],
      standardizedRows,
      sourcePlatform: record.sourcePlatform || "unknown",
      isMultiFile: record.isMultiFile === 1,
      cleaningLog: record.cleaningLog as any || [],
    };

    return rs;
  } catch (err: any) {
    console.error(`[Pipeline] Failed to get ResultSet by ID ${resultSetId}: ${err?.message}`);
    return null;
  }
}
