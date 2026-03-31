/**
 * AI 工具注册表
 *
 * 定义 AI 可调用的工具函数 + 执行映射。
 * Phase 1: 6 个工具 = 3 个聚合函数 + 3 个原始查询。
 *
 * 幻觉防护：工具结果附加数据来源和查询时间。
 */
import { MallAdapter } from '../../adapters/erp/mall-adapter.js';
import * as aggregates from '../mall/aggregates.js';
import { logger } from '../../utils/logger.js';
import type { ToolDefinition, ToolExecutionResult } from './types.js';

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
];

// ─── 工具执行器 ──────────────────────────────────────────

type ToolHandler = (
  adapter: MallAdapter,
  tenantId: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

const toolHandlers: Record<string, ToolHandler> = {
  async getSalesStats(adapter, tenantId, args) {
    const result = await aggregates.getSalesStats(adapter, tenantId, {
      start: args['startDate'] as string,
      end: args['endDate'] as string,
    });
    return attachDataSource(result, 'ztdy-open OrderPageList API (聚合)');
  },

  async getTopSuppliers(adapter, tenantId, args) {
    const result = await aggregates.getTopSuppliers(
      adapter,
      tenantId,
      args['metric'] as 'orderCount' | 'amount',
      (args['limit'] as number) ?? 10,
    );
    return attachDataSource(result, 'ztdy-open OrderPageList API (聚合)');
  },

  async getOrderStatusDistribution(adapter, tenantId, args) {
    const dateRange = args['startDate']
      ? { start: args['startDate'] as string, end: args['endDate'] as string }
      : undefined;
    const result = await aggregates.getOrderStatusDistribution(adapter, tenantId, dateRange);
    return attachDataSource(result, 'ztdy-open OrderPageList API (聚合)');
  },

  async getOrders(adapter, _tenantId, args) {
    const result = await adapter.getOrders({
      pageIndex: (args['pageIndex'] as number) ?? 1,
      pageSize: Math.min((args['pageSize'] as number) ?? 20, 50),
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
      pageIndex: (args['pageIndex'] as number) ?? 1,
      pageSize: Math.min((args['pageSize'] as number) ?? 20, 50),
      keyword: args['keyword'] as string | undefined,
      levelId: args['levelId'] as number | undefined,
    });
    return attachDataSource(result, 'ztdy-open UserPageList API');
  },

  async getItems(adapter, _tenantId, args) {
    const result = await adapter.getItems({
      pageIndex: (args['pageIndex'] as number) ?? 1,
      pageSize: Math.min((args['pageSize'] as number) ?? 20, 50),
      keyword: args['keyword'] as string | undefined,
      isShelf: args['isShelf'] as boolean | undefined,
    });
    return attachDataSource(result, 'ztdy-open ItemPageList API');
  },
};

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

  let args: Record<string, unknown>;
  try {
    args = JSON.parse(argsJson) as Record<string, unknown>;
  } catch {
    return {
      toolCallId,
      toolName,
      result: null,
      duration: Date.now() - startTime,
      cached: false,
      error: `Invalid tool arguments: ${argsJson}`,
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
function attachDataSource<T>(
  data: T,
  source: string,
): T & { _dataSource: string; _queryTime: string } {
  return {
    ...(data as object),
    _dataSource: source,
    _queryTime: new Date().toISOString(),
  } as T & { _dataSource: string; _queryTime: string };
}
