/**
 * RPA 数据存储 — Wave 1 JSON 文件暂存
 *
 * Wave 1: 采集数据存为 JSON 文件（按平台/日期组织）
 * Wave 2: 迁移到 PostgreSQL unified_transactions 表
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  UnifiedTransaction,
  UnifiedSettlement,
  UnifiedInventorySignal,
} from './schemas.js';

const DEFAULT_DATA_DIR = path.join(process.cwd(), 'rpa-data');

export class RPAStorage {
  private readonly dataDir: string;

  constructor(dataDir = DEFAULT_DATA_DIR) {
    this.dataDir = dataDir;
    fs.mkdirSync(this.dataDir, { recursive: true });
  }

  /** 保存银行流水 */
  saveTransactions(
    platformId: string,
    transactions: UnifiedTransaction[],
  ): string {
    const dir = path.join(this.dataDir, 'transactions', platformId);
    fs.mkdirSync(dir, { recursive: true });

    const filename = `${new Date().toISOString().slice(0, 10)}_${Date.now()}.json`;
    const filepath = path.join(dir, filename);

    fs.writeFileSync(
      filepath,
      JSON.stringify(
        {
          platformId,
          savedAt: new Date().toISOString(),
          count: transactions.length,
          data: transactions,
        },
        null,
        2,
      ),
      'utf-8',
    );

    return filepath;
  }

  /** 保存结算单 */
  saveSettlements(
    platformId: string,
    settlements: UnifiedSettlement[],
  ): string {
    const dir = path.join(this.dataDir, 'settlements', platformId);
    fs.mkdirSync(dir, { recursive: true });

    const filename = `${new Date().toISOString().slice(0, 10)}_${Date.now()}.json`;
    const filepath = path.join(dir, filename);

    fs.writeFileSync(
      filepath,
      JSON.stringify(
        {
          platformId,
          savedAt: new Date().toISOString(),
          count: settlements.length,
          data: settlements,
        },
        null,
        2,
      ),
      'utf-8',
    );

    return filepath;
  }

  /** 保存库存/补货信号（牵牛花等） */
  saveInventorySignals(
    platformId: string,
    rows: UnifiedInventorySignal[],
  ): string {
    const dir = path.join(this.dataDir, 'inventory', platformId);
    fs.mkdirSync(dir, { recursive: true });

    const filename = `${new Date().toISOString().slice(0, 10)}_${Date.now()}.json`;
    const filepath = path.join(dir, filename);

    fs.writeFileSync(
      filepath,
      JSON.stringify(
        {
          platformId,
          savedAt: new Date().toISOString(),
          count: rows.length,
          data: rows,
        },
        null,
        2,
      ),
      'utf-8',
    );

    return filepath;
  }

  /** 读取最近一次采集的数据 */
  getLatestTransactions(platformId: string): UnifiedTransaction[] | null {
    const dir = path.join(this.dataDir, 'transactions', platformId);
    if (!fs.existsSync(dir)) return null;

    const files = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .reverse();

    if (files.length === 0) return null;

    const content = fs.readFileSync(path.join(dir, files[0]!), 'utf-8');
    const parsed = JSON.parse(content);
    return parsed.data as UnifiedTransaction[];
  }

  /** 读取最近一次库存/补货信号文件（含 savedAt / 路径） */
  getLatestInventorySnapshot(platformId: string): {
    filepath: string;
    savedAt: string;
    count: number;
    data: UnifiedInventorySignal[];
  } | null {
    const dir = path.join(this.dataDir, 'inventory', platformId);
    if (!fs.existsSync(dir)) return null;

    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .reverse();

    if (files.length === 0) return null;

    const filepath = path.join(dir, files[0]!);
    const content = fs.readFileSync(filepath, 'utf-8');
    const parsed = JSON.parse(content) as {
      savedAt: string;
      count: number;
      data: UnifiedInventorySignal[];
    };
    return {
      filepath,
      savedAt: parsed.savedAt,
      count: parsed.count,
      data: parsed.data,
    };
  }

  /** 列出所有已保存的文件 */
  listFiles(
    category: 'transactions' | 'settlements' | 'inventory',
    platformId?: string,
  ): string[] {
    const baseDir = path.join(this.dataDir, category);
    if (!fs.existsSync(baseDir)) return [];

    if (platformId) {
      const dir = path.join(baseDir, platformId);
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    }

    // 列出所有平台
    const platforms = fs.readdirSync(baseDir);
    const files: string[] = [];
    for (const platform of platforms) {
      const dir = path.join(baseDir, platform);
      if (fs.statSync(dir).isDirectory()) {
        const platformFiles = fs.readdirSync(dir)
          .filter((f) => f.endsWith('.json'))
          .map((f) => `${platform}/${f}`);
        files.push(...platformFiles);
      }
    }
    return files;
  }
}
