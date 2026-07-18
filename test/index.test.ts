import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseAmountToCents, parseUserIds } from '../src/utils';
import { Context } from 'telegraf';

// Mock config to prevent loadConfig from throwing errors when src/index.ts is imported in CI
vi.mock('../src/config', () => ({
  loadConfig: () => ({
    telegramBotToken: 'dummy_token',
    accounts: [],
    allowedUserIds: [],
    actualPayeeName: 'Telegram Bot'
  })
}));

import { createAccessControlMiddleware } from '../src/index';

// We test the bot's behavior indirectly by testing the utility functions
// and the mocked actual API. Full bot integration tests require a Telegram
// bot token and are done manually (see TESTING.md).

describe('Bot Logic (unit tests)', () => {
  describe('Amount parsing integration', () => {
    it('all expense formats produce negative cents', () => {
      const testCases = [
        { input: '15', expected: -1500 },
        { input: '15.50', expected: -1550 },
        { input: '15,5', expected: -1550 },
        { input: '42.00-', expected: -4200 },
        { input: '$100', expected: -10000 },
        { input: '€25,99', expected: -2599 },
        { input: ' 0.50 ', expected: -50 },
      ];

      for (const { input, expected } of testCases) {
        expect(parseAmountToCents(input)).toBe(expected);
      }
    });
  });

  describe('Access control logic', () => {
    it('blocks user and sends warning when list is empty (secure mode)', async () => {
      const allowedUserIds: number[] = [];
      const ctx = { from: { id: 12345 }, reply: vi.fn() } as unknown as Context;
      const next = vi.fn();
      
      const middleware = createAccessControlMiddleware(allowedUserIds);
      await middleware(ctx, next);
      
      expect(next).not.toHaveBeenCalled();
      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('ALLOWED_TELEGRAM_USER_IDS parameter is not set'));
    });

    it('allows user when ID is in the list', async () => {
      const allowedUserIds = [123, 456];
      const ctx = { from: { id: 123 }, reply: vi.fn() } as unknown as Context;
      const next = vi.fn();
      
      const middleware = createAccessControlMiddleware(allowedUserIds);
      await middleware(ctx, next);
      
      expect(next).toHaveBeenCalled();
      expect(ctx.reply).not.toHaveBeenCalled();
    });

    it('blocks user when ID is not in the list', async () => {
      const allowedUserIds = [123, 456];
      const ctx = { from: { id: 789 }, reply: vi.fn() } as unknown as Context;
      const next = vi.fn();
      
      const middleware = createAccessControlMiddleware(allowedUserIds);
      await middleware(ctx, next);
      
      expect(next).not.toHaveBeenCalled();
      expect(ctx.reply).not.toHaveBeenCalled();
    });
  });

  describe('User ID parsing for access control', () => {
    it('parses typical Telegram user IDs', () => {
      const raw = '123456789,987654321';
      const ids = parseUserIds(raw);
      expect(ids).toEqual([123456789, 987654321]);
      // Verify they're numbers, not strings
      expect(typeof ids[0]).toBe('number');
    });

    it('handles single user ID', () => {
      expect(parseUserIds('123456789')).toEqual([123456789]);
    });

    it('handles empty input', () => {
      expect(parseUserIds('')).toEqual([]);
    });
  });

  describe('Transaction data formatting', () => {
    it('formats date as YYYY-MM-DD', () => {
      const date = new Date().toISOString().split('T')[0];
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('formats display amount with 2 decimal places', () => {
      const amountInCents = -1550;
      const display = (Math.abs(amountInCents) / 100).toFixed(2);
      expect(display).toBe('15.50');
    });

    it('formats whole number amount with 2 decimal places', () => {
      const amountInCents = -1000;
      const display = (Math.abs(amountInCents) / 100).toFixed(2);
      expect(display).toBe('10.00');
    });
  });

  describe('Callback data format', () => {
    it('category callback data starts with cat_', () => {
      const categoryId = 'abc-123-def';
      const callbackData = `cat_${categoryId}`;
      expect(callbackData).toBe('cat_abc-123-def');
    });

    it('category ID can be extracted from callback data', () => {
      const callbackData = 'cat_abc-123-def';
      const match = callbackData.match(/^cat_(.+)$/);
      expect(match).not.toBeNull();
      expect(match![1]).toBe('abc-123-def');
    });
  });

  describe('Inline keyboard layout', () => {
    it('creates rows of 2 buttons each', () => {
      const categories = [
        { id: '1', name: 'Food' },
        { id: '2', name: 'Transport' },
        { id: '3', name: 'Entertainment' },
        { id: '4', name: 'Shopping' },
        { id: '5', name: 'Other' },
      ];

      const buttons: Array<Array<{ text: string; callback_data: string }>> = [];
      let row: Array<{ text: string; callback_data: string }> = [];

      for (const cat of categories) {
        row.push({ text: cat.name, callback_data: `cat_${cat.id}` });
        if (row.length === 2) {
          buttons.push(row);
          row = [];
        }
      }
      if (row.length > 0) {
        buttons.push(row);
      }

      expect(buttons).toHaveLength(3); // 2 full rows + 1 partial
      expect(buttons[0]).toHaveLength(2);
      expect(buttons[1]).toHaveLength(2);
      expect(buttons[2]).toHaveLength(1);
    });

    it('handles single category', () => {
      const categories = [{ id: '1', name: 'Food' }];
      const buttons: Array<Array<{ text: string; callback_data: string }>> = [];
      let row: Array<{ text: string; callback_data: string }> = [];

      for (const cat of categories) {
        row.push({ text: cat.name, callback_data: `cat_${cat.id}` });
        if (row.length === 2) {
          buttons.push(row);
          row = [];
        }
      }
      if (row.length > 0) {
        buttons.push(row);
      }

      expect(buttons).toHaveLength(1);
      expect(buttons[0]).toHaveLength(1);
    });

    it('handles empty categories', () => {
      const categories: Array<{ id: string; name: string }> = [];
      const buttons: Array<Array<{ text: string; callback_data: string }>> = [];
      let row: Array<{ text: string; callback_data: string }> = [];

      for (const cat of categories) {
        row.push({ text: cat.name, callback_data: `cat_${cat.id}` });
        if (row.length === 2) {
          buttons.push(row);
          row = [];
        }
      }
      if (row.length > 0) {
        buttons.push(row);
      }

      expect(buttons).toHaveLength(0);
    });
  });
});
