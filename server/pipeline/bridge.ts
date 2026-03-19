/**
 * ATLAS V3.0 — Pipeline Bridge
 * ─────────────────────────────────────────────────────────────────
 * B 阶段交付物 B7：将新 Pipeline 接入现有 atlas.ts 上传流程
 *
 * 策略：双轨运行
 *   - 旧逻辑继续工作，保证现有功能不受影响
 *   - 新 Pipeline 在后台并行运行，生成 ResultSet 并持久化
 *   - Pipeline 状态追踪：null → running → success / failed
 *
 * 硬约束（V2.4）：
 *   1. upload 只写 running，bridge 负责全部终态 success/failed
 *   2. 不允许函数开头因 getDb() 失败就直接 return，让 Pipeline 先执行
 *   3. 在写 success/failed 终态前，必须重新获取 DB（不复用函数启动时的连接）
 */

import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { runPipeline, type PipelineInput } from "./index";
import { runGovernance } from "./governance";
import { step8Compute, type ComputationInput } from "./computation";
import { buildExpressionPrompt } from "./expression";
import { createPipelineContext } from "@shared/pipeline";
import type { SourceFileInfo } from "@shared/resultSet";
import { storagePut, storageGet, storageReadFile } from "../storage";
import { getDb } from "../db";
import { resultSets, sessions } from "../../drizzle/schema";
import type { ResultSet } from "@shared/resultSet";

// ── 后台运行 Pipeline ──────────────────────────────────────────────

/**
 * 在上传流程的后台运行新 Pipeline。
 * 不阻塞现有上传逻辑，失败也不影响旧流程。
 *
 * 调用方（atlas.ts upload 端点）负责在调用本函数前写入 pipelineStatus=running。
 * 本函数负责在完成后写入终态 success 或 failed。
 *
 * 硬约束：
 * - 不允许函数开头因 getDb() 失败就直接 return
 * - 在写终态前必须重新获取 DB（不复用函数启动时的连接）
 */
