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
import { type PipelineContext, createPipelineContext, ErrorLevel } from "@shared/pipeline";
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

    // B8: 记录多文件字段冲突
    if (mergedData.fieldConflicts.length > 0) {
      for (const conflict of mergedData.fieldConflicts) {
        ctx.errors.push({
          level: ErrorLevel.WARNING,
          step: 5,
          code: "W3005",
          message: `字段冲突：「${conflict.rawField}」在「${conflict.file1}」映射为「${conflict.std1}」，在「${conflict.file2}」映射为「${conflict.std2}」，已以第一个文件为准`,
        });
      }
    }
    if (mergedData.fileCount > 1) {
      ctx.errors.push({
        level: ErrorLevel.INFO,
        step: 5,
        code: "I4008",
        message: `多文件合并完成：${mergedData.fileCount} 个文件，共 ${mergedData.rawRows.length} 行数据`,
      });
    }

    // ── Layer 2: Governance ──────────────────────────────────────────
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
      s3Key: r.s3Key,
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
  fieldConflicts: Array<{ rawField: string; file1: string; std1: string; file2: string; std2: string }>;
  fileCount: number;
}

/**
 * B8: 增强版多文件合并 — 字段对齐 + 冲突检测 + 跨文件标准化
 *
 * 处理策略：
 *   1. 字段映射取并集，冲突时以第一个文件为准
 *   2. 每行注入 __sourceFile 和 __sourceIndex 便于溯源
 *   3. 不同文件的同名原始字段映射到不同标准字段时记录冲突
 *   4. 缺失字段自动补 null，保证所有行结构一致
 */
function mergeIngestionResults(results: IngestionResult[]): MergedIngestionData {
  const allRows: Record<string, string>[] = [];
  const mergedMapping: Record<string, string> = {};
  const fieldConflicts: Array<{ rawField: string; file1: string; std1: string; file2: string; std2: string }> = [];
  // 记录每个原始字段名 → 标准名 + 来源文件
  const fieldOrigin = new Map<string, { stdName: string; fileName: string }>();

  for (let fileIdx = 0; fileIdx < results.length; fileIdx++) {
    const result = results[fileIdx];

    // 合并行数据，注入溯源标记
    for (const row of result.rawRows) {
      allRows.push({
        ...row,
        __sourceFile: result.originalFileName,
        __sourceIndex: String(fileIdx),
      });
    }

    // 合并字段映射，检测冲突
    for (const [rawName, stdName] of Object.entries(result.fieldMapping)) {
      const existing = fieldOrigin.get(rawName);
      if (existing) {
        if (existing.stdName !== stdName) {
          // 同名原始字段映射到不同标准字段 → 冲突
          fieldConflicts.push({
            rawField: rawName,
            file1: existing.fileName,
            std1: existing.stdName,
            file2: result.originalFileName,
            std2: stdName,
          });
          // 以第一个文件的映射为准，不覆盖
        }
      } else {
        fieldOrigin.set(rawName, { stdName, fileName: result.originalFileName });
        mergedMapping[rawName] = stdName;
      }
    }
  }

  // 保证所有行具有相同的字段结构（缺失字段补空字符串）
  if (results.length > 1) {
    const allFieldNames = new Set<string>();
    for (const row of allRows) {
      for (const key of Object.keys(row)) {
        allFieldNames.add(key);
      }
    }
    for (const row of allRows) {
      for (const field of Array.from(allFieldNames)) {
        if (!(field in row)) {
          row[field] = "";
        }
      }
    }
  }

  return {
    rawRows: allRows,
    fieldMapping: mergedMapping,
    fieldConflicts,
    fileCount: results.length,
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
