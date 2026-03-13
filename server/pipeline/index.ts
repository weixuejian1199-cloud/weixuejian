/**
 * ATLAS V3.0 — 数据处理管道编排器
 * ─────────────────────────────────────────────────────────────────
 * B 阶段交付物 B6：五层架构统一入口
 *
 * 管道流程：
 *   Ingestion → Governance → Computation → Expression → Delivery
 *   (Step 1~5)   (Step 6~7)   (Step 8)      (Step 9)    (导出)
 *
 * 设计原则：
 *   - 单文件和多文件使用同一管道
 *   - 每个步骤的错误都收集到 PipelineContext
 *   - 致命错误立即中断，非致命错误继续处理
 *   - 最终产出 ResultSet 作为唯一真值源
 */

import { nanoid } from "nanoid";
import { type PipelineContext, createPipelineContext } from "@shared/pipeline";
import type { ResultSet, SourceFileInfo } from "@shared/resultSet";
import { runIngestion, type IngestionResult } from "./ingestion";
import { runGovernance, type GovernanceResult } from "./governance";
import { step8Compute, type ComputationInput } from "./computation";
import { buildExpressionPrompt, type ExpressionOutput } from "./expression";
import { exportFromResultSet, type ExportOptions, type ExportResult } from "./delivery";

// ── 管道输入 ──────────────────────────────────────────────────────

export interface PipelineInput {
  /** 上传的文件列表 */
  files: Array<{
    buffer: Buffer;
    originalName: string;
    mimeType: string;
  }>;
  /** 模板 ID（可选） */
  templateId?: string;
  /** 用户 ID */
  userId: string;
}

// ── 管道输出 ──────────────────────────────────────────────────────

export interface PipelineOutput {
  /** 管道上下文（含错误日志） */
  context: PipelineContext;
  /** 计算结果（ResultSet） */
  resultSet: ResultSet | null;
  /** AI 表达 prompt */
  expression: ExpressionOutput | null;
  /** 是否成功 */
  success: boolean;
  /** 错误摘要 */
  errorSummary: string | null;
}

// ── 管道执行 ──────────────────────────────────────────────────────

/**
 * 执行完整的数据处理管道。
 * 支持单文件和多文件输入。
 */
export async function runPipeline(input: PipelineInput): Promise<PipelineOutput> {
  const jobId = nanoid(12);
  const ctx = createPipelineContext(jobId, input.userId);

  try {
    // ── Layer 1: Ingestion ──────────────────────────────────────
    const ingestionResults: IngestionResult[] = [];

    for (const file of input.files) {
      const result = await runIngestion(ctx, file.buffer, file.originalName, file.mimeType);
      if (ctx.aborted) {
        return buildErrorOutput(ctx);
      }
      if (result) {
        ingestionResults.push(result);
      }
    }

    if (ingestionResults.length === 0) {
      ctx.aborted = true;
      ctx.abortReason = "所有文件解析失败";
      return buildErrorOutput(ctx);
    }

    // 合并多文件的行数据和字段映射
    const mergedData = mergeIngestionResults(ingestionResults);

    // ── Layer 2: Governance ──────────────────────────────────────
    const governance = runGovernance(
      ctx,
      mergedData.rawRows,
      mergedData.fieldMapping
    );

    if (ctx.aborted || governance.rows.length === 0) {
      if (!ctx.aborted) {
        ctx.aborted = true;
        ctx.abortReason = "清洗后无有效数据";
      }
      return buildErrorOutput(ctx);
    }

    // ── Layer 3: Computation ──────────────────────────────────────
    const sourceFiles: SourceFileInfo[] = ingestionResults.map(r => ({
      fileName: r.originalFileName,
      s3Key: r.fileUrl,
      totalRows: r.dataRows + 1,
      dataRows: r.dataRows,
      fieldCount: r.headers.length,
      platform: r.platform,
    }));

    // 收集所有标准字段名
    const allFields = new Set<string>();
    for (const [, stdName] of Object.entries(mergedData.fieldMapping)) {
      allFields.add(stdName);
    }

    const computationInput: ComputationInput = {
      rows: governance.rows,
      sourceFiles,
      skippedRows: governance.skippedRows,
      skippedCount: governance.skippedCount,
      fields: Array.from(allFields),
      platform: determinePlatform(ingestionResults),
      isMultiFile: ingestionResults.length > 1,
      templateId: input.templateId,
    };

    const resultSet = step8Compute(ctx, computationInput);

    // ── Layer 4: Expression ──────────────────────────────────────
    const expression = buildExpressionPrompt(resultSet);

    return {
      context: ctx,
      resultSet,
      expression,
      success: true,
      errorSummary: null,
    };
  } catch (err: any) {
    ctx.aborted = true;
    ctx.abortReason = err?.message || "管道执行异常";
    return buildErrorOutput(ctx);
  }
}

// ── 多文件合并 ──────────────────────────────────────────────────

interface MergedIngestionData {
  rawRows: Record<string, string>[];
  fieldMapping: Record<string, string>;
}

/**
 * 合并多个文件的 Ingestion 结果。
 * 行数据直接拼接，字段映射取并集。
 */
function mergeIngestionResults(results: IngestionResult[]): MergedIngestionData {
  const allRows: Record<string, string>[] = [];
  const mergedMapping: Record<string, string> = {};

  for (const result of results) {
    // 合并行数据
    allRows.push(...result.rawRows);

    // 合并字段映射（后面的不覆盖前面的）
    for (const [rawName, stdName] of Object.entries(result.fieldMapping)) {
      if (!(rawName in mergedMapping)) {
        mergedMapping[rawName] = stdName;
      }
    }
  }

  return {
    rawRows: allRows,
    fieldMapping: mergedMapping,
  };
}

/**
 * 确定多文件的统一平台标识。
 */
function determinePlatform(results: IngestionResult[]): string {
  const platforms = new Set(results.map(r => r.platform));
  platforms.delete("unknown");

  if (platforms.size === 0) return "unknown";
  if (platforms.size === 1) return Array.from(platforms)[0];
  return "mixed";
}

// ── 错误输出 ──────────────────────────────────────────────────────

function buildErrorOutput(ctx: PipelineContext): PipelineOutput {
  return {
    context: ctx,
    resultSet: null,
    expression: null,
    success: false,
    errorSummary: ctx.abortReason || "处理失败",
  };
}

// ── 导出功能（透传 delivery 层）──────────────────────────────────

export { exportFromResultSet, type ExportOptions, type ExportResult };
export { buildExpressionPrompt, buildDataSummary } from "./expression";
