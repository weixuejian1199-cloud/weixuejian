import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildSystemPrompt } from '../../../services/ai/system-prompt.js';
import type { AgentType } from '@prisma/client';

const baseCtx = {
  userName: '测试用户',
  role: 'owner',
  tenantName: '时皙',
};

describe('buildSystemPrompt', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('master persona (backward compatibility)', () => {
    it('should return master prompt when agentType is undefined', () => {
      const prompt = buildSystemPrompt(baseCtx);
      expect(prompt).toContain('你叫灵犀，是时皙的AI助手');
      expect(prompt).toContain('像同事微信聊天');
    });

    it('should return master prompt when agentType is master', () => {
      const prompt = buildSystemPrompt({ ...baseCtx, agentType: 'master' });
      expect(prompt).toContain('你叫灵犀，是时皙的AI助手');
    });

    it('master prompt includes data rules', () => {
      const prompt = buildSystemPrompt(baseCtx);
      expect(prompt).toContain('所有数字必须来自工具返回，严禁编造');
      expect(prompt).toContain('_dataSource/_queryTime是内部字段');
    });

    it('master prompt includes user context', () => {
      const prompt = buildSystemPrompt(baseCtx);
      expect(prompt).toContain('测试用户(owner)');
    });

    it('master prompt includes timestamp', () => {
      vi.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('2026/3/31 17:00:00');
      const prompt = buildSystemPrompt(baseCtx);
      expect(prompt).toContain('2026/3/31 17:00:00');
    });

    it('master and undefined produce identical prompts', () => {
      vi.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('固定时间');
      const masterPrompt = buildSystemPrompt({ ...baseCtx, agentType: 'master' });
      const defaultPrompt = buildSystemPrompt(baseCtx);
      expect(masterPrompt).toBe(defaultPrompt);
    });
  });

  describe('finance persona', () => {
    it('should use 账房先生 name', () => {
      const prompt = buildSystemPrompt({ ...baseCtx, agentType: 'finance' });
      expect(prompt).toContain('你叫账房先生');
    });

    it('should include financial behavior rules', () => {
      const prompt = buildSystemPrompt({ ...baseCtx, agentType: 'finance' });
      expect(prompt).toContain('计算口径');
    });

    it('should include boundaries', () => {
      const prompt = buildSystemPrompt({ ...baseCtx, agentType: 'finance' });
      expect(prompt).toContain('不给税务建议');
    });

    it('should include shared data rules', () => {
      const prompt = buildSystemPrompt({ ...baseCtx, agentType: 'finance' });
      expect(prompt).toContain('所有数字必须来自工具返回，严禁编造');
    });
  });

  describe('operation persona', () => {
    it('should use 运营搭子 name', () => {
      const prompt = buildSystemPrompt({ ...baseCtx, agentType: 'operation' });
      expect(prompt).toContain('你叫运营搭子');
    });

    it('should include actionable suggestions rule', () => {
      const prompt = buildSystemPrompt({ ...baseCtx, agentType: 'operation' });
      expect(prompt).toContain('可执行建议');
    });
  });

  describe('customer_service persona', () => {
    it('should use 客服小灵 name', () => {
      const prompt = buildSystemPrompt({ ...baseCtx, agentType: 'customer_service' });
      expect(prompt).toContain('你叫客服小灵');
    });

    it('should include empathetic tone', () => {
      const prompt = buildSystemPrompt({ ...baseCtx, agentType: 'customer_service' });
      expect(prompt).toContain('温暖耐心');
    });
  });

  describe('all personas share data rules', () => {
    const nonMasterTypes: AgentType[] = [
      'finance', 'operation', 'report', 'customer_service', 'system', 'tool',
    ];

    it.each(nonMasterTypes)('%s includes hallucination guard', (agentType) => {
      const prompt = buildSystemPrompt({ ...baseCtx, agentType });
      expect(prompt).toContain('严禁编造');
      expect(prompt).toContain('_dataSource/_queryTime是内部字段');
    });

    it.each(nonMasterTypes)('%s includes real data declaration', (agentType) => {
      const prompt = buildSystemPrompt({ ...baseCtx, agentType });
      expect(prompt).toContain('极速订货');
    });
  });
});
