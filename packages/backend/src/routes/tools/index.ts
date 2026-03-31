/**
 * 工具市场路由
 *
 * Phase 2a: BL-009 工具市场 MVP
 *
 * GET    /api/v1/tools              — 工具目录（分页）
 * GET    /api/v1/tools/:id          — 工具详情
 * POST   /api/v1/tools/:id/activate — 激活工具（幂等）
 * POST   /api/v1/tools/:id/deactivate — 停用工具（幂等）
 * GET    /api/v1/tools/instances    — 已激活工具列表
 * GET    /api/v1/tools/instances/:id — 实例详情
 */
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  listToolDefinitions,
  getToolDefinitionById,
} from '../../services/tool-market/tool-definition-service.js';
import {
  activateTool,
  deactivateTool,
  listActiveInstances,
  getInstanceById,
} from '../../services/tool-market/tool-instance-service.js';
import { sendSuccess, sendError } from '../../utils/response.js';

export const toolsRouter = Router();

function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

// ─── Zod Schemas ────────────────────────────────────────

const listQuerySchema = z.object({
  category: z.enum(['health', 'finance', 'operation', 'cs', 'analytics']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

const activateBodySchema = z.object({
  config: z.record(z.unknown()).optional(),
});

// ─── GET / — 工具目录 ───────────────────────────────────

toolsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      sendError(res, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? '参数校验失败', 400);
      return;
    }

    const result = await listToolDefinitions(req.tenantId!, parsed.data);
    sendSuccess(res, result);
  }),
);

// ─── GET /instances — 已激活工具列表（必须在 /:id 之前）──

toolsRouter.get(
  '/instances',
  asyncHandler(async (req, res) => {
    const instances = await listActiveInstances(req.tenantId!);
    sendSuccess(res, { items: instances, total: instances.length });
  }),
);

// ─── GET /instances/:id — 实例详情 ──────────────────────

toolsRouter.get(
  '/instances/:id',
  asyncHandler(async (req, res) => {
    const instance = await getInstanceById(String(req.params['id']), req.tenantId!);
    if (!instance) {
      sendError(res, 'TOOL_INSTANCE_NOT_FOUND', undefined, 404);
      return;
    }
    sendSuccess(res, instance);
  }),
);

// ─── GET /:id — 工具详情 ────────────────────────────────

toolsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const def = await getToolDefinitionById(String(req.params['id']), req.tenantId!);
    if (!def) {
      sendError(res, 'TOOL_NOT_FOUND', undefined, 404);
      return;
    }
    sendSuccess(res, def);
  }),
);

// ─── POST /:id/activate — 激活工具 ─────────────────────

toolsRouter.post(
  '/:id/activate',
  asyncHandler(async (req, res) => {
    const parsed = activateBodySchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? '参数校验失败', 400);
      return;
    }

    const instance = await activateTool(
      req.tenantId!,
      String(req.params['id']),
      parsed.data.config as never,
    );

    if (!instance) {
      sendError(res, 'TOOL_NOT_FOUND', undefined, 404);
      return;
    }

    sendSuccess(res, instance);
  }),
);

// ─── POST /:id/deactivate — 停用工具 ───────────────────

toolsRouter.post(
  '/:id/deactivate',
  asyncHandler(async (req, res) => {
    await deactivateTool(req.tenantId!, String(req.params['id']));
    sendSuccess(res, { message: '工具已停用' });
  }),
);