export async function runPipelineInBackground(
  sessionId: string,
  userId: number,
  fileBuffer: Buffer,
  originalName: string,
  mimeType: string,
  templateId?: string
): Promise<void> {
  // ⭐ 不要在函数开头因 getDb() 为空就 return，让 Pipeline 先执行
  // ⭐ pipelineStatus 状态写入职责单一：upload 只写 running，bridge 负责全部终态 success/failed
  console.log(`[Pipeline] 🚀 Starting background pipeline for session ${sessionId}`);
  console.log(`[Pipeline]   File: ${originalName}, Size: ${fileBuffer.length} bytes`);

  const input: PipelineInput = {
    files: [{
      buffer: fileBuffer,
      originalName,
      mimeType,
    }],
    templateId,
    userId: String(userId),
  };

  // 先尝试获取 DB（不可用时先让 Pipeline 执行，后面再处理）
  let db: Awaited<ReturnType<typeof getDb>> = null;
  try {
    db = await getDb();
  } catch {
    // DB 不可用，先让 Pipeline 执行，到持久化阶段再处理
  }

  try {
    const startTime = Date.now();
    const output = await runPipeline(input);
    const duration = Date.now() - startTime;
    console.log(`[Pipeline] ✅ Pipeline completed for session ${sessionId}`);
    console.log(`[Pipeline]   Duration: ${duration}ms`);
    console.log(`[Pipeline]   Success: ${output.success}`);

    if (output.success && output.resultSet) {
      console.log(`[Pipeline] 💾 Saving ResultSet for session ${sessionId}`);
      console.log(`[Pipeline]   RowCount: ${output.resultSet.rowCount}`);
      console.log(`[Pipeline]   Metrics: ${output.resultSet.metrics.length}`);

      // 持久化 ResultSet（saveResultSet 内部会更新 session.resultSetId）
      const jobId = await saveResultSet(output.resultSet, sessionId, userId);

      // ⭐ 硬约束：写终态前重新获取 DB（不复用函数启动时的连接）
      const dbForStatus = await getDb();
      if (dbForStatus) {
        await dbForStatus.update(sessions)
          .set({
            pipelineStatus: "success",
            pipelineError: null,
            pipelineFinishedAt: new Date(),
          })
          .where(eq(sessions.id, sessionId));
        console.log(`[Pipeline] ✅ Updated pipelineStatus to 'success' for session ${sessionId}`);
      } else {
        console.error(`[Pipeline] ❌ Cannot write success status for ${sessionId}: DB unavailable`);
      }
      console.log(`[Pipeline] ✅ ResultSet saved successfully, jobId: ${jobId}`);
    } else {
      const errorSummary = output.errorSummary || "Unknown error";
      console.error(`[Pipeline] ❌ Pipeline failed for session ${sessionId}: ${errorSummary}`);
      const errorCount = output.context?.errors?.filter(
        (e: any) => e.level === "fatal" || e.level === "critical"
      ).length ?? 0;
      console.error(`[Pipeline] ${errorCount} critical errors in pipeline`);
      for (const err of (output.context?.errors || [])) {
        console.error(`[Pipeline]   [${(err as any).level?.toUpperCase()}] ${(err as any).message} (step ${(err as any).step})`);
      }

      // ⭐ 硬约束：写终态前重新获取 DB（不复用函数启动时的连接）
      const dbForStatus = await getDb();
      if (dbForStatus) {
        await dbForStatus.update(sessions)
          .set({
            pipelineStatus: "failed",
            pipelineError: errorSummary,
            pipelineFinishedAt: new Date(),
          })
          .where(eq(sessions.id, sessionId));
        console.log(`[Pipeline] ❌ Updated pipelineStatus to 'failed' for session ${sessionId}`);
      } else {
        console.error(`[Pipeline] ❌ Cannot write failed status for ${sessionId}: DB unavailable`);
      }
    }
  } catch (err: any) {
    const errMsg = err?.message || "Unknown exception in pipeline";
    console.error(`[Pipeline] ❌ Background pipeline error for session ${sessionId}: ${errMsg}`);
    console.error(`[Pipeline] Stack: ${err?.stack}`);

    // ⭐ 硬约束：写终态前重新获取 DB（不复用函数启动时的连接）
    try {
      const dbForStatus = await getDb();
      if (dbForStatus) {
        await dbForStatus.update(sessions)
          .set({
            pipelineStatus: "failed",
            pipelineError: errMsg,
            pipelineFinishedAt: new Date(),
          })
          .where(eq(sessions.id, sessionId))
          .catch(() => {}); // 非致命
        console.log(`[Pipeline] ❌ Updated pipelineStatus to 'failed' for session ${sessionId}`);
      }
    } catch {
      // 忽略状态写入失败
    }
    // Pipeline 失败不影响旧流程，不抛出错误
  }
}

// ── 从已解析 JSON 数据运行 Pipeline ──────────────────────────────────────────────

/**
 * Solution B 核心函数：从前端已解析的 JSON 数据直接运行 Pipeline。
 * 跳过 Ingestion 层（不需要原始文件 buffer），从 Governance 层开始。
 *
 * 数据流：
 *   前端 parsed.preview（JSON rows）
 *   → fieldMapping（由 atlas.ts normalizeFieldNames 生成）
 *   → runGovernance（清洗 + 去重）
 *   → step8Compute（计算 ResultSet）
 *   → buildExpressionPrompt（构建 AI prompt）
 *   → saveResultSet（持久化到 S3 + DB）
 *
 * 硬约束：
 * - 调用方负责在调用前写入 pipelineStatus=running
 * - 本函数负责写入终态 success 或 failed
 */
