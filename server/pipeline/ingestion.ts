/**
 * ATLAS V3.0 — Ingestion 层（第 1 层）
 * ─────────────────────────────────────────────────────────────────
 * B 阶段交付物 B1：文件接收 → 编码检测 → 格式解析 → 平台识别 → 字段映射
 *
 * 对应管道步骤：Step 1 ~ Step 5
 *
 * 职责：
 *   1. 接收上传文件，存储到 S3
 *   2. 检测文件编码，转换为 UTF-8
 *   3. 解析 CSV/Excel 格式，提取原始行数据
 *   4. 识别来源平台（抖音/天猫/拼多多/京东）
 *   5. 将原始字段名映射为标准字段名
 *
 * 设计原则：
 *   - 每个步骤独立，可单独测试
 *   - 错误不吞掉，统一收集到 PipelineContext.errors
 *   - 大文件使用流式解析，控制内存
 */

import * as XLSX from "xlsx";
import {
  type PipelineContext,
  type PipelineError,
  type Step1Output,
  type Step2Output,
  type Step3Output,
  type Step4Output,
  type Step5Output,
  ErrorLevel,
} from "@shared/pipeline";
import {
  normalizeFieldNames,
  detectPlatform,
  type Platform,
} from "@shared/fieldAliases";
import { storagePut } from "../storage";
import { nanoid } from "nanoid";

// ── Step 1: 文件接收 ──────────────────────────────────────────────

/**
 * 接收上传文件，存储到 S3，返回文件元数据。
 */
export async function step1FileReceive(
  ctx: PipelineContext,
  fileBuffer: Buffer,
  originalFileName: string,
  mimeType: string
): Promise<Step1Output | null> {
  ctx.currentStep = 1;

  if (!fileBuffer || fileBuffer.length === 0) {
    ctx.errors.push({
      level: ErrorLevel.FATAL,
      step: 1,
      code: "E1002",
      message: "文件内容为空",
    });
    ctx.aborted = true;
    ctx.abortReason = "文件内容为空";
    return null;
  }

  // 验证文件类型
  const validMimeTypes = [
    "text/csv",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/octet-stream", // 某些浏览器上传 CSV 时使用
  ];
  const validExtensions = [".csv", ".xls", ".xlsx"];
  const ext = originalFileName.toLowerCase().match(/\.[^.]+$/)?.[0] || "";

  if (!validMimeTypes.includes(mimeType) && !validExtensions.includes(ext)) {
    ctx.errors.push({
      level: ErrorLevel.FATAL,
      step: 1,
      code: "E1001",
      message: "文件格式无法识别，仅支持 CSV 和 Excel 格式",
      details: `收到的 MIME 类型: ${mimeType}, 扩展名: ${ext}`,
    });
    ctx.aborted = true;
    ctx.abortReason = "文件格式不支持";
    return null;
  }

  // 存储到 S3
  const suffix = nanoid(8);
  const s3Key = `atlas-pipeline/${ctx.jobId}/${suffix}-${originalFileName}`;

  try {
    const { url: s3Url } = await storagePut(s3Key, fileBuffer, mimeType);

    const output: Step1Output = {
      s3Key,
      s3Url,
      originalFileName,
      fileSize: fileBuffer.length,
      mimeType,
      uploadedAt: Date.now(),
    };

    ctx.steps.step1 = output;
    return output;
  } catch (err: any) {
    ctx.errors.push({
      level: ErrorLevel.FATAL,
      step: 1,
      code: "E1005",
      message: "文件上传失败",
      details: err?.message || "S3 存储失败",
    });
    ctx.aborted = true;
    ctx.abortReason = "文件上传到 S3 失败";
    return null;
  }
}

// ── Step 2: 编码检测 ──────────────────────────────────────────────

/**
 * 检测文件编码并转换为 UTF-8。
 * Excel 文件（.xls/.xlsx）不需要编码转换，直接返回原始 Buffer。
 * CSV 文件需要检测编码（UTF-8/GBK/GB2312/BIG5 等）。
 */
