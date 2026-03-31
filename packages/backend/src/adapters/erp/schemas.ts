/**
 * ztdy-open API 响应 Zod Schemas
 *
 * 所有 API 响应必须通过这些 schema 校验，
 * 格式异常的数据不进入系统（AC-02）。
 */
import { z } from 'zod';

// ─── ztdy-open 统一响应信封 ──────────────────────────────

export const ztdyEnvelopeSchema = z.object({
  Data: z.object({
    PageIndex: z.number(),
    PageSize: z.number(),
    TotalCount: z.number(),
    PageData: z.array(z.unknown()),
  }),
  Status: z.union([z.boolean(), z.number()]).transform((v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v)),
  Message: z.string().nullable(),
  Code: z.number(),
});

export type ZtdyEnvelope = z.infer<typeof ztdyEnvelopeSchema>;

// ─── 实体 Schemas（按 ztdy-open API 原始字段名）──────────

export const rawUserSchema = z.object({
  UserID: z.number(),
  LoginID: z.string().nullable().optional(),
  UserName: z.string().nullable().optional(),
  Avatar: z.string().nullable().optional(),
  LevelID: z.number().nullable().optional(),
  CreateDate: z.string().nullable().optional(),
  Phone: z.string().nullable().optional(),
});

export const rawOrderSchema = z.object({
  OrderItemID: z.number(),
  OrderItemNo: z.string(),
  UserID: z.number(),
  SupplierID: z.number(),
  SupplierName: z.string().nullable().optional(),
  ItemID: z.number().optional(),
  ItemName: z.string().nullable().optional(),
  StockName: z.string().nullable().optional(),
  Number: z.number().optional().default(1),
  Status: z.number().optional().default(0),
  ProcessNode: z.number(),
  ProcessNodeText: z.string().nullable().optional(),
  PayDate: z.string().nullable().optional(),
  ShipmentsDate: z.string().nullable().optional(),
  TotalAmount: z.number(),
  CreateDate: z.string().nullable().optional(),
});

export const rawItemSchema = z.object({
  ItemID: z.number(),
  ItemName: z.string(),
  Keywords: z.string().nullable().optional(),
  IsShelf: z
    .union([z.boolean(), z.number()])
    .transform((v) => (typeof v === 'number' ? v === 1 : v)),
  CreateDate: z.string().nullable().optional(),
  SortID: z.number().nullable().optional(),
  Price: z.number().nullable().optional(),
});

export const rawSupplierSchema = z.object({
  SupplierID: z.number(),
  SupplierName: z.string(),
  ContactPerson: z.string().nullable().optional(),
  ContactPhone: z.string().nullable().optional(),
  SettleRuleID: z.number().nullable().optional(),
  CreateDate: z.string().nullable().optional(),
});

export const rawSupplierWithdrawSchema = z.object({
  SupplierID: z.number(),
  PayNo: z.string(),
  BankAccountNo: z.string().nullable().optional(),
  TranAmount: z.number(),
  Status: z.number(),
  FinishDate: z.string().nullable().optional(),
  CreateDate: z.string().nullable().optional(),
});

export const rawUserWithdrawSchema = z.object({
  UserID: z.number(),
  PayNo: z.string(),
  Award: z.number(),
  Status: z.number(),
  TranType: z.number().nullable().optional(),
  CreateDate: z.string().nullable().optional(),
});

// ─── 过滤器 Schemas（输入校验）──────────────────────────

const baseFilterSchema = z.object({
  pageIndex: z.number().int().positive().default(1),
  pageSize: z.number().int().min(1).max(1000).default(20),
});

export const userFilterSchema = baseFilterSchema.extend({
  keyword: z.string().optional(),
  levelId: z.number().optional(),
});

export const orderFilterSchema = baseFilterSchema.extend({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  status: z.number().optional(),
  processNode: z.number().optional(),
  supplierId: z.number().optional(),
  userId: z.number().optional(),
});

export const itemFilterSchema = baseFilterSchema.extend({
  keyword: z.string().optional(),
  isShelf: z.boolean().optional(),
});

export const supplierFilterSchema = baseFilterSchema.extend({
  keyword: z.string().optional(),
});

export const withdrawFilterSchema = baseFilterSchema.extend({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  status: z.number().optional(),
});
