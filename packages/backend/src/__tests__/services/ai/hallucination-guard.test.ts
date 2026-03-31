import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  validateResponse,
  validateNumbers,
  extractNumbersFromText,
  extractNumbersFromResults,
  buildSourceAttribution,
  buildFinanceAuditTrail,
  detectDataConflicts,
} from '../../../services/ai/hallucination-guard.js';
import type { ToolExecutionResult } from '../../../services/ai/types.js';

// ─── 辅助函数 ────────────────────────────────────────────────

function makeToolResult(
  name: string,
  result: unknown,
  overrides?: Partial<ToolExecutionResult>,
): ToolExecutionResult {
  return {
    toolCallId: `call-${name}`,
    toolName: name,
    result,
    duration: 100,
    cached: false,
    ...overrides,
  };
}

// ─── extractNumbersFromText ─────────────────────────────────

describe('extractNumbersFromText', () => {
  it('应提取普通数字', () => {
    const result = extractNumbersFromText('订单总数是1234个');
    expect(result).toEqual([{ value: 1234, text: '1234' }]);
  });

  it('应提取带千分位的数字', () => {
    const result = extractNumbersFromText('总金额为1,234,567.89元');
    expect(result).toEqual([{ value: 1234567.89, text: '1,234,567.89' }]);
  });

  it('应提取带¥符号的金额', () => {
    const result = extractNumbersFromText('销售额为¥100,000');
    expect(result).toEqual([{ value: 100000, text: '¥100,000' }]);
  });

  it('应提取百分比', () => {
    const result = extractNumbersFromText('增长了15.3%');
    expect(result).toEqual([{ value: 15.3, text: '15.3%' }]);
  });

  it('应提取多个数字', () => {
    const result = extractNumbersFromText('本月¥50,000，上月¥45,000，增长11.1%');
    expect(result).toHaveLength(3);
    expect(result.map(r => r.value)).toEqual([50000, 45000, 11.1]);
  });

  it('无数字时返回空数组', () => {
    const result = extractNumbersFromText('你好，请问有什么需要帮助的？');
    expect(result).toEqual([]);
  });
});

// ─── extractNumbersFromResults ──────────────────────────────

describe('extractNumbersFromResults', () => {
  it('应从工具结果中递归提取数字', () => {
    const results: ToolExecutionResult[] = [
      makeToolResult('getSalesStats', {
        totalAmount: 100000,
        orderCount: 350,
        avgOrderValue: 285.71,
        _dataSource: 'ztdy-open',
        _queryTime: '2026-03-31T10:00:00Z',
      }),
    ];
    const numbers = extractNumbersFromResults(results);
    expect(numbers).toContain(100000);
    expect(numbers).toContain(350);
    expect(numbers).toContain(285.71);
  });

  it('应从嵌套数组中提取数字', () => {
    const results: ToolExecutionResult[] = [
      makeToolResult('getTopSuppliers', {
        items: [
          { name: '供应商A', amount: 50000 },
          { name: '供应商B', amount: 30000 },
        ],
      }),
    ];
    const numbers = extractNumbersFromResults(results);
    expect(numbers).toContain(50000);
    expect(numbers).toContain(30000);
  });

  it('应去重', () => {
    const results: ToolExecutionResult[] = [
      makeToolResult('tool1', { value: 100 }),
      makeToolResult('tool2', { value: 100 }),
    ];
    const numbers = extractNumbersFromResults(results);
    const count100 = numbers.filter(n => n === 100).length;
    expect(count100).toBe(1);
  });

  it('应跳过错误结果', () => {
    const results: ToolExecutionResult[] = [
      makeToolResult('tool1', null, { error: '失败' }),
    ];
    const numbers = extractNumbersFromResults(results);
    expect(numbers).toEqual([]);
  });
});

// ─── validateNumbers ────────────────────────────────────────