export async function step2EncodingDetect(
  ctx: PipelineContext,
  fileBuffer: Buffer,
  fileName: string
): Promise<Step2Output | null> {
  ctx.currentStep = 2;

  const ext = fileName.toLowerCase().match(/\.[^.]+$/)?.[0] || "";

  // Excel 文件不需要编码转换
  if (ext === ".xls" || ext === ".xlsx") {
    const output: Step2Output = {
      detectedEncoding: "binary",
      needsConversion: false,
      utf8Content: fileBuffer,
    };
    ctx.steps.step2 = output;
    return output;
  }

  // CSV 文件：检测编码
  try {
    // 尝试 UTF-8 解码
    const utf8Text = fileBuffer.toString("utf-8");

    // 检查是否有 BOM
    const hasBOM = utf8Text.charCodeAt(0) === 0xfeff;
    const cleanText = hasBOM ? utf8Text.slice(1) : utf8Text;

    // 简单的乱码检测：如果包含大量替换字符，可能不是 UTF-8
    const replacementCount = (cleanText.match(/\ufffd/g) || []).length;
    const isLikelyUTF8 = replacementCount < cleanText.length * 0.01;

    if (isLikelyUTF8) {
      const output: Step2Output = {
        detectedEncoding: hasBOM ? "UTF-8-BOM" : "UTF-8",
        needsConversion: hasBOM,
        utf8Content: Buffer.from(cleanText, "utf-8"),
      };
      ctx.steps.step2 = output;

      if (hasBOM) {
        ctx.errors.push({
          level: ErrorLevel.INFO,
          step: 2,
          code: "I4001",
          message: "文件编码已自动转换为 UTF-8（去除 BOM）",
        });
      }
      return output;
    }

    // 尝试 GBK/GB2312 解码
    try {
      const decoder = new TextDecoder("gbk");
      const gbkText = decoder.decode(fileBuffer);

      const output: Step2Output = {
        detectedEncoding: "GBK",
        needsConversion: true,
        utf8Content: Buffer.from(gbkText, "utf-8"),
      };
      ctx.steps.step2 = output;

      ctx.errors.push({
        level: ErrorLevel.INFO,
        step: 2,
        code: "I4001",
        message: "文件编码已自动从 GBK 转换为 UTF-8",
      });
      return output;
    } catch {
      // GBK 解码也失败
      ctx.errors.push({
        level: ErrorLevel.FATAL,
        step: 2,
        code: "E1003",
        message: "文件编码无法转换",
        details: "尝试 UTF-8 和 GBK 解码均失败",
      });
      ctx.aborted = true;
      ctx.abortReason = "文件编码无法识别";
      return null;
    }
  } catch (err: any) {
    ctx.errors.push({
      level: ErrorLevel.FATAL,
      step: 2,
      code: "E1004",
      message: "文件损坏，无法读取",
      details: err?.message,
    });
    ctx.aborted = true;
    ctx.abortReason = "文件损坏";
    return null;
  }
}

// ── Step 3: 格式解析 ──────────────────────────────────────────────

/**
 * 解析 CSV/Excel 文件，提取原始行数据。
 * 使用 xlsx 库统一处理 CSV 和 Excel。
 */