export async function runPipelineFromParsedData(
  sessionId: string,
  userId: number,
  rawRows: Record<string, string>[],
  fieldMapping: Record<string, string>,
  originalFileName: string,
  templateId?: string,
  sourceFilesOverride?: SourceFileInfo[]
): Promise<{ success: boolean; resultSet?: ResultSet; errorSummary?: string }> {
  const jobId = nanoid(12);
  const ctx = createPipelineContext(jobId, String(userId));

  console.log(`[Pipeline] 🚀 Starting parsed-data pipeline for session ${sessionId}`);
  console.log(`[Pipeline]   File: ${originalFileName}, Rows: ${rawRows.length}`);

  try {
    // ── Layer 2: Governance（跳过 Ingestion，直接从清洗开始）──────────────────────────────
    const governance = runGovernance(ctx, rawRows, fieldMapping);
    if (ctx.aborted || governance.rows.length === 0) {
      const errorSummary = ctx.abortReason || "清洗后无有效数据";
      console.error(`[Pipeline] ❌ Governance failed for session ${sessionId}: ${errorSummary}`);
      return { success: false, errorSummary };
    }
    console.log(`[Pipeline] ✅ Governance done: ${governance.rows.length} rows after cleaning`);

    // ── Layer 3: Computation ──────────────────────────────────────────────────────────────
    // 问题1修复：先收集所有已映射的标准名
    const allFields = new Set<string>();
    for (const stdName of Object.values(fieldMapping)) {
      allFields.add(stdName);
    }
    // 问题1修复：遍历所有行（而非只看 rawRows[0]），确保后续行新增字段不漏收
    for (const row of rawRows) {
      for (const key of Object.keys(row)) {
        if (!fieldMapping[key]) {
          allFields.add(key);
        }
      }
    }
    // 问题2修复：日志下移到 allFields 构建完成后，输出 union field count
    console.log(`[Pipeline]   Fields (union): ${allFields.size}`);

    const sourceFiles: SourceFileInfo[] = sourceFilesOverride ?? [{
      fileName: originalFileName,
      s3Key: "",
      totalRows: rawRows.length + 1,
      dataRows: rawRows.length,
      fieldCount: allFields.size,  // 问题2修复：改用 allFields.size（union field count）
      platform: "parsed",
    }];

    const computationInput: ComputationInput = {
      rows: governance.rows,
      sourceFiles,
      skippedRows: governance.skippedRows,
      skippedCount: governance.skippedCount,
      fields: Array.from(allFields),
      platform: "parsed",
      isMultiFile: sourceFilesOverride ? sourceFilesOverride.length > 1 : false,
      templateId,
    };

    const resultSet = step8Compute(ctx, computationInput);
    console.log(`[Pipeline] ✅ Computation done: ${resultSet.metrics.length} metrics, ${resultSet.rowCount} rows`);

    // ── Layer 4: Expression（构建 AI prompt，同步执行 + try/catch 隔离）────────────────────
    // 问题4修复：加 try/catch 隔离，失败记录日志但不中断主链路
    try {
      buildExpressionPrompt(resultSet);
    } catch (exprErr: any) {
      console.error(`[Pipeline] ❌ buildExpressionPrompt failed (non-blocking): ${exprErr?.message}`);
    }

    return { success: true, resultSet };
  } catch (err: any) {
    const errorSummary = err?.message || "Pipeline execution error";
    console.error(`[Pipeline] ❌ runPipelineFromParsedData error for session ${sessionId}: ${errorSummary}`);
     return { success: false, errorSummary };
  }
}

/**
 * 在 upload-parsed 流程的后台运行 Pipeline（Solution B）。
 * 调用方负责在调用前写入 pipelineStatus=running。
 * 本函数负责写入终态 success 或 failed。
 *
 * 硬约束：
 * - 在写终态前必须重新获取 DB（不复用函数启动时的连接）
 */
