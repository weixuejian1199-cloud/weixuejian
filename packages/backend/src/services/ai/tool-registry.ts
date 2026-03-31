/**
 * AI 工具注册表
 *
 * 定义 AI 可调用的工具函数 + 执行映射。
 * Phase 1: 6 个工具 = 3 个聚合函数 + 3 个原始查询。
 *
 * 幻觉防护：工具结果附加数据来源和查询时间。
 */
import { z } from 'zod';
import { MallAdapter } from '../../adapters/erp/mall-adapter.js';
import * as aggregates from '../mall/aggregates.js';
import { logger } from '../../utils/logger.js';
import type { ToolDefinition, ToolExecutionResult } from './types.js';

// ─── 工具参数 Zod Schema（P0安全：AI输出不可信）────────────

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式必须为YYYY-MM-DD');
const pageIndex = z.number().int().min(1).default(1);
const pageSize = z.number().int().min(1).max(50).default(20);

export const toolParamSchemas: Record<string, z.ZodTypeAny> = {
  getSalesStats: z.object({ startDate: dateStr, endDate: dateStr }),
  getTopSuppliers: z.object({
    metric: z.enum(['orderCount', 'amount']),
    limit: z.number().int().min(1).max(50).default(10),
  }),
  getOrderStatusDistribution: z.object({
    startDate: dateStr.optional(),
    endDate: dateStr.optional(),
  }),
  getOrders: z.object({
    pageIndex, pageSize,
    startDate: dateStr.optional(), endDate: dateStr.optional(),
    status: z.number().int().min(0).max(10).optional(),
    processNode: z.number().int().min(0).max(10).optional(),
    supplierId: z.number().int().positive().optional(),
  }),
  getUsers: z.object({
    pageIndex, pageSize,
    keyword: z.string().max(100).optional(),
    levelId: z.number().int().nonnegative().optional(),
  }),
  getItems: z.object({
    pageIndex, pageSize,
    keyword: z.string().max(100).optional(),
    isShelf: z.boolean().optional(),
  }),
  getSlowSuppliers: z.object({
    limit: z.number().int().min(1).max(50).default(10),
  }),
  getUserGrowthTrend: z.object({ startDate: dateStr, endDate: dateStr }),
  getSupplierWithdraws: z.object({
    supplierId: z.number().int().positive().optional(),
    startDate: dateStr.optional(), endDate: dateStr.optional(),
    pageIndex, pageSize,
  }),
};