describe('validateNumbers', () => {
  it('数字一致时返回空 mismatch', () => {
    const results: ToolExecutionResult[] = [
      makeToolResult('getSalesStats', { totalAmount: 100000, orderCount: 350 }),
    ];
    const mismatches = validateNumbers('本月销售额100,000元，共350单', results);
    expect(mismatches).toEqual([]);
  });

  it('AI编造数字时应返回 mismatch', () => {
    const results: ToolExecutionResult[] = [
      makeToolResult('getSalesStats', { totalAmount: 100000 }),
    ];
    const mismatches = validateNumbers('本月销售额200,000元', results);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]!.aiNumber).toBe(200000);
    expect(mismatches[0]!.closestToolNumber).toBe(100000);
  });

  it('小数字（<10）应被忽略', () => {
    const results: ToolExecutionResult[] = [
      makeToolResult('getSalesStats', { totalAmount: 100000 }),
    ];
    const mismatches = validateNumbers('第1页，共5条，总额100,000', results);
    expect(mismatches).toEqual([]);
  });

  it('无工具数字时返回空', () => {
    const results: ToolExecutionResult[] = [
      makeToolResult('tool1', { message: '无数据' }),
    ];
    const mismatches = validateNumbers('总计12345元', results);
    expect(mismatches).toEqual([]);
  });

  it('AI无数字时返回空', () => {
    const results: ToolExecutionResult[] = [
      makeToolResult('tool1', { totalAmount: 100000 }),
    ];
    const mismatches = validateNumbers('查询完成，数据已更新', results);
    expect(mismatches).toEqual([]);
  });

  it('微小偏差（<=1%）应通过', () => {
    const results: ToolExecutionResult[] = [
      makeToolResult('getSalesStats', { totalAmount: 100000 }),
    ];
    // 100500 vs 100000 = 0.5% 偏差
    const mismatches = validateNumbers('总额100,500元', results);
    expect(mismatches).toEqual([]);
  });
});

// ─── buildSourceAttribution ─────────────────────────────────

describe('buildSourceAttribution', () => {
  it('应从工具结果提取数据来源', () => {
    const results: ToolExecutionResult[] = [
      makeToolResult('getSalesStats', {
        totalAmount: 100000,
        _dataSource: 'ztdy-open OrderPageList API (聚合)',
        _queryTime: '2026-03-31T10:00:00.000Z',
      }),
    ];
    const attr = buildSourceAttribution(results);
    expect(attr).toContain('数据来源：');
    expect(attr).toContain('ztdy-open OrderPageList API (聚合)');
  });

  it('多个不同来源应合并', () => {
    const results: ToolExecutionResult[] = [
      makeToolResult('getSalesStats', {
        _dataSource: 'ztdy-open OrderPageList API',
        _queryTime: '2026-03-31T10:00:00Z',
      }),
      makeToolResult('getUsers', {
        _dataSource: 'ztdy-open UserPageList API',
        _queryTime: '2026-03-31T10:01:00Z',
      }),
    ];
    const attr = buildSourceAttribution(results);
    expect(attr).toContain('OrderPageList');
    expect(attr).toContain('UserPageList');
  });

  it('无_dataSource时返回null', () => {
    const results: ToolExecutionResult[] = [
      makeToolResult('tool1', { value: 123 }),
    ];
    const attr = buildSourceAttribution(results);
    expect(attr).toBeNull();
  });

  it('结果为非对象时返回null', () => {
    const results: ToolExecutionResult[] = [
      makeToolResult('tool1', 'string result'),
    ];
    const attr = buildSourceAttribution(results);
    expect(attr).toBeNull();
  });
});

// ─── buildFinanceAuditTrail ─────────────────────────────────

describe('buildFinanceAuditTrail', () => {
  const financeTool: ToolExecutionResult[] = [
    makeToolResult('getSalesStats', {
      totalAmount: 100000,
      _dataSource: 'ztdy-open OrderPageList API',
      _queryTime: '2026-03-31T10:00:00Z',
    }),
  ];

  it('finance人格应生成审计尾注', () => {
    const trail = buildFinanceAuditTrail(financeTool, 'finance');
    expect(trail).not.toBeNull();
    expect(trail).toContain('数据来源：');
    expect(trail).toContain('查询时间：');
    expect(trail).toContain('财务决策请以原始单据为准');
  });

  it('settlement人格应生成审计尾注', () => {
    const trail = buildFinanceAuditTrail(financeTool, 'settlement');
    expect(trail).not.toBeNull();
    expect(trail).toContain('数据来源：');
  });

  it('master人格不生成审计尾注', () => {
    const trail = buildFinanceAuditTrail(financeTool, 'master');
    expect(trail).toBeNull();
  });

  it('operation人格不生成审计尾注', () => {
    const trail = buildFinanceAuditTrail(financeTool, 'operation');
    expect(trail).toBeNull();
  });

  it('agentType为undefined时不生成', () => {
    const trail = buildFinanceAuditTrail(financeTool, undefined);
    expect(trail).toBeNull();
  });

  it('无_dataSource时不生成', () => {
    const results: ToolExecutionResult[] = [
      makeToolResult('tool1', { value: 100 }),
    ];
    const trail = buildFinanceAuditTrail(results, 'finance');
    expect(trail).toBeNull();
  });
});

// ─── detectDataConflicts ────────────────────────────────────

