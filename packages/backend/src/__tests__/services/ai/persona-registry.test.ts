import { describe, it, expect } from 'vitest';
import { getPersona, getAllPersonas } from '../../../services/ai/persona-registry.js';
import type { AgentType } from '@prisma/client';

const ALL_AGENT_TYPES: AgentType[] = [
  'master', 'finance', 'operation', 'settlement', 'report',
  'customer_service', 'system', 'tool',
];

const VALID_TOOL_CATEGORIES = ['health', 'finance', 'operation', 'cs', 'analytics'];

describe('persona-registry', () => {
  describe('getPersona', () => {
    it.each(ALL_AGENT_TYPES)('should return persona for %s', (agentType) => {
      const persona = getPersona(agentType);
      expect(persona).toBeDefined();
      expect(persona.agentType).toBe(agentType);
    });

    it('should return master persona for unknown type', () => {
      const persona = getPersona('unknown_type' as AgentType);
      expect(persona.agentType).toBe('master');
      expect(persona.name).toBe('灵犀');
    });

    it('should return correct name for each persona', () => {
      expect(getPersona('master').name).toBe('灵犀');
      expect(getPersona('finance').name).toBe('账房先生');
      expect(getPersona('operation').name).toBe('运营搭子');
      expect(getPersona('settlement').name).toBe('结算助手');
      expect(getPersona('report').name).toBe('报表官');
      expect(getPersona('customer_service').name).toBe('客服小灵');
      expect(getPersona('system').name).toBe('系统管家');
      expect(getPersona('tool').name).toBe('工具助手');
    });
  });

  describe('persona completeness', () => {
    it.each(ALL_AGENT_TYPES)('%s has non-empty name and toneRules', (agentType) => {
      const persona = getPersona(agentType);
      expect(persona.name.length).toBeGreaterThan(0);
      expect(persona.toneRules.length).toBeGreaterThan(0);
    });

    it.each(ALL_AGENT_TYPES)('%s has non-empty greeting', (agentType) => {
      const persona = getPersona(agentType);
      expect(persona.greeting.length).toBeGreaterThan(0);
    });

    it.each(
      ALL_AGENT_TYPES.filter(t => t !== 'master'),
    )('non-master persona %s has boundaries', (agentType) => {
      const persona = getPersona(agentType);
      expect(persona.boundaries.length).toBeGreaterThan(0);
    });
  });

  describe('toolCategories validation', () => {
    it.each(ALL_AGENT_TYPES)('%s toolCategories are valid ToolCategory values', (agentType) => {
      const persona = getPersona(agentType);
      for (const cat of persona.toolCategories) {
        expect(VALID_TOOL_CATEGORIES).toContain(cat);
      }
    });

    it('master has empty toolCategories (all tools)', () => {
      expect(getPersona('master').toolCategories).toEqual([]);
    });

    it('finance has finance+analytics', () => {
      expect(getPersona('finance').toolCategories).toEqual(['finance', 'analytics']);
    });

    it('operation has operation+analytics', () => {
      expect(getPersona('operation').toolCategories).toEqual(['operation', 'analytics']);
    });

    it('report has analytics only', () => {
      expect(getPersona('report').toolCategories).toEqual(['analytics']);
    });

    it('customer_service has operation only', () => {
      expect(getPersona('customer_service').toolCategories).toEqual(['operation']);
    });
  });

  describe('getAllPersonas', () => {
    it('returns all 8 personas', () => {
      const all = getAllPersonas();
      expect(all).toHaveLength(8);
    });

    it('includes every AgentType', () => {
      const all = getAllPersonas();
      const types = all.map(p => p.agentType);
      for (const t of ALL_AGENT_TYPES) {
        expect(types).toContain(t);
      }
    });
  });
});