export function step3FormatParse(
  ctx: PipelineContext,
  content: Buffer | ArrayBuffer,
  fileName: string
): Step3Output | null {
  ctx.currentStep = 3;

  const ext = fileName.toLowerCase().match(/\.[^.]+$/)?.[0] || "";

  try {
    let workbook: XLSX.WorkBook;

    if (ext === ".csv") {
      // CSV: 从 UTF-8 文本解析
      const text = Buffer.isBuffer(content)
        ? content.toString("utf-8")
        : new TextDecoder().decode(content);
      workbook = XLSX.read(text, { type: "string", raw: false });
    } else {
      // Excel: 从 Buffer 解析
      const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
      workbook = XLSX.read(buf, { type: "buffer", raw: false });
    }

    const sheetNames = workbook.SheetNames;
    if (!sheetNames.length) {
      ctx.errors.push({
        level: ErrorLevel.FATAL,
        step: 3,
        code: "E1002",
        message: "文件内容为空（没有工作表）",
      });
      ctx.aborted = true;
      ctx.abortReason = "文件没有工作表";
      return null;
    }

    // 遍历所有 Sheet，拼接行数据
    const rawData: Record<string, string>[] = [];
    for (const sheetName of sheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const rows: Record<string, string>[] = XLSX.utils.sheet_to_json(sheet, {
        defval: "",
        raw: false,
      });
      rawData.push(...rows);
    }

    if (rawData.length === 0) {
      ctx.errors.push({
        level: ErrorLevel.CRITICAL,
        step: 3,
        code: "E2004",
        message: "数据行数为 0（表头存在但无数据）",
      });
      ctx.aborted = true;
      ctx.abortReason = "文件没有数据行";
      return null;
    }

    // 提取表头
    const headers = Object.keys(rawData[0]).filter(
      h => h.trim() && !h.startsWith("__EMPTY")
    );

    if (headers.length === 0) {
      ctx.errors.push({
        level: ErrorLevel.CRITICAL,
        step: 3,
        code: "E2001",
        message: "未找到任何可识别的数据列",
      });
      ctx.aborted = true;
      ctx.abortReason = "没有可识别的数据列";
      return null;
    }

    const output: Step3Output = {
      headers,
      rawRows: rawData,
      totalRows: rawData.length + 1, // 含表头
      dataRows: rawData.length,
      sheetName,
      isMultiSheet: sheetNames.length > 1,
    };

    ctx.steps.step3 = output;

    if (sheetNames.length > 1) {
      ctx.errors.push({
        level: ErrorLevel.INFO,
        step: 3,
        code: "I4001",
        message: `文件包含 ${sheetNames.length} 个工作表，当前使用第一个「${sheetName}」`,
      });
    }

    return output;
  } catch (err: any) {
    ctx.errors.push({
      level: ErrorLevel.FATAL,
      step: 3,
      code: "E1004",
      message: "文件损坏，无法读取",
      details: err?.message,
    });
    ctx.aborted = true;
    ctx.abortReason = "文件解析失败";
    return null;
  }
}

// ── Step 4: 平台识别 ──────────────────────────────────────────────

/**
 * 根据表头字段名自动识别来源平台。
 * 复用 A1 的 detectPlatform 函数。
 */
export function step4PlatformDetect(
  ctx: PipelineContext,
  headers: string[]
): Step4Output {
  ctx.currentStep = 4;

  const platform = detectPlatform(headers);

  // 计算命中的特征字段
  const platformSignatures: Record<Exclude<Platform, "unknown">, string[]> = {
    douyin: ["达人昵称", "小店名称", "抖音", "订单应付金额", "商品实付", "达人佣金", "选购商品"],
    tmall: ["买家会员名", "宝贝标题", "宝贝数量", "天猫", "淘宝", "卖家昵称", "旺旺", "淘客"],
    pdd: ["拼多多", "成团时间", "商家编码", "拼单"],
    jd: ["京东", "京东价", "PLUS", "联盟达人"],
  };

  const matchedSignatures: string[] = [];
  if (platform !== "unknown") {
    const sigs = platformSignatures[platform as Exclude<Platform, "unknown">] || [];
    const normalizedHeaders = headers.map(h => h.trim().toLowerCase());
    for (const sig of sigs) {
      if (normalizedHeaders.some(h => h.includes(sig.toLowerCase()))) {
        matchedSignatures.push(sig);
      }
    }
  }

  const output: Step4Output = {
    platform,
    confidence: matchedSignatures.length,
    matchedSignatures,
  };

  ctx.steps.step4 = output;

  if (platform !== "unknown") {
    ctx.errors.push({
      level: ErrorLevel.INFO,
      step: 4,
      code: "I4004",
      message: `平台已自动识别为「${platform}」（命中 ${matchedSignatures.length} 个特征字段）`,
    });
  }

  return output;
}

