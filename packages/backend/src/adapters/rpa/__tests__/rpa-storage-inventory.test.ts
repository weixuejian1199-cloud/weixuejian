import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RPAStorage } from '../storage.js';
import type { UnifiedInventorySignal } from '../schemas.js';

describe('RPAStorage inventory snapshot', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpa-inv-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('getLatestInventorySnapshot returns last file', () => {
    const storage = new RPAStorage(tmpDir);
    const row: UnifiedInventorySignal = {
      source: 'qianniuhua',
      rawData: { kind: 'page_snapshot', pageUrl: 'https://example.com' },
      syncedAt: new Date('2026-04-03T12:00:00Z'),
    };
    storage.saveInventorySignals('qianniuhua', [row]);

    const snap = storage.getLatestInventorySnapshot('qianniuhua');
    expect(snap).not.toBeNull();
    expect(snap!.count).toBe(1);
    expect(snap!.data[0]?.rawData['pageUrl']).toBe('https://example.com');
    expect(snap!.filepath).toContain('inventory/qianniuhua');
  });
});
