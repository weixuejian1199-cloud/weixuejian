/**
 * 工具解析器 — DB驱动的工具发现 + 执行委托
 *
 * 桥接层：连接 DB 的 ToolDefinition/ToolInstance 和 tool-registry 的执行器。
 * 降级策略：DB无数据时回退到硬编码 TOOL_DEFINITIONS。
 *
 * Phase 2a: BL-009 工具市场 MVP
 */
import { listActiveInstances } from './tool-instance-service.js';
import {
  BUILTIN_TOOL_HANDLERS,
  BUILTIN_PARAM_SCHEMAS,
} from './builtin-tools.js';
import {
  TOOL_DEFINITIONS,
  executeTool,
} from '../ai/tool-registry.js';
import { logger } from '../../utils/logger.js';
import type { ToolDefinition, ToolExecutionResult } from '../ai/types.js';

/**
 * 获取租户已激活的工具定义（OpenAI格式）
 *
 * 降级策略：DB无数据 → 返回硬编码 TOOL_DEFINITIONS
 */
export async function getActiveToolDefinitions(tenantId: string): Promise<ToolDefinition[]> {
  try {
    const instances = await listActiveInstances(tenantId);

    // 降级：DB无记录（种子未跑/新租户）→ 硬编码
    if (instances.length === 0) {
      logger.debug({ tenantId }, '[tool-resolver] No active instances, falling back to hardcoded tools');
      return TOOL_DEFINITIONS;
    }

    // 将 DB ToolDefinition → OpenAI格式
    return instances.map((inst) => {
      const def = inst.toolDefinition;
      return {
        type: 'function' as const,
        function: {
          name: def.name,
          description: def.description ?? '',
          parameters: (def.configSchema as Record<string, unknown>) ?? { type: 'object', properties: {} },
        },
      };
    });
  } catch (err) {
    // fail-secure: DB查询失败 → 降级到硬编码（不中断服务）
    logger.error({ err, tenantId }, '[tool-resolver] Failed to query active tools, falling back');
    return TOOL_DEFINITIONS;
  }
}

/**
 * 解析并执行工具调用
 *
 * 内置工具 → 委托给 tool-registry 的 executeTool
 * 未知工具 → 返回错误
 */
export async function resolveAndExecuteTool(
  toolCallId: string,
  toolName: string,
  argsJson: string,
  tenantId: string,
): Promise<ToolExecutionResult> {
  // 内置工具：委托给现有执行器（行为零变化）
  if (BUILTIN_TOOL_HANDLERS[toolName]) {
    return executeTool(toolCallId, toolName, argsJson, tenantId);
  }

  // 未知工具（Phase 2扩展点）
  logger.warn({ toolName, tenantId }, '[tool-resolver] Unknown tool requested');
  return {
    toolCallId,
    toolName,
    result: null,
    duration: 0,
    cached: false,
    error: `未知工具: ${toolName}`,
  };
}