export async function runParsedPipelineInBackground(
  sessionId: string,
  userId: number,
  rawRows: Record<string, string>[],
  fieldMapping: Record<string, string>,
  originalFileName: string,
  templateId?: string,
  sourceFilesOverride?: SourceFileInfo[]
): Promise<void> {
  console.log(`[Pipeline] 🚀 Starting background parsed pipeline for session ${sessionId}`);
  try {
    const result = await runPipelineFromParsedData(
      sessionId,
      userId,
      rawRows,
      fieldMapping,
      originalFileName,
      templateId,
      sourceFilesOverride
    );

    if (result.success && result.resultSet) {
      console.log(`[Pipeline] 💾 Saving ResultSet for session ${sessionId}`);
      console.log(`[Pipeline]   RowCount: ${result.resultSet.rowCount}`);
      console.log(`[Pipeline]   Metrics: ${result.resultSet.metrics.length}`);

      // 持久化 ResultSet（saveResultSet 内部会更新 session.resultSetId）
      const jobId = await saveResultSet(result.resultSet, sessionId, userId);

      // ⭐ 硬约束：写终态前重新获取 DB（不复用函数启动时的连接）
      const dbForStatus = await getDb();
      if (dbForStatus) {
        await dbForStatus.update(sessions)
          .set({
            pipelineStatus: "success",
            pipelineError: null,
            pipelineFinishedAt: new Date(),
          })
          .where(eq(sessions.id, sessionId));
        console.log(`[Pipeline] ✅ Updated pipelineStatus to 'success' for session ${sessionId}`);
      } else {
        console.error(`[Pipeline] ❌ Cannot write success status for ${sessionId}: DB unavailable`);
      }
      console.log(`[Pipeline] ✅ ResultSet saved successfully, jobId: ${jobId}`);
    } else {
      const errorSummary = result.errorSummary || "Parsed pipeline failed";
      // ⭐ 硬约束：写终态前重新获取 DB（不复用函数启动时的连接）
      const dbForStatus = await getDb();
      if (dbForStatus) {
        await dbForStatus.update(sessions)
          .set({
            pipelineStatus: "failed",
            pipelineError: errorSummary,
            pipelineFinishedAt: new Date(),
          })
          .where(eq(sessions.id, sessionId));
        console.log(`[Pipeline] ❌ Updated pipelineStatus to 'failed' for session ${sessionId}`);
      }
    }
  } catch (err: any) {
    const errMsg = err?.message || "Unknown exception in parsed pipeline";
    console.error(`[Pipeline] ❌ Background parsed pipeline error for session ${sessionId}: ${errMsg}`);
    try {
      const dbForStatus = await getDb();
      if (dbForStatus) {
        await dbForStatus.update(sessions)
          .set({
            pipelineStatus: "failed",
            pipelineError: errMsg,
            pipelineFinishedAt: new Date(),
          })
          .where(eq(sessions.id, sessionId));
      }
    } catch {
      // 忽略状态写入失败
    }
  }
}

// ── ResultSet 持久化 ──────────────────────────────────────────────

/**
 * 将 ResultSet 持久化到数据库和 S3。
 * - 核心元数据存 DB（result_sets 表）
 * - 标准化数据行存 S3（避免 DB 存大量行数据）
 *
 * 硬约束（V2.4）：
 * - S3 写入失败必须抛错（是 V3.0 导出的必要条件）
 * - ResultSet 写 DB 失败必须抛错
 * - 成功后必须更新 sessions.resultSetId
 */
