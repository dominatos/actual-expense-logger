import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { loadRules, saveRule, deleteRule, matchRule } from '../src/rules';

const TEST_DIR = '/tmp/test-rules';
const TEST_RULES_PATH = join(TEST_DIR, 'ocr-rules.json');

describe('rules', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env['ACTUAL_DATA_DIR'] = TEST_DIR;
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    process.env = originalEnv;
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  describe('loadRules', () => {
    it('returns empty array when file does not exist', () => {
      expect(loadRules()).toEqual([]);
    });

    it('throws when file contains invalid JSON', () => {
      writeFileSync(TEST_RULES_PATH, 'not-json', 'utf8');
      expect(() => loadRules()).toThrow();
    });

    it('throws when rules key is missing', () => {
      writeFileSync(TEST_RULES_PATH, '{"other": []}', 'utf8');
      expect(() => loadRules()).toThrow(/Malformed rules file/);
    });

    it('loads rules from file', () => {
      const rules = {
        rules: [
          { id: '1', pattern: 'NETFLIX', categoryId: 'cat-1', categoryName: 'Subscriptions', createdAt: '2026-01-01T00:00:00Z' },
        ],
      };
      writeFileSync(TEST_RULES_PATH, JSON.stringify(rules), 'utf8');
      expect(loadRules()).toEqual(rules.rules);
    });

    it('throws when categoryName is blank', () => {
      const rules = {
        rules: [
          { id: '1', pattern: 'NETFLIX', categoryId: 'cat-1', categoryName: '', createdAt: '2026-01-01T00:00:00Z' },
        ],
      };
      writeFileSync(TEST_RULES_PATH, JSON.stringify(rules), 'utf8');
      expect(() => loadRules()).toThrow(/Malformed rules file/);
    });
  });

  describe('saveRule', () => {
    it('creates a new rule and persists to file', () => {
      const rule = saveRule('netflix', 'cat-1', 'Subscriptions');
      expect(rule.pattern).toBe('NETFLIX');
      expect(rule.categoryId).toBe('cat-1');
      expect(rule.categoryName).toBe('Subscriptions');
      expect(rule.id).toBeDefined();
      expect(rule.createdAt).toBeDefined();

      const saved = loadRules();
      expect(saved).toHaveLength(1);
      expect(saved[0].pattern).toBe('NETFLIX');
    });

    it('replaces existing rule with same pattern', () => {
      saveRule('netflix', 'cat-1', 'Subscriptions');
      saveRule('netflix', 'cat-2', 'Entertainment');

      const saved = loadRules();
      expect(saved).toHaveLength(1);
      expect(saved[0].categoryId).toBe('cat-2');
    });

    it('normalizes pattern to uppercase', () => {
      const rule = saveRule('uber eats', 'cat-1', 'Food');
      expect(rule.pattern).toBe('UBER EATS');
    });

    it('rejects empty pattern', () => {
      expect(() => saveRule('', 'cat-1', 'Food')).toThrow('Rule pattern must not be empty or whitespace-only');
      expect(loadRules()).toEqual([]);
    });

    it('rejects whitespace-only pattern', () => {
      expect(() => saveRule('   ', 'cat-1', 'Food')).toThrow('Rule pattern must not be empty or whitespace-only');
      expect(loadRules()).toEqual([]);
    });

    it('rejects empty categoryId', () => {
      expect(() => saveRule('NETFLIX', '', 'Subscriptions')).toThrow('Rule categoryId must not be empty or whitespace-only');
      expect(loadRules()).toEqual([]);
    });

    it('rejects whitespace-only categoryId', () => {
      expect(() => saveRule('NETFLIX', '  ', 'Subscriptions')).toThrow('Rule categoryId must not be empty or whitespace-only');
      expect(loadRules()).toEqual([]);
    });

    it('rejects empty categoryName', () => {
      expect(() => saveRule('NETFLIX', 'cat-1', '')).toThrow('Rule categoryName must not be empty or whitespace-only');
      expect(loadRules()).toEqual([]);
    });

    it('rejects whitespace-only categoryName', () => {
      expect(() => saveRule('NETFLIX', 'cat-1', '  ')).toThrow('Rule categoryName must not be empty or whitespace-only');
      expect(loadRules()).toEqual([]);
    });

    it('trims whitespace from categoryId and categoryName', () => {
      const rule = saveRule('netflix', '  cat-1  ', '  Subscriptions  ');
      expect(rule.categoryId).toBe('cat-1');
      expect(rule.categoryName).toBe('Subscriptions');
    });
  });

  describe('deleteRule', () => {
    it('removes a rule by id', () => {
      const rule = saveRule('netflix', 'cat-1', 'Subscriptions');
      expect(deleteRule(rule.id)).toBe(true);
      expect(loadRules()).toEqual([]);
    });

    it('returns false when rule not found', () => {
      expect(deleteRule('nonexistent')).toBe(false);
    });
  });

  describe('matchRule', () => {
    it('returns null when no rules exist', () => {
      expect(matchRule('NETFLIX')).toBeNull();
    });

    it('matches case-insensitive substring', () => {
      saveRule('NETFLIX', 'cat-1', 'Subscriptions');
      const match = matchRule('Payment to NETFLIX.COM for 15.99');
      expect(match).not.toBeNull();
      expect(match!.categoryId).toBe('cat-1');
    });

    it('returns null on no match', () => {
      saveRule('NETFLIX', 'cat-1', 'Subscriptions');
      expect(matchRule('SPOTIFY payment')).toBeNull();
    });

    it('returns a match when multiple rules match', () => {
      saveRule('NETFLIX', 'cat-1', 'Subscriptions');
      saveRule('NET', 'cat-2', 'Entertainment');

      const match = matchRule('NETFLIX.COM payment');
      expect(match).not.toBeNull();
      // Both match, returns one of them
      expect(['cat-1', 'cat-2']).toContain(match!.categoryId);
    });
  });
});
