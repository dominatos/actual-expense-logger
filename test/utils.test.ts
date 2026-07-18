import { describe, it, expect } from 'vitest';
import { parseAmountToCents, parseUserIds } from '../src/utils';

describe('parseAmountToCents', () => {
  // --- Whole numbers ---
  it('parses whole number "15" to -1500', () => {
    expect(parseAmountToCents('15')).toBe(-1500);
  });

  it('parses whole number "0" to -0', () => {
    expect(Object.is(parseAmountToCents('0'), -0)).toBe(true);
  });

  it('parses whole number "100" to -10000', () => {
    expect(parseAmountToCents('100')).toBe(-10000);
  });

  // --- Decimal with dot ---
  it('parses "15.50" to -1550', () => {
    expect(parseAmountToCents('15.50')).toBe(-1550);
  });

  it('parses "10.5" to -1050', () => {
    expect(parseAmountToCents('10.5')).toBe(-1050);
  });

  it('parses "0.01" to -1', () => {
    expect(parseAmountToCents('0.01')).toBe(-1);
  });

  it('parses "99.99" to -9999', () => {
    expect(parseAmountToCents('99.99')).toBe(-9999);
  });

  // --- Decimal with comma ---
  it('parses "15,5" to -1550', () => {
    expect(parseAmountToCents('15,5')).toBe(-1550);
  });

  it('parses "10,50" to -1050', () => {
    expect(parseAmountToCents('10,50')).toBe(-1050);
  });

  it('parses "0,01" to -1', () => {
    expect(parseAmountToCents('0,01')).toBe(-1);
  });

  // --- Trailing minus ---
  it('parses "42.00-" to -4200', () => {
    expect(parseAmountToCents('42.00-')).toBe(-4200);
  });

  it('parses "15-" to -1500', () => {
    expect(parseAmountToCents('15-')).toBe(-1500);
  });

  // --- Leading minus (should still produce negative) ---
  it('parses "-15" to -1500 (expense)', () => {
    expect(parseAmountToCents('-15')).toBe(-1500);
  });

  it('parses "-15.50" to -1550 (expense)', () => {
    expect(parseAmountToCents('-15.50')).toBe(-1550);
  });

  // --- Currency symbols and spaces (should be ignored) ---
  it('parses "$15.50" to -1550', () => {
    expect(parseAmountToCents('$15.50')).toBe(-1550);
  });

  it('parses "€10,5" to -1050', () => {
    expect(parseAmountToCents('€10,5')).toBe(-1050);
  });

  it('parses " 42 " to -4200', () => {
    expect(parseAmountToCents(' 42 ')).toBe(-4200);
  });

  it('parses "USD 99.99" to -9999', () => {
    expect(parseAmountToCents('USD 99.99')).toBe(-9999);
  });

  // --- Large numbers ---
  it('parses "1000" to -100000', () => {
    expect(parseAmountToCents('1000')).toBe(-100000);
  });

  it('parses "9999.99" to -999999', () => {
    expect(parseAmountToCents('9999.99')).toBe(-999999);
  });

  // --- Edge cases: invalid input ---
  it('returns null for empty string', () => {
    expect(parseAmountToCents('')).toBeNull();
  });

  it('returns null for non-numeric text', () => {
    expect(parseAmountToCents('hello')).toBeNull();
  });

  it('returns null for only symbols', () => {
    expect(parseAmountToCents('$$$')).toBeNull();
  });

  // --- Rounding ---
  it('rounds "15.555" correctly', () => {
    // 15.555 * 100 = 1555.5, rounded = 1556
    expect(parseAmountToCents('15.555')).toBe(-1556);
  });

  it('rounds "0.001" to -0 (rounds down)', () => {
    // 0.001 * 100 = 0.1, rounded = 0
    expect(Object.is(parseAmountToCents('0.001'), -0)).toBe(true);
  });
});

describe('parseUserIds', () => {
  it('parses single ID', () => {
    expect(parseUserIds('123456')).toEqual([123456]);
  });

  it('parses multiple comma-separated IDs', () => {
    expect(parseUserIds('123,456,789')).toEqual([123, 456, 789]);
  });

  it('handles spaces around IDs', () => {
    expect(parseUserIds(' 123 , 456 , 789 ')).toEqual([123, 456, 789]);
  });

  it('returns empty array for empty string', () => {
    expect(parseUserIds('')).toEqual([]);
  });

  it('throws on invalid tokens', () => {
    expect(() => parseUserIds('123,abc,456')).toThrow('Invalid ALLOWED_TELEGRAM_USER_IDS token: "abc"');
  });

  it('filters out empty entries', () => {
    expect(parseUserIds('123,,456,')).toEqual([123, 456]);
  });

  it('handles trailing comma', () => {
    expect(parseUserIds('123,456,')).toEqual([123, 456]);
  });
});
