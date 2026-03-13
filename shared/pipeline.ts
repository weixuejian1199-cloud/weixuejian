/**
 * ATLAS V3.0 — 处理管道数据结构定义
 * ─────────────────────────────────────────────────────────────────
 * A 阶段交付物 A4：9 步处理管道的输入输出接口 + 错误分级
 *
 * 管道设计原则：
 *   1. 无论单文件、多文件、大文件、脏数据，全部走同一条管道，不允许分叉路径
 *   2. 每个步骤的输入和输出都有明确的数据结构定义
 *   3. 步骤之间通过标准接口传递，不允许跨步骤直接访问
 *   4. 每个步骤产出清洗日志，记录操作和影响
 *
 * 冻结规则：本文件经 A 阶段验收后冻结。
 */

// ── 错误分级 ──────────────────────────────────────────────────────

/**
 * 四级错误分级体系。
 * 不是所有错误都需要阻断用户，有些只需提示，有些必须阻断。
 */
export enum ErrorLevel {
  /** 致命：阻断操作，明确提示原因。如文件格式无法识别、文件为空、编码无法转换 */
  FATAL = "fatal",
  /** 严重：阻断计算，提示并建议修复。如必需字段缺失、数值列全部为非数字 */
  CRITICAL = "critical",
  /** 警告：继续处理，在结果中标注。如部分行被跳过（脏数据）、未知字段未映射 */
  WARNING = "warning",
  /** 信息：静默记录到日志。如文件编码自动转换、日期格式自动统一 */
  INFO = "info",
}

export interface PipelineError {
  /** 错误级别 */
  level: ErrorLevel;
  /** 发生在哪个步骤（1-9） */
  step: number;
  /** 错误编码（用于前端展示和国际化） */
  code: string;
  /** 人类可读的错误消息 */
  message: string;
  /** 详细信息（调试用） */
  details?: string;
  /** 影响的行号（如果适用） */
  affectedRows?: number[];
}

// ── 错误编码定义 ──────────────────────────────────────────────────

export const ERROR_CODES = {
  // 致命错误（E1xxx）
  E1001: { level: ErrorLevel.FATAL, message: "文件格式无法识别，仅支持 CSV 和 Excel 格式" },
  E1002: { level: ErrorLevel.FATAL, message: "文件内容为空" },
  E1003: { level: ErrorLevel.FATAL, message: "文件编码无法转换" },
  E1004: { level: ErrorLevel.FATAL, message: "文件损坏，无法读取" },
  E1005: { level: ErrorLevel.FATAL, message: "文件上传失败" },

  // 严重错误（E2xxx）
  E2001: { level: ErrorLevel.CRITICAL, message: "未找到任何可识别的数据列" },
  E2002: { level: ErrorLevel.CRITICAL, message: "必需字段缺失" },
  E2003: { level: ErrorLevel.CRITICAL, message: "数值列全部为非数字数据" },
  E2004: { level: ErrorLevel.CRITICAL, message: "数据行数为 0（表头存在但无数据）" },
  E2005: { level: ErrorLevel.CRITICAL, message: "模板必需字段缺失" },

  // 警告（W3xxx）
  W3001: { level: ErrorLevel.WARNING, message: "部分行数据格式异常，已跳过" },
  W3002: { level: ErrorLevel.WARNING, message: "存在未映射的未知字段" },
  W3003: { level: ErrorLevel.WARNING, message: "多文件字段不完全一致，已按交集对齐" },
  W3004: { level: ErrorLevel.WARNING, message: "部分日期格式无法解析" },
  W3005: { level: ErrorLevel.WARNING, message: "检测到重复订单号" },

  // 信息（I4xxx）
  I4001: { level: ErrorLevel.INFO, message: "文件编码已自动转换为 UTF-8" },
  I4002: { level: ErrorLevel.INFO, message: "日期格式已自动统一" },
  I4003: { level: ErrorLevel.INFO, message: "数字格式已自动清洗（去逗号等）" },
  I4004: { level: ErrorLevel.INFO, message: "平台已自动识别" },
  I4005: { level: ErrorLevel.INFO, message: "字段已自动映射为标准字段名" },
} as const;

// ── 管道步骤定义 ──────────────────────────────────────────────────

/**
 * 步骤 1：文件接收
 * 输入：用户上传的原始文件
 * 输出：S3 存储路径 + 文件元数据
 */
export interface Step1Output {
  /** 文件在 S3 的存储路径 */
  s3Key: string;
  /** S3 访问 URL */
  s3Url: string;
  /** 原始文件名 */
  originalFileName: string;
  /** 文件大小（字节） */
  fileSize: number;
  /** MIME 类型 */
  mimeType: string;
  /** 上传时间（UTC 毫秒时间戳） */
  uploadedAt: number;
}

/**
 * 步骤 2：编码检测
 * 输入：S3 文件路径
 * 输出：检测到的编码 + 转换后的 UTF-8 内容
 */
export interface Step2Output {
  /** 检测到的原始编码 */
  detectedEncoding: string;
  /** 是否需要转换 */
  needsConversion: boolean;
  /** 转换后的文件内容（Buffer） */
  utf8Content: Buffer | ArrayBuffer;
}

