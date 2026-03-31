import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock logger
vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

import { refreshHourly, refreshDaily, REFRESH_INTERVALS, startCacheRefreshJobs } from '../../jobs/cache-refresh.js';
import { logger } from '../../utils/logger.js';

describe('cache-refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('REFRESH_INTERVALS', () => {
    it('HOURLY应为1小时', () => {
      expect(REFRESH_INTERVALS.HOURLY).toBe(3_600_000);
    });

    it('DAILY应为24小时', () => {
      expect(REFRESH_INTERVALS.DAILY).toBe(86_400_000);
    });
  });

  describe('refreshHourly', () => {
    it('应记录开始和完成日志', async () => {
      await refreshHourly();

      expect(logger.info).toHaveBeenCalledWith('Cache refresh (hourly) started');
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ duration: expect.any(Number) }),
        'Cache refresh (hourly) completed',
      );
    });
  });

  describe('refreshDaily', () => {
    it('应记录开始和完成日志', async () => {
      await refreshDaily();

      expect(logger.info).toHaveBeenCalledWith('Cache refresh (daily) started');
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ duration: expect.any(Number) }),
        'Cache refresh (daily) completed',
      );
    });
  });

  describe('startCacheRefreshJobs', () => {
    it('应记录调度日志', () => {
      startCacheRefreshJobs();
      expect(logger.info).toHaveBeenCalledWith(
        'Cache refresh jobs scheduled (hourly + daily@3am)',
      );
    });

    it('应在30秒后执行首次预热', () => {
      startCacheRefreshJobs();

      // 30秒前不应执行
      expect(logger.info).toHaveBeenCalledTimes(1); // 仅调度日志

      // 推进30秒
      vi.advanceTimersByTime(30_000);

      // refreshHourly被调用（异步，但logger.info会增加）
      expect(logger.info).toHaveBeenCalledWith('Cache refresh (hourly) started');
    });

    it('应设置每小时重复定时器', () => {
      startCacheRefreshJobs();

      // 跳过首次30秒延迟
      vi.advanceTimersByTime(30_000);
      vi.clearAllMocks();

      // 推进1小时
      vi.advanceTimersByTime(REFRESH_INTERVALS.HOURLY);
      expect(logger.info).toHaveBeenCalledWith('Cache refresh (hourly) started');
    });
  });
});
