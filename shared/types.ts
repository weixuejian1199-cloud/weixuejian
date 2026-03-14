/**
 * Unified type exports
 * Import shared types from this single entry point.
 */

export type * from "../drizzle/schema";
export * from "./_core/errors";

// ── Phase 4：字段身份结构化（V4.0）────────────────────────────────────────────────────────────
// 前后端唯一真源：字段身份、分组度量、导出载荷

// ── 类型定义分层 ─────────────────────────────────────────────────────────────────
// 字段身份层允许 none，因为 identifier / dimension / unknown 本来就可能不可聚合
// 聚合层不允许 none，必须在进入聚合链路前先拦截
export type FieldAggType = "sum" | "count" | "avg" | "none";
export type MetricAggType = "sum" | "count" | "avg";

// ── 字段身份元信息（FieldMetadata）────────────────────────────────────────────────────
/**
 * 字段身份元信息（FieldMetadata）
 * 用于唯一标识字段的身份，避免靠字段名猜测
 */
export interface FieldMetadata {
  /** 唯一度量标识，例如：order_payable_amount */
  metricKey: string;
  
  /** 字段角色 */
  fieldRole: "dimension" | "metric" | "identifier" | "datetime" | "unknown";
  
  /** 字段类型 */
  valueType: "string" | "number" | "datetime";
  
  /** 聚合类型（字段身份层，允许 none） */
  aggType: FieldAggType;
  
  /** 统一标准名，例如：订单应付金额 */
  canonicalName: string;
  
  /** 来源表，例如：订单、资金 */
  sourceSheet: string;
  
  /** 来源域（用于跨表合并兼容性判断） */
  sourceDomain: "order" | "payment" | "product" | "unknown";
  
  /** 识别置信度 */
  confidence: "high" | "medium" | "low";
  
  /** 原始字段名（用于调试） */
  originalFieldName: string;
}

// ── 结构化分组度量（GroupedMetric）────────────────────────────────────────────────────
/**
 * 结构化分组度量（GroupedMetric）
 * 继承 GroupedTop5Entry，增加结构化标识
 */
export interface GroupedMetric {
  /** 分组标签（显示值），例如："达人A" */
  label: string;
  
  /** 聚合值 */
  sum: number;
  
  /** 来源文件名（可选） */
  source?: string;
  
  /** 度量标识 */
  metricKey: string;
  
  /** 聚合类型（聚合层，不允许 none） */
  aggType: MetricAggType;
  
  /** 分组字段显示名，例如："达人昵称" */
  groupByField: string;
  
  /** 分组字段结构化标识（关键：汇总匹配必须用这个），例如："talent_nickname" */
  groupByKey: string;
  
  /** 分组字段角色 */
  groupByRole: "dimension" | "metric" | "identifier" | "datetime";
  
  /** 来源 Session ID */
  sourceSessionId: string;
  
  /** 来源文件名 */
  sourceFileName: string;
}

// ── 统一导出载荷（ExportPayload）────────────────────────────────────────────────────
/**
 * 统一导出载荷（ExportPayload）
 * 问答、汇总、导出共用同一份结果
 */
export interface ExportPayload {
  // ── 核心身份标识 ────────────────────────────────────────────────────────
  /** 度量标识 */
  metricKey: string;
  
  /** 聚合类型（聚合层，不允许 none） */
  aggType: MetricAggType;
  
  /** 分组字段显示名 */
  groupByField: string;
  
  /** 分组字段结构化标识 */
  groupByKey: string;
  
  // ── 数据 ─────────────────────────────────────────────────────────────────
  /** 明细数据 */
  rows: Record<string, unknown>[];
  
  /** 分组数据（可选） */
  groupedRows?: GroupedMetric[];
  
  /** 过滤条件（可选） */
  filters?: Record<string, unknown>;
  
  // ── 来源追溯 ─────────────────────────────────────────────────────────────
  /** 文件范围 */
  fileScope: "single" | "multi";
  
  /** 来源 Session ID 列表 */
  sourceSessionIds: string[];
  
  /** 来源文件名列表 */
  sourceFileNames: string[];
  
  /** 明细行引用（可选） */
  detailRowsRef?: string[];
  
  // ── 元信息 ───────────────────────────────────────────────────────────────
  /** 导出时间戳 */
  exportTimestamp: number;
  
  /** 导出版本 */
  exportVersion: string;
}

// ── 兼容旧代码的 GroupedTop5Entry（前端使用）──────────────────────────────────────
/**
 * GroupedTop5Entry（兼容旧代码，前端使用）
 * 前端可以产出 aggType = "none"，但不会进入聚合链路
 */
export interface GroupedTop5Entry {
  label: string;
  sum: number;
  source?: string;
  metricKey?: string;
  aggType?: FieldAggType;  // 前端可以是 FieldAggType（包含 "none"）
  groupByKey?: string;
  groupByRole?: "dimension" | "metric" | "identifier" | "datetime";
  sourceSessionId?: string;
  sourceFileName?: string;
}