// ── Step 5: 字段映射 ──────────────────────────────────────────────

/**
 * 将原始字段名映射为标准字段名。
 * 复用 A1 的 normalizeFieldNames 函数。
 */
export function step5FieldMapping(
  ctx: PipelineContext,
  headers: string[]
): Step5Output {
  ctx.currentStep = 5;

  const { mapped, unmapped } = normalizeFieldNames(headers);

  const totalFields = headers.length;
  const mappedCount = Object.keys(mapped).length;
  const coverageRate = totalFields > 0 ? mappedCount / totalFields : 0;

  const output: Step5Output = {
    mappedFields: mapped,
    unmappedFields: unmapped,
    coverageRate,
  };

  ctx.steps.step5 = output;

  if (mappedCount > 0) {
    ctx.errors.push({
      level: ErrorLevel.INFO,
      step: 5,
      code: "I4005",
      message: `已映射 ${mappedCount}/${totalFields} 个字段为标准字段名（覆盖率 ${(coverageRate * 100).toFixed(0)}%）`,
    });
  }

  if (unmapped.length > 0 && unmapped.length <= 10) {
    ctx.errors.push({
      level: ErrorLevel.WARNING,
      step: 5,
      code: "W3002",
      message: `${unmapped.length} 个字段未映射：${unmapped.slice(0, 5).join("、")}${unmapped.length > 5 ? "等" : ""}`,
    });
  }

  if (mappedCount === 0) {
    ctx.errors.push({
      level: ErrorLevel.CRITICAL,
      step: 5,
      code: "E2001",
      message: "未找到任何可识别的数据列（所有字段均未匹配标准字段）",
    });
    ctx.aborted = true;
    ctx.abortReason = "没有可识别的标准字段";
  }

  return output;
}

// ── Ingestion 层统一入口 ──────────────────────────────────────────

export interface IngestionResult {
  /** 原始行数据 */
  rawRows: Record<string, string>[];
  /** 表头字段名 */
  headers: string[];
  /** 识别的平台 */
  platform: string;
  /** 字段映射：原始名 → 标准名 */
  fieldMapping: Record<string, string>;
  /** 未映射的字段 */
  unmappedFields: string[];
  /** S3 文件 URL */
  fileUrl: string;
  /** S3 文件路径（用于 storageReadFile） */
  s3Key: string;
  /** 原始文件名 */
  originalFileName: string;
  /** 数据行数 */
  dataRows: number;
}

/**
 * 执行完整的 Ingestion 层处理（Step 1 ~ Step 5）。
 * 如果任何步骤遇到致命/严重错误，提前中断并返回 null。
 */
export async function runIngestion(
  ctx: PipelineContext,
  fileBuffer: Buffer,
  originalFileName: string,
  mimeType: string
): Promise<IngestionResult | null> {
  // Step 1: 文件接收
  const step1 = await step1FileReceive(ctx, fileBuffer, originalFileName, mimeType);
  if (!step1 || ctx.aborted) return null;

  // Step 2: 编码检测
  const step2 = await step2EncodingDetect(ctx, fileBuffer, originalFileName);
  if (!step2 || ctx.aborted) return null;

  // Step 3: 格式解析
  const step3 = step3FormatParse(ctx, step2.utf8Content, originalFileName);
  if (!step3 || ctx.aborted) return null;

  // Step 4: 平台识别
  const step4 = step4PlatformDetect(ctx, step3.headers);

  // Step 5: 字段映射
  const step5 = step5FieldMapping(ctx, step3.headers);
  if (ctx.aborted) return null;

  return {
    rawRows: step3.rawRows,
    headers: step3.headers,
    platform: step4.platform,
    fieldMapping: step5.mappedFields,
    unmappedFields: step5.unmappedFields,
    fileUrl: step1.s3Url,
    s3Key: step1.s3Key,
    originalFileName,
    dataRows: step3.dataRows,
  };
}
