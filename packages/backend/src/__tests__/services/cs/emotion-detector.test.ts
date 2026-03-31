import { describe, it, expect } from 'vitest';
import { detectEmotion, detectRefundIntent } from '../../../services/cs/emotion-detector.js';

describe('detectEmotion', () => {
  it('should return high for single high-intensity keyword', () => {
    const result = detectEmotion('我要投诉你们');
    expect(result.level).toBe('high');
    expect(result.highCount).toBeGreaterThanOrEqual(1);
    expect(result.matchedKeywords).toContain('投诉');
  });

  it('should return high for "12315"', () => {
    const result = detectEmotion('我要打12315');
    expect(result.level).toBe('high');
    expect(result.matchedKeywords).toContain('12315');
  });

  it('should return high for >=2 medium-intensity keywords', () => {
    const result = detectEmotion('太慢了，真是垃圾服务');
    expect(result.level).toBe('high');
    expect(result.mediumCount).toBeGreaterThanOrEqual(2);
  });

  it('should return medium for single medium-intensity keyword', () => {
    const result = detectEmotion('我很失望');
    expect(result.level).toBe('medium');
    expect(result.mediumCount).toBe(1);
  });

  it('should return none for neutral message', () => {
    const result = detectEmotion('请问什么时候发货？');
    expect(result.level).toBe('none');
    expect(result.matchedKeywords).toHaveLength(0);
  });

  it('should exclude negated emotion keywords', () => {
    const result = detectEmotion('不想投诉，就是问一下');
    expect(result.level).toBe('none');
    expect(result.matchedKeywords).toHaveLength(0);
  });

  it('should exclude "没有" negation', () => {
    const result = detectEmotion('没有生气，只是想了解情况');
    expect(result.level).toBe('none');
  });

  it('should detect multiple high keywords', () => {
    const result = detectEmotion('要投诉，要曝光到媒体');
    expect(result.level).toBe('high');
    expect(result.highCount).toBeGreaterThanOrEqual(2);
  });

  it('should handle empty string', () => {
    const result = detectEmotion('');
    expect(result.level).toBe('none');
    expect(result.matchedKeywords).toHaveLength(0);
  });

  it('should handle mixed high and medium keywords', () => {
    const result = detectEmotion('垃圾服务，我要找消协');
    expect(result.level).toBe('high');
    expect(result.highCount).toBeGreaterThanOrEqual(1);
    expect(result.mediumCount).toBeGreaterThanOrEqual(1);
  });
});

describe('detectRefundIntent', () => {
  it('should detect "退款"', () => {
    const result = detectRefundIntent('我要退款');
    expect(result.detected).toBe(true);
    expect(result.matchedKeywords).toContain('退款');
  });

  it('should detect "赔偿"', () => {
    const result = detectRefundIntent('要求赔偿损失');
    expect(result.detected).toBe(true);
    expect(result.matchedKeywords).toContain('赔偿');
  });

  it('should detect "补偿"', () => {
    const result = detectRefundIntent('应该给我补偿');
    expect(result.detected).toBe(true);
  });

  it('should not detect in normal message', () => {
    const result = detectRefundIntent('什么时候发货');
    expect(result.detected).toBe(false);
    expect(result.matchedKeywords).toHaveLength(0);
  });

  it('should exclude negated refund intent', () => {
    const result = detectRefundIntent('不想退款，只是问问');
    expect(result.detected).toBe(false);
  });
});
