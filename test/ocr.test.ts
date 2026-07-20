import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildAnalysisPrompt, parseAiResponse, countAmountsInOcr, validateCategoryMatch } from '../src/ocr';
import type { Category, OcrAnalysis } from '../src/ocr';

const mockCategories: Category[] = [
  { id: 'cat-1', name: 'Food & Dining', is_income: false, hidden: false, group_id: 'grp-1' },
  { id: 'cat-2', name: 'Subscriptions', is_income: false, hidden: false, group_id: 'grp-2' },
  { id: 'cat-3', name: 'Transport', is_income: false, hidden: false, group_id: 'grp-3' },
  { id: 'cat-4', name: 'Action', is_income: false, hidden: false, group_id: 'grp-4' },
];

describe('buildAnalysisPrompt', () => {
  it('includes all category IDs and names', () => {
    const prompt = buildAnalysisPrompt('NETFLIX 15.99', mockCategories);
    expect(prompt).toContain('[cat-1] Food & Dining');
    expect(prompt).toContain('[cat-2] Subscriptions');
    expect(prompt).toContain('[cat-3] Transport');
  });

  it('handles empty OCR text', () => {
    const prompt = buildAnalysisPrompt('', mockCategories);
    expect(prompt).toContain('[No readable text detected]');
  });

  it('handles empty categories list', () => {
    const prompt = buildAnalysisPrompt('NETFLIX 15.99', []);
    expect(prompt).toContain('(No categories available)');
  });

  it('includes OCR text in prompt', () => {
    const ocrText = 'NETFLIX.COM 15.99 USD';
    const prompt = buildAnalysisPrompt(ocrText, mockCategories);
    expect(prompt).toContain(ocrText);
  });
});

describe('parseAiResponse', () => {
  it('parses valid JSON with all fields', () => {
    const raw = JSON.stringify({
      amount: 15.99,
      categoryId: 'cat-2',
      categoryName: 'Subscriptions',
      confidence: 'high',
      reasoning: 'Netflix subscription',
    });
    const result = parseAiResponse(raw);
    expect(result.amountInCents).toBe(-1599);
    expect(result.categoryId).toBe('cat-2');
    expect(result.categoryName).toBe('Subscriptions');
    expect(result.confidence).toBe('high');
    expect(result.reasoning).toBe('Netflix subscription');
  });

  it('strips markdown code fences', () => {
    const raw = '```json\n{"amount": 10.50, "categoryId": "cat-1", "categoryName": "Food", "confidence": "medium", "reasoning": "Lunch"}\n```';
    const result = parseAiResponse(raw);
    expect(result.amountInCents).toBe(-1050);
    expect(result.categoryId).toBe('cat-1');
  });

  it('handles missing amount', () => {
    const raw = JSON.stringify({
      categoryId: 'cat-1',
      categoryName: 'Food',
      confidence: 'low',
      reasoning: 'Cannot determine amount',
    });
    const result = parseAiResponse(raw);
    expect(result.amountInCents).toBeNull();
  });

  it('handles missing categoryId', () => {
    const raw = JSON.stringify({
      amount: 25.00,
      confidence: 'low',
      reasoning: 'No matching category',
    });
    const result = parseAiResponse(raw);
    expect(result.categoryId).toBeNull();
    expect(result.categoryName).toBeNull();
  });

  it('handles invalid confidence defaults to low', () => {
    const raw = JSON.stringify({
      amount: 10.00,
      categoryId: 'cat-1',
      categoryName: 'Food',
      confidence: 'invalid',
      reasoning: 'Test',
    });
    const result = parseAiResponse(raw);
    expect(result.confidence).toBe('low');
  });

  it('handles empty reasoning', () => {
    const raw = JSON.stringify({
      amount: 10.00,
      categoryId: 'cat-1',
      categoryName: 'Food',
      confidence: 'high',
    });
    const result = parseAiResponse(raw);
    expect(result.reasoning).toBe('');
  });

  it('converts amount to negative cents', () => {
    const raw = JSON.stringify({
      amount: 99.95,
      categoryId: 'cat-1',
      categoryName: 'Food',
      confidence: 'high',
      reasoning: 'Test',
    });
    const result = parseAiResponse(raw);
    expect(result.amountInCents).toBe(-9995);
  });

  it('throws on completely invalid JSON', () => {
    expect(() => parseAiResponse('not json at all')).toThrow();
  });
});

describe('countAmountsInOcr', () => {
  it('returns 0 for empty text', () => {
    expect(countAmountsInOcr('')).toBe(0);
  });

  it('counts single price-like amount', () => {
    expect(countAmountsInOcr('NETFLIX 15.99')).toBe(1);
  });

  it('counts multiple price-like amounts', () => {
    expect(countAmountsInOcr('Total: 15.99 Tax: 2.50 Grand Total: 18.49')).toBe(3);
  });

  it('counts amounts with comma separator', () => {
    // "1.234,56" matches "1.23" and "4,56" — two price-like patterns
    expect(countAmountsInOcr('1.234,56')).toBe(2);
  });

  it('does not count plain integers', () => {
    expect(countAmountsInOcr('Order 12345 confirmed')).toBe(0);
  });
});

describe('validateCategoryMatch', () => {
  it('returns result unchanged when categoryId matches categoryName', () => {
    const result: OcrAnalysis = {
      amountInCents: -464,
      categoryId: 'cat-4',
      categoryName: 'Action',
      confidence: 'high',
      reasoning: 'Test',
    };
    const validated = validateCategoryMatch(result, mockCategories);
    expect(validated.categoryId).toBe('cat-4');
  });

  it('fixes mismatched categoryId by looking up categoryName', () => {
    // AI returned wrong categoryId but correct categoryName
    const result: OcrAnalysis = {
      amountInCents: -464,
      categoryId: 'cat-1', // Wrong! This is Food & Dining
      categoryName: 'Action',
      confidence: 'high',
      reasoning: 'Test',
    };
    const validated = validateCategoryMatch(result, mockCategories);
    expect(validated.categoryId).toBe('cat-4');
    expect(validated.categoryName).toBe('Action');
  });

  it('clears category when categoryName not found', () => {
    const result: OcrAnalysis = {
      amountInCents: -464,
      categoryId: 'cat-999',
      categoryName: 'Nonexistent',
      confidence: 'high',
      reasoning: 'Test',
    };
    const validated = validateCategoryMatch(result, mockCategories);
    expect(validated.categoryId).toBeNull();
    expect(validated.categoryName).toBeNull();
  });

  it('handles case-insensitive category name match', () => {
    const result: OcrAnalysis = {
      amountInCents: -464,
      categoryId: 'cat-1',
      categoryName: 'action',
      confidence: 'high',
      reasoning: 'Test',
    };
    const validated = validateCategoryMatch(result, mockCategories);
    expect(validated.categoryId).toBe('cat-4');
  });

  it('returns result unchanged when categoryId is null', () => {
    const result: OcrAnalysis = {
      amountInCents: null,
      categoryId: null,
      categoryName: null,
      confidence: 'low',
      reasoning: 'Could not parse',
    };
    const validated = validateCategoryMatch(result, mockCategories);
    expect(validated.categoryId).toBeNull();
  });
});