describe('detectDataConflicts', () => {
  it('单个工具无冲突', () => {
    const results: ToolExecutionResult[] = [
      makeToolResult('tool1', { totalAmount: 100000 }),
    ];
    const conflicts = detectDataConflicts(results);
    expect(conflicts).toEqual([]);
  });

  it('两个工具同名字段值一致无冲突', () => {
    const results: ToolExecutionResult[] = [
      makeToolResult('tool1', { totalAmount: 100000 }),
      makeToolResult('tool2', { totalAmount: 100000 }),
    ];
    const conflicts = detectDataConflicts(results);
    expect(conflicts).toEqual([]);
  });

  it('两个工具同名字段值差异>5%应报冲突', () => {
    const results: ToolExecutionResult[] = [
      makeToolResult('getSalesStats', { totalAmount: 100000 }),
      makeToolResult('getOrderStats', { totalAmount: 120000 }),
    ];
    const conflicts = detectDataConflicts(results);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.field).toBe('totalAmount');
    expect(conflicts[0]!.toolA.name).toBe('getSalesStats');
    expect(conflicts[0]!.toolB.name).toBe('getOrderStats');
    expect(conflicts[0]!.deviationPercent).toBeGreaterThan(5);
  });

  it('不同字段名不算冲突', () => {
    const results: ToolExecutionResult[] = [
      makeToolResult('tool1', { totalAmount: 100000 }),
      makeToolResult('tool2', { orderCount: 50000 }),
    ];
    const conflicts = detectDataConflicts(results);
    expect(conflicts).toEqual([]);
  });

  it('内部字段（_前缀）应被忽略', () => {
    const results: ToolExecutionResult[] = [
      makeToolResult('tool1', { _queryTime: 1, totalAmount: 100000 }),
      makeToolResult('tool2', { _queryTime: 2, totalAmount: 100000 }),
    ];
    const conflicts = detectDataConflicts(results);
    expect(conflicts).toEqual([]);
  });

  it('微小差异（<=5%）不算冲突', () => {
    const results: ToolExecutionResult[] = [
      makeToolResult('tool1', { totalAmount: 100000 }),
      makeToolResult('tool2', { totalAmount: 104000 }),
    ];
    const conflicts = detectDataConflicts(results);
    expect(conflicts).toEqual([]);
  });
});

// ─── validateResponse 集成测试 ──────────────────────────────

describe('validateResponse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('无工具调用时全部通过', () => {
    const result = validateResponse('你好', [], 'master');
    expect(result.passed).toBe(true);
    expect(result.numberMismatches).toEqual([]);
    expect(result.dataConflicts).toEqual([]);
    expect(result.sourceAttribution).toBeNull();
    expect(result.financeAuditTrail).toBeNull();
  });

  it('工具全部出错时全部通过', () => {
    const results: ToolExecutionResult[] = [
      makeToolResult('tool1', null, { error: '失败' }),
    ];
    const result = validateResponse('查询失败', results, 'master');
    expect(result.passed).toBe(true);
  });

  it('数字一致+无冲突应通过', () => {
    const results: ToolExecutionResult[] = [
      makeToolResult('getSalesStats', {
        totalAmount: 100000,
        orderCount: 350,
        _dataSource: 'ztdy-open API',
        _queryTime: '2026-03-31T10:00:00Z',
      }),
    ];
    const result = validateResponse(
      '本月销售额¥100,000，共350单',
      results,
      'master',
    );
    expect(result.passed).toBe(true);
    expect(result.sourceAttribution).toContain('ztdy-open API');
    expect(result.financeAuditTrail).toBeNull();
  });

  it('finance人格应返回审计尾注', () => {
    const results: ToolExecutionResult[] = [
      makeToolResult('getSalesStats', {
        totalAmount: 100000,
        _dataSource: 'ztdy-open API',
        _queryTime: '2026-03-31T10:00:00Z',
      }),
    ];
    const result = validateResponse(
      '本月销售额¥100,000',
      results,
      'finance',
    );
    expect(result.financeAuditTrail).not.toBeNull();
    expect(result.financeAuditTrail).toContain('财务决策请以原始单据为准');
  });

  it('数字不一致应返回 passed=false', () => {
    const results: ToolExecutionResult[] = [
      makeToolResult('getSalesStats', { totalAmount: 100000 }),
    ];
    const result = validateResponse(
      '本月销售额¥200,000',
      results,
      'master',
    );
    expect(result.passed).toBe(false);
    expect(result.numberMismatches.length).toBeGreaterThan(0);
  });

  it('数据冲突应返回 passed=false', () => {
    const results: ToolExecutionResult[] = [
      makeToolResult('tool1', { totalAmount: 100000 }),
      makeToolResult('tool2', { totalAmount: 200000 }),
    ];
    const result = validateResponse('数据如上', results, 'master');
    expect(result.passed).toBe(false);
    expect(result.dataConflicts.length).toBeGreaterThan(0);
  });
});
