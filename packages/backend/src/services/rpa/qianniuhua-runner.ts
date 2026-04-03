/**
 * 牵牛花 RPA 运行器 — CLI / 未来定时任务共用
 */
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { config } from 'dotenv';
import { QianniuhuaRPA } from '../../adapters/rpa/platform/qianniuhua-rpa.js';
import type {
  CollectResult,
  UnifiedInventorySignal,
} from '../../adapters/rpa/schemas.js';

config({ path: path.join(process.cwd(), '.env.rpa') });

export interface QianniuhuaRunnerOptions {
  slowMo?: number;
  headless?: boolean;
}

export function loadQianniuhuaEnv(): {
  ok: true;
  phone?: string;
  account?: string;
  password?: string;
  encryptionKey: string;
  dataDir: string;
} | { ok: false; message: string } {
  const phone = process.env['QIANNIUHUA_PHONE']?.trim();
  const account = process.env['QIANNIUHUA_ACCOUNT']?.trim();
  const password = process.env['QIANNIUHUA_PASSWORD']?.trim();

  if (!phone && !(account && password)) {
    return {
      ok: false,
      message:
        '缺少凭证：.env.rpa 需配置 QIANNIUHUA_PHONE（可选 QIANNIUHUA_ACCOUNT）或 QIANNIUHUA_ACCOUNT + QIANNIUHUA_PASSWORD',
    };
  }

  const encryptionKey =
    process.env['RPA_ENCRYPTION_KEY'] ?? crypto.randomBytes(32).toString('hex');

  return {
    ok: true,
    phone: phone || undefined,
    account: account || undefined,
    password: password || undefined,
    encryptionKey,
    dataDir: path.join(process.cwd(), 'rpa-data'),
  };
}

export function createQianniuhuaRpa(
  opts: QianniuhuaRunnerOptions = {},
): QianniuhuaRPA {
  const env = loadQianniuhuaEnv();
  if (!env.ok) {
    throw new Error(env.message);
  }
  return new QianniuhuaRPA({
    dataDir: env.dataDir,
    phone: env.phone,
    account: env.account,
    password: env.password,
    encryptionKey: env.encryptionKey,
    headless: opts.headless ?? false,
    slowMo: opts.slowMo ?? 0,
  });
}

/** 默认采集最近 7 天（日期范围供 rawData 记录；页面快照不筛选日期） */
export async function runQianniuhuaCollect(
  opts: QianniuhuaRunnerOptions = {},
): Promise<CollectResult<UnifiedInventorySignal>> {
  const rpa = createQianniuhuaRpa(opts);
  const dateTo = new Date();
  const dateFrom = new Date();
  dateFrom.setDate(dateFrom.getDate() - 7);
  return rpa.collect({ dateFrom, dateTo });
}