export async function saveResultSet(
  rs: ResultSet,
  sessionId: string,
  userId: number
): Promise<string> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  console.log(`[Pipeline] 💾 Saving ResultSet for session ${sessionId}`);
  console.log(`[Pipeline]   JobId: ${rs.jobId}`);
  console.log(`[Pipeline]   RowCount: ${rs.rowCount}`);
  console.log(`[Pipeline]   Metrics: ${rs.metrics.length}`);
  console.log(`[Pipeline]   Fields: ${rs.fields.length}`);

  // 1. 将标准化数据行存到 S3（⭐ V3.0 导出的必要条件，S3 写入失败按 Pipeline failed 处理）
  let dataS3Key: string | null = null;
  if (rs.standardizedRows.length > 0) {
    const s3Key = `atlas-resultsets/${rs.jobId}/data.json`;
    try {
      const dataJson = JSON.stringify(rs.standardizedRows);
      console.log(`[Pipeline] 💾 Uploading ${rs.standardizedRows.length} rows to S3, size: ${dataJson.length} bytes`);
      await storagePut(s3Key, Buffer.from(dataJson), "application/json");
      dataS3Key = s3Key;
      console.log(`[Pipeline] ✅ Data rows uploaded to S3: ${s3Key}`);
    } catch (err: any) {
      console.error(`[Pipeline] ❌ Failed to save data rows to S3: ${err?.message}`);
      // ⭐ S3 落盘失败是 V3.0 导出的必要条件，必须抛出错误
      throw new Error(`Failed to upload standardizedRows to S3: ${err?.message}`);
    }
  } else {
    console.error(`[Pipeline] ❌ WARNING: No standardizedRows to save for session ${sessionId}`);
  }

  // 2. 将元数据存到 DB
  try {
    console.log(`[Pipeline] 💾 Inserting ResultSet into DB...`);
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
    console.log(`[Pipeline] ✅ ResultSet inserted into DB`);

    // 3. 更新 session 关联 resultSetId（⭐ 统一字段命名：使用 resultSetId）
    console.log(`[Pipeline] 💾 Updating session with resultSetId...`);
    await db.update(sessions)
      .set({ resultSetId: rs.jobId })
      .where(eq(sessions.id, sessionId));
    console.log(`[Pipeline] ✅ Session updated with resultSetId: ${rs.jobId}`);
  } catch (err: any) {
    console.error(`[Pipeline] ❌ Failed to save ResultSet to DB: ${err?.message}`);
    throw err; // 抛出错误，让上层知道失败
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

    if (rows.length === 0) {
      console.log(`[Pipeline] 🔍 [DEBUG] getResultSetForSession: no ResultSet found for session ${sessionId}`);
      return null;
    }

    const record = rows[0];
    console.log(`[Pipeline] 🔍 [DEBUG] getResultSetForSession for session ${sessionId}`);
    console.log(`[Pipeline] 🔍 [DEBUG] Found ResultSet record.id: ${record.id}`);
    console.log(`[Pipeline] 🔍 [DEBUG] record.rowCount: ${record.rowCount}`);
    console.log(`[Pipeline] 🔍 [DEBUG] record.dataS3Key: ${record.dataS3Key}`);
    console.log(`[Pipeline] 🔍 [DEBUG] record.computationVersion: ${record.computationVersion}`);
    console.log(`[Pipeline] 🔍 [DEBUG] record.isMultiFile: ${record.isMultiFile}`);

    // 从 S3 加载标准化数据行
    let standardizedRows: Record<string, string | number | null>[] = [];
    if (record.dataS3Key) {
      try {
        const buf = await storageReadFile(record.dataS3Key);
        standardizedRows = JSON.parse(buf.toString());
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
      resultType: (record as any).resultType || "full_detail",
    };

    console.log(`[Pipeline] 🔍 [DEBUG] Rebuilt ResultSet for session ${sessionId}`);
    console.log(`[Pipeline] 🔍 [DEBUG] rs.jobId (resultSetId): ${rs.jobId}`);
    console.log(`[Pipeline] 🔍 [DEBUG] rs.rowCount: ${rs.rowCount}`);
    console.log(`[Pipeline] 🔍 [DEBUG] rs.standardizedRows.length: ${rs.standardizedRows.length}`);
    console.log(`[Pipeline] 🔍 [DEBUG] rs.fields count: ${rs.fields.length}`);
    console.log(`[Pipeline] 🔍 [DEBUG] First 3 standardizedRows sample:`, JSON.stringify(rs.standardizedRows.slice(0, 3), null, 2));

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
        const buf = await storageReadFile(record.dataS3Key);
        standardizedRows = JSON.parse(buf.toString());
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
      resultType: (record as any).resultType || "full_detail",
    };

    return rs;
  } catch (err: any) {
    console.error(`[Pipeline] Failed to get ResultSet by ID ${resultSetId}: ${err?.message}`);
    return null;
  }
}
