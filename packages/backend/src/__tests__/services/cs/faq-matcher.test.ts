import { describe, it, expect } from 'vitest';
import { matchFaq, getFaqCount } from '../../../services/cs/faq-matcher.js';

describe('matchFaq', () => {
  it('should have at least 15 FAQ entries', () => {
    expect(getFaqCount()).toBeGreaterThanOrEqual(15);
  });

  it('should match shipping question "什么时候发货"', () => {
    const result = matchFaq('什么时候发货？');
    expect(result).not.toBeNull();
    expect(result!.category).toBe('shipping');
    expect(result!.isReturnRelated).toBe(false);
  });

  it('should match return question "怎么退货"', () => {
    const result = matchFaq('我想退货');
    expect(result).not.toBeNull();
    expect(result!.category).toBe('return');
    expect(result!.isReturnRelated).toBe(true);
  });

  it('should mark return-related FAQ with isReturnRelated=true', () => {
    const result = matchFaq('东西坏了有质量问题');
    expect(result).not.toBeNull();
    expect(result!.isReturnRelated).toBe(true);
  });

  it('should match synonym "啥时候发"', () => {
    const result = matchFaq('啥时候发货啊');
    expect(result).not.toBeNull();
    expect(result!.category).toBe('shipping');
  });

  it('should match product question "保质期"', () => {
    const result = matchFaq('这个保质期多长');
    expect(result).not.toBeNull();
    expect(result!.category).toBe('product');
  });

  it('should return null for unrecognized message', () => {
    const result = matchFaq('你好');
    expect(result).toBeNull();
  });

  it('should return null for empty string', () => {
    const result = matchFaq('');
    expect(result).toBeNull();
  });

  it('should have confidence between 0 and 1', () => {
    const result = matchFaq('我想退货退款');
    expect(result).not.toBeNull();
    expect(result!.confidence).toBeGreaterThan(0);
    expect(result!.confidence).toBeLessThanOrEqual(1);
  });
});
