import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../lib/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    ZTDY_API_BASE_URL: 'https://admin.ztdy.cc',
    ZTDY_API_KEY: 'test-key',
    MALL_CACHE_TTL: 300,
  },
}));
vi.mock('../../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../../lib/redis.js', () => ({
  redis: { get: vi.fn(), set: vi.fn(), del: vi.fn() },
}));
vi.mock('../../../lib/prisma.js', () => ({
  prisma: {},
}));

import { BUILTIN_TOOL_SEEDS, TOOL_META_CATEGORIES, BUILTIN_TOOL_HANDLERS, BUILTIN_PARAM_SCHEMAS } from '../../../services/tool-market/builtin-tools.js';
import { TOOL_DEFINITIONS } from '../../../services/ai/tool-registry.js';

describe('builtin-tools metadata', () => {
  it('should have exactly 9 built-in tool seeds', () => {
    expect(BUILTIN_TOOL_SEEDS).toHaveLength(9);
  });

  it('should have a seed for every TOOL_DEFINITION', () => {
    const seedNames = BUILTIN_TOOL_SEEDS.map(s => s.name).sort();
    const defNames = TOOL_DEFINITIONS.map(d => d.function.name).sort();
    expect(seedNames).toEqual(defNames);
  });

  it('every seed should have required fields', () => {
    for (const seed of BUILTIN_TOOL_SEEDS) {
      expect(seed.name).toBeTruthy();
      expect(seed.displayName).toBeTruthy();
      expect(seed.description).toBeTruthy();
      expect(seed.category).toBeTruthy();
      expect(seed.version).toBe('1.0.0');
      expect(seed.permissions).toEqual(['data:read']);
      expect(seed.parameters).toBeDefined();
    }
  });

  it('every seed category should be a valid ToolCategory', () => {
    const validCategories = ['health', 'finance', 'operation', 'cs', 'analytics'];
    for (const seed of BUILTIN_TOOL_SEEDS) {
      expect(validCategories).toContain(seed.category);
    }
  });

  it('TOOL_META_CATEGORIES should map all 9 tools', () => {
    expect(Object.keys(TOOL_META_CATEGORIES)).toHaveLength(9);
    for (const seed of BUILTIN_TOOL_SEEDS) {
      expect(TOOL_META_CATEGORIES[seed.name]).toBe(seed.category);
    }
  });

  it('every tool should have a handler', () => {
    for (const seed of BUILTIN_TOOL_SEEDS) {
      expect(BUILTIN_TOOL_HANDLERS[seed.name]).toBeDefined();
      expect(typeof BUILTIN_TOOL_HANDLERS[seed.name]).toBe('function');
    }
  });

  it('every tool should have a param schema', () => {
    for (const seed of BUILTIN_TOOL_SEEDS) {
      expect(BUILTIN_PARAM_SCHEMAS[seed.name]).toBeDefined();
    }
  });

  it('displayNames should be unique', () => {
    const names = BUILTIN_TOOL_SEEDS.map(s => s.displayName);
    expect(new Set(names).size).toBe(names.length);
  });
});
