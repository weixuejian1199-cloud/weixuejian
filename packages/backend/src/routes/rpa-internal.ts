/**
 * RPA 内部只读接口（需 RPA_INTERNAL_TOKEN）
 *
 * GET /inventory/latest/:platformId — 最近一次 inventory JSON 摘要
 *
 * 说明：触发 Playwright 采集仍用 CLI（需图形界面与本机 .env.rpa），此处仅读落盘结果。
 */
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import * as path from 'node:path';
import { z } from 'zod';
import { RPAStorage } from '../adapters/rpa/storage.js';
import { sendSuccess, sendError } from '../utils/response.js';

export const rpaInternalRouter = Router();

const platformParamSchema = z.object({
  platformId: z.string().min(1),
});

const querySchema = z.object({
  brief: z.enum(['0', '1']).optional(),
});

function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

rpaInternalRouter.get(
  '/inventory/latest/:platformId',
  asyncHandler(async (req, res) => {
    const pp = platformParamSchema.safeParse(req.params);
    if (!pp.success) {
      sendError(res, 'VALIDATION_ERROR', pp.error.issues[0]?.message ?? '无效参数', 400);
      return;
    }

    const qp = querySchema.safeParse(req.query);
    const brief = qp.success && qp.data.brief === '1';

    const dataDir = path.join(process.cwd(), 'rpa-data');
    const storage = new RPAStorage(dataDir);
    const snap = storage.getLatestInventorySnapshot(pp.data.platformId);

    if (!snap) {
      sendError(res, 'RESOURCE_NOT_FOUND', '暂无该平台的库存采集文件', 404);
      return;
    }

    if (brief) {
      sendSuccess(res, {
        platformId: pp.data.platformId,
        filepath: snap.filepath,
        savedAt: snap.savedAt,
        count: snap.count,
        records: snap.data.map((row) => ({
          source: row.source,
          syncedAt: row.syncedAt,
          rawKind: (row.rawData?.['kind'] as string) ?? 'unknown',
          pageUrl: row.rawData?.['pageUrl'] as string | undefined,
        })),
      });
      return;
    }

    sendSuccess(res, {
      platformId: pp.data.platformId,
      filepath: snap.filepath,
      savedAt: snap.savedAt,
      count: snap.count,
      data: snap.data,
    });
  }),
);