/**
 * 步骤 3：格式解析
 * 输入：UTF-8 内容
 * 输出：原始行数据（rawRows）
 */
export interface Step3Output {
  /** 表头字段名列表 */
  headers: string[];
  /** 原始行数据（每行是一个字段名→值的映射） */
  rawRows: Record<string, string>[];
  /** 总行数（含表头） */
  totalRows: number;
  /** 数据行数（不含表头） */
  dataRows: number;
  /** Sheet 名称（Excel 多 Sheet 时） */
  sheetName?: string;
  /** 是否为多 Sheet 文件 */
  isMultiSheet: boolean;
}

/**
 * 步骤 4：平台识别
 * 输入：表头字段名
 * 输出：识别的平台 + 置信度
 */
export interface Step4Output {
  /** 识别的平台 */
  platform: string;
  /** 识别置信度（命中的特征字段数） */
  confidence: number;
  /** 命中的特征字段 */
  matchedSignatures: string[];
}

/**
 * 步骤 5：字段映射
 * 输入：原始字段名列表
 * 输出：映射结果（原始名→标准名）+ 未映射字段
 */
export interface Step5Output {
  /** 成功映射的字段：原始名 → 标准名 */
  mappedFields: Record<string, string>;
  /** 未映射的字段名列表 */
  unmappedFields: string[];
  /** 映射覆盖率 */
  coverageRate: number;
}

/**
 * 步骤 6：类型推断与清洗
 * 输入：rawRows + 字段映射
 * 输出：cleanedRows（清洗后的标准化行数据）
 */
export interface Step6Output {
  /** 清洗后的标准化行数据 */
  cleanedRows: Record<string, string | number | null>[];
  /** 有效行数 */
  validRowCount: number;
  /** 跳过的行数 */
  skippedRowCount: number;
  /** 跳过的行示例（前 5 条） */
  skippedSamples: Array<{
    rowNumber: number;
    reason: string;
    preview: Record<string, string>;
  }>;
  /** 类型推断结果 */
  inferredTypes: Record<string, string>;
}

/**
 * 步骤 7：多文件对齐（仅多文件场景）
 * 输入：多个文件的 cleanedRows
 * 输出：对齐合并后的 cleanedRows
 */
export interface Step7Output {
  /** 合并后的行数据 */
  mergedRows: Record<string, string | number | null>[];
  /** 合并后的字段列表（交集） */
  mergedFields: string[];
  /** 各文件的行数统计 */
  fileRowCounts: Array<{
    fileName: string;
    rowCount: number;
  }>;
  /** 对齐策略说明 */
  alignmentNotes: string[];
}

/**
 * 步骤 8：计算
 * 输入：cleanedRows（或 mergedRows）
 * 输出：ResultSet
 */
export interface Step8Output {
  /** 完整的 ResultSet */
  resultSetId: string;
}

/**
 * 步骤 9：交付
 * 输入：ResultSet
 * 输出：绑定到页面渲染和导出
 */
export interface Step9Output {
  /** ResultSet 已绑定到的交付渠道 */
  deliveryChannels: ("page" | "export" | "im")[];
  /** 交付时间 */
  deliveredAt: number;
}

// ── 管道执行上下文 ──────────────────────────────────────────────

/**
 * 管道执行上下文，贯穿 9 个步骤。
 * 每个步骤的输出存储在对应的字段中。
 */
export interface PipelineContext {
  /** 任务 ID */
  jobId: string;
  /** 用户 ID */
  userId: string;
  /** 开始时间 */
  startedAt: number;
  /** 当前步骤 */
  currentStep: number;
  /** 各步骤输出 */
  steps: {
    step1?: Step1Output;
    step2?: Step2Output;
    step3?: Step3Output;
    step4?: Step4Output;
    step5?: Step5Output;
    step6?: Step6Output;
    step7?: Step7Output;
    step8?: Step8Output;
    step9?: Step9Output;
  };
  /** 累积的错误和警告 */
  errors: PipelineError[];
  /** 是否已中断（遇到致命或严重错误） */
  aborted: boolean;
  /** 中断原因 */
  abortReason?: string;
}

/**
 * 创建空的管道上下文。
 */
export function createPipelineContext(
  jobId: string,
  userId: string
): PipelineContext {
  return {
    jobId,
    userId,
    startedAt: Date.now(),
    currentStep: 0,
    steps: {},
    errors: [],
    aborted: false,
  };
}

/**
 * 检查管道是否应该中断。
 * 遇到 FATAL 或 CRITICAL 错误时中断。
 */
export function shouldAbort(ctx: PipelineContext): boolean {
  return ctx.errors.some(
    e => e.level === ErrorLevel.FATAL || e.level === ErrorLevel.CRITICAL
  );
}

/**
 * 获取管道中所有警告级别以上的错误。
 * 用于前端展示。
 */
export function getUserVisibleErrors(ctx: PipelineContext): PipelineError[] {
  return ctx.errors.filter(
    e => e.level !== ErrorLevel.INFO
  );
}