// ─── 工具定义（发送给百炼 API）────────────────────────────

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'getSalesStats',
      description: '查询指定日期范围的销售统计，包括总金额、订单数、平均客单价。必须提供日期范围。',
      parameters: {
        type: 'object',
        properties: {
          startDate: { type: 'string', description: '开始日期，格式 YYYY-MM-DD' },
          endDate: { type: 'string', description: '结束日期，格式 YYYY-MM-DD' },
        },
        required: ['startDate', 'endDate'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getTopSuppliers',
      description: '查询供应商排行榜，可按订单量或金额排序。',
      parameters: {
        type: 'object',
        properties: {
          metric: {
            type: 'string',
            enum: ['orderCount', 'amount'],
            description: '排序指标：orderCount=订单量，amount=金额',
          },
          limit: { type: 'number', description: '返回数量，默认10' },
        },
        required: ['metric'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getOrderStatusDistribution',
      description:
        '查询订单状态分布。ProcessNode: 0=待付款, 1=已付款, 2=待发货, 3=已发货, 4=已收货, 5=已完成。',
      parameters: {
        type: 'object',
        properties: {
          startDate: { type: 'string', description: '开始日期 YYYY-MM-DD（可选）' },
          endDate: { type: 'string', description: '结束日期 YYYY-MM-DD（可选）' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getOrders',
      description: '查询订单列表明细，支持多种筛选条件。',
      parameters: {
        type: 'object',
        properties: {
          pageIndex: { type: 'number', description: '页码，默认1' },
          pageSize: { type: 'number', description: '每页数量，默认20' },
          startDate: { type: 'string', description: '开始日期 YYYY-MM-DD' },
          endDate: { type: 'string', description: '结束日期 YYYY-MM-DD' },
          status: { type: 'number', description: '订单状态' },
          processNode: { type: 'number', description: '流程节点' },
          supplierId: { type: 'number', description: '供应商ID' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getUsers',
      description: '查询用户列表，支持关键字搜索和等级筛选。',
      parameters: {
        type: 'object',
        properties: {
          pageIndex: { type: 'number', description: '页码，默认1' },
          pageSize: { type: 'number', description: '每页数量，默认20' },
          keyword: { type: 'string', description: '搜索关键字（姓名/手机号）' },
          levelId: { type: 'number', description: '用户等级ID' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getItems',
      description: '查询商品列表，支持关键字搜索和上下架状态筛选。',
      parameters: {
        type: 'object',
        properties: {
          pageIndex: { type: 'number', description: '页码，默认1' },
          pageSize: { type: 'number', description: '每页数量，默认20' },
          keyword: { type: 'string', description: '搜索关键字（商品名称）' },
          isShelf: { type: 'boolean', description: 'true=上架中，false=已下架' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getSlowSuppliers',
      description: '查询出货最慢的供应商（待发货订单最多或等待时间最长）',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: '返回数量，默认10' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getUserGrowthTrend',
      description: '查询指定日期范围的用户增长趋势，按天统计新增用户数。必须提供日期范围。',
      parameters: {
        type: 'object',
        properties: {
          startDate: { type: 'string', description: '开始日期 YYYY-MM-DD' },
          endDate: { type: 'string', description: '结束日期 YYYY-MM-DD' },
        },
        required: ['startDate', 'endDate'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getSupplierWithdraws',
      description: '查询供应商提现记录，支持按供应商ID和日期范围筛选，返回提现列表和总金额。',
      parameters: {
        type: 'object',
        properties: {
          supplierId: { type: 'number', description: '供应商ID（可选，不传则查全部）' },
          startDate: { type: 'string', description: '开始日期 YYYY-MM-DD' },
          endDate: { type: 'string', description: '结束日期 YYYY-MM-DD' },
          pageIndex: { type: 'number', description: '页码，默认1' },
          pageSize: { type: 'number', description: '每页数量，默认20' },
        },
      },
    },
  },
];

// ─── 工具执行器 ──────────────────────────────────────────

export type ToolHandler = (
  adapter: MallAdapter,
  tenantId: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

export const toolHandlers: Record<string, ToolHandler> = {
  async getSalesStats(adapter, tenantId, args) {
    const result = await aggregates.getSalesStats(adapter, tenantId, {
      start: String(args['startDate']),
      end: String(args['endDate']),
    });
    return attachDataSource(result, 'ztdy-open OrderPageList API (聚合)');
  },

  async getTopSuppliers(adapter, tenantId, args) {
    const result = await aggregates.getTopSuppliers(
      adapter,
      tenantId,
      args['metric'] as 'orderCount' | 'amount',
      Number(args['limit'] ?? 10),
    );
    return attachDataSource(result, 'ztdy-open OrderPageList API (聚合)');
  },

  async getOrderStatusDistribution(adapter, tenantId, args) {
    const dateRange = args['startDate']
      ? { start: String(args['startDate']), end: String(args['endDate']) }
      : undefined;
    const result = await aggregates.getOrderStatusDistribution(adapter, tenantId, dateRange);
    return attachDataSource(result, 'ztdy-open OrderPageList API (聚合)');
  },

  async getOrders(adapter, _tenantId, args) {
    const result = await adapter.getOrders({
      pageIndex: Number(args['pageIndex'] ?? 1),
      pageSize: Number(args['pageSize'] ?? 20),
      startDate: args['startDate'] as string | undefined,
      endDate: args['endDate'] as string | undefined,
      status: args['status'] as number | undefined,
      processNode: args['processNode'] as number | undefined,
      supplierId: args['supplierId'] as number | undefined,
    });
    return attachDataSource(result, 'ztdy-open OrderPageList API');
  },

  async getUsers(adapter, _tenantId, args) {
    const result = await adapter.getUsers({
      pageIndex: Number(args['pageIndex'] ?? 1),
      pageSize: Number(args['pageSize'] ?? 20),
      keyword: args['keyword'] as string | undefined,
      levelId: args['levelId'] as number | undefined,
    });
    return attachDataSource(result, 'ztdy-open UserPageList API');
  },

  async getItems(adapter, _tenantId, args) {
    const result = await adapter.getItems({
      pageIndex: Number(args['pageIndex'] ?? 1),
      pageSize: Number(args['pageSize'] ?? 20),
      keyword: args['keyword'] as string | undefined,
      isShelf: args['isShelf'] as boolean | undefined,
    });
    return attachDataSource(result, 'ztdy-open ItemPageList API');
  },

  async getSlowSuppliers(adapter, tenantId, args) {
    const result = await aggregates.getSlowSuppliers(
      adapter,
      tenantId,
      Number(args['limit'] ?? 10),
    );
    return attachDataSource(result, 'ztdy-open OrderPageList API (聚合)');
  },

  async getUserGrowthTrend(adapter, tenantId, args) {
    const result = await aggregates.getUserGrowthTrend(adapter, tenantId, {
      start: String(args['startDate']),
      end: String(args['endDate']),
    });
    return attachDataSource(result, 'ztdy-open UserPageList API (聚合)');
  },

  async getSupplierWithdraws(adapter, _tenantId, args) {
    const filterSupplierId = args['supplierId'] as number | undefined;
    const result = await adapter.getSupplierWithdraws({
      pageIndex: Number(args['pageIndex'] ?? 1),
      pageSize: Number(args['pageSize'] ?? 20),
      startDate: args['startDate'] as string | undefined,
      endDate: args['endDate'] as string | undefined,
    });

    // 客户端按 supplierId 过滤（WithdrawFilter 不支持 supplierId）
    const filteredItems = filterSupplierId
      ? result.items.filter((w) => w.supplierId === filterSupplierId)
      : result.items;

    const totalAmount = Math.round(
      filteredItems.reduce((sum, w) => sum + w.tranAmount, 0) * 100,
    ) / 100;

    return attachDataSource(
      {
        items: filteredItems,
        pagination: result.pagination,
        source: result.source,
        totalAmount,
      },
      'ztdy-open SupplierWithdrawPageList API',
    );
  },
};

/** 工具参数最大长度（防DoS） */
const MAX_TOOL_ARGS_LENGTH = 10_000;

/**
 * 执行工具调用
 */
export async function executeTool(
  toolCallId: string,
  toolName: string,
  argsJson: string,
  tenantId: string,
): Promise<ToolExecutionResult> {
  const startTime = Date.now();
  const handler = toolHandlers[toolName];

  if (!handler) {
    return {
      toolCallId,
      toolName,
      result: null,
      duration: Date.now() - startTime,
      cached: false,
      error: `Unknown tool: ${toolName}`,
    };
  }

  // P0: 参数长度限制（防DoS）
  if (argsJson.length > MAX_TOOL_ARGS_LENGTH) {
    logger.warn({ toolName, argsLength: argsJson.length }, 'Tool arguments exceed size limit');
    return {
      toolCallId,
      toolName,
      result: null,
      duration: Date.now() - startTime,
      cached: false,
      error: `参数超出长度限制 (${argsJson.length}/${MAX_TOOL_ARGS_LENGTH})`,
    };
  }

  let args: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(argsJson);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object');
    }

    // P0: Zod校验工具参数（AI输出不可信）
    const schema = toolParamSchemas[toolName];
    if (schema) {
      args = schema.parse(parsed) as Record<string, unknown>;
    } else {
      args = parsed as Record<string, unknown>;
    }
  } catch (err) {
    const message = err instanceof z.ZodError
      ? `参数校验失败: ${err.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ')}`
      : '参数格式无效';
    logger.warn({ toolName, argsLength: argsJson.length }, 'Tool arguments validation failed');
    return {
      toolCallId,
      toolName,
      result: null,
      duration: Date.now() - startTime,
      cached: false,
      error: message,
    };
  }

  const adapter = new MallAdapter(tenantId);

  try {
    const result = await handler(adapter, tenantId, args);
    const duration = Date.now() - startTime;

    logger.info({ toolName, tenantId, duration, argsKeys: Object.keys(args) }, 'Tool executed');

    return {
      toolCallId,
      toolName,
      result,
      duration,
      cached: false,
    };
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error({ err, toolName, tenantId }, 'Tool execution failed');

    return {
      toolCallId,
      toolName,
      result: null,
      duration,
      cached: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * 幻觉防护：附加数据来源和查询时间
 */
function attachDataSource<T extends object>(
  data: T,
  source: string,
): T & { _dataSource: string; _queryTime: string } {
  return {
    ...data,
    _dataSource: source,
    _queryTime: new Date().toISOString(),
  };
}
