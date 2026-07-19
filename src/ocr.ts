import { writeFile, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { loadConfig } from './config';
import { getCategories } from './actual';

// --- Types ---

export interface Category {
  id: string;
  name: string;
  is_income: boolean;
  hidden: boolean;
  group_id: string;
}

export interface OcrAnalysis {
  amountInCents: number | null;
  categoryId: string | null;
  categoryName: string | null;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
}

// --- Functions ---

/**
 * Download a Telegram photo to a temporary file and return the path.
 */
export async function downloadTelegramPhoto(
  botToken: string,
  fileUrl: string
): Promise<string> {
  const response = await fetch(fileUrl);
  if (!response.ok) {
    throw new Error(`Failed to download photo: ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const tmpPath = join('/tmp', `ocr_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`);
  await writeFile(tmpPath, buffer);
  return tmpPath;
}

/**
 * Extract text from an image using tesseract.js.
 */
export async function extractTextFromImage(
  imagePath: string,
  language: string = 'eng'
): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker(language);
  try {
    const result = await worker.recognize(imagePath);
    return result.data.text
      .split('\n')
      .map((line: string) => line.trim())
      .filter(Boolean)
      .join('\n');
  } finally {
    await worker.terminate();
  }
}

/**
 * Count how many price-like amounts appear in OCR text.
 * Used for confidence indicator (multiple amounts = potential ambiguity).
 */
export function countAmountsInOcr(ocrText: string): number {
  const matches = ocrText.match(/\d+[.,]\d{2}/g);
  return matches ? matches.length : 0;
}

/**
 * Build the AI prompt that includes OCR text and Actual Budget categories.
 */
export function buildAnalysisPrompt(ocrText: string, categories: Category[]): string {
  const categoryList = categories
    .map((c, i) => `${i + 1}. [${c.id}] ${c.name}`)
    .join('\n');

  return `You are an expense categorization assistant. Extract the transaction amount and match it to the best category from the user's budget.

Available budget categories:
${categoryList || '(No categories available)'}

OCR text from screenshot:
---
${ocrText || '[No readable text detected]'}
---

Respond with ONLY a JSON object (no markdown, no explanation):
{
  "amount": 15.99,
  "categoryId": "def-456",
  "categoryName": "Subscriptions",
  "confidence": "high",
  "reasoning": "Netflix monthly subscription charge"
}

CRITICAL RULES:
1. FIRST: Look for the STORE or MERCHANT NAME in the OCR text (e.g., "ACTION", "NETFLIX", "UBER").
2. SECOND: Check if any category name MATCHES the store name exactly or closely. If a category is named after the store (e.g., category "Action" for store "ACTION"), ALWAYS prefer that category.
3. THIRD: Only if no store-specific category exists, match by transaction type (food, transport, etc.).
4. amount: the main expense TOTAL number (numeric, no currency symbol). Use positive number. Look for "TOTALE" or "Total" lines.
5. categoryId: exact ID from the list above, or null if no match found
6. categoryName: exact name from the list above, or null
7. confidence: "high" | "medium" | "low"
8. reasoning: one short sentence (max 50 words)
9. If OCR text is unreadable or amount cannot be determined: {"amount": null, "categoryId": null, "categoryName": null, "confidence": "low", "reasoning": "Could not parse screenshot"}`;
}

/**
 * Call the configured AI provider to analyze OCR text + categories.
 */
export async function callAiProvider(prompt: string): Promise<string> {
  const config = loadConfig();

  if (config.aiProvider === 'ollama') {
    return callOllama(config.ollamaUrl, config.ollamaModel, prompt);
  }

  if (config.aiProvider === 'openai') {
    if (!config.openaiApiKey) {
      throw new Error('OPENAI_API_KEY is required when AI_PROVIDER=openai');
    }
    return callOpenAi(config.openaiApiKey, config.openaiModel, prompt);
  }

  throw new Error('AI_PROVIDER is not configured. Set AI_PROVIDER=ollama or AI_PROVIDER=openai');
}

/**
 * Parse the AI response JSON string into an OcrAnalysis object.
 * Handles cases where the AI wraps JSON in markdown code blocks.
 */
export function parseAiResponse(raw: string): OcrAnalysis {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  const parsed = JSON.parse(cleaned);

  return {
    amountInCents: typeof parsed.amount === 'number' ? -Math.round(parsed.amount * 100) : null,
    categoryId: typeof parsed.categoryId === 'string' ? parsed.categoryId : null,
    categoryName: typeof parsed.categoryName === 'string' ? parsed.categoryName : null,
    confidence: ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : 'low',
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
  };
}

/**
 * Validate and fix AI result: ensure categoryId matches categoryName.
 * If the AI returned a mismatched pair, look up the correct categoryId by name.
 */
export function validateCategoryMatch(
  result: OcrAnalysis,
  categories: Category[]
): OcrAnalysis {
  if (!result.categoryId || !result.categoryName) return result;

  // Check if the categoryId actually exists in categories
  const byId = categories.find((c) => c.id === result.categoryId);
  if (byId && byId.name === result.categoryName) {
    console.log(`[OCR VALIDATE] Category match OK: ${result.categoryId} = ${result.categoryName}`);
    return result; // Match is correct
  }

  // Mismatch: find the correct categoryId by categoryName
  const byName = categories.find(
    (c) => c.name.toLowerCase() === result.categoryName!.toLowerCase()
  );
  if (byName) {
    console.log(`[OCR VALIDATE] FIXED mismatch: ${result.categoryId} (${byId?.name ?? 'unknown'}) -> ${byName.id} (${byName.name})`);
    return { ...result, categoryId: byName.id };
  }

  // Category not found at all — clear it
  console.log(`[OCR VALIDATE] Category not found: ${result.categoryName}`);
  return { ...result, categoryId: null, categoryName: null, confidence: 'low' };
}

/**
 * Full pipeline: download photo -> OCR -> AI analysis -> structured result.
 */
export async function processScreenshot(
  botToken: string,
  fileUrl: string,
): Promise<OcrAnalysis> {
  const config = loadConfig();
  let tmpPath: string | null = null;

  try {
    tmpPath = await downloadTelegramPhoto(botToken, fileUrl);
    const ocrText = await extractTextFromImage(tmpPath, config.ocrLanguage);
    console.log(`[OCR] Extracted text (${ocrText.length} chars): ${ocrText.substring(0, 200)}`);
    const categories = await getCategories();
    console.log(`[OCR] Available categories: ${categories.map((c) => `${c.id}=${c.name}`).join(', ')}`);
    const prompt = buildAnalysisPrompt(ocrText, categories);
    const rawResponse = await callAiProvider(prompt);
    console.log(`[OCR] Raw AI response: ${rawResponse.substring(0, 500)}`);
    const result = parseAiResponse(rawResponse);
    console.log(`[OCR] Parsed result: categoryId=${result.categoryId}, categoryName=${result.categoryName}, amount=${result.amountInCents}`);
    return validateCategoryMatch(result, categories);
  } finally {
    if (tmpPath) {
      await unlink(tmpPath).catch(() => {});
    }
  }
}

// --- Private helpers ---

async function callOllama(url: string, model: string, prompt: string): Promise<string> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: false }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Ollama request failed (${response.status}): ${text}`);
  }

  const result = await response.json() as Record<string, unknown>;
  return (result.response ?? result.result ?? result.output ?? '') as string;
}

async function callOpenAi(apiKey: string, model: string, prompt: string): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'You are an expense categorization assistant. Always respond with valid JSON only.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI request failed (${response.status}): ${text}`);
  }

  const result = await response.json() as Record<string, unknown>;
  const choices = result.choices as Array<{ message?: { content?: string } }> | undefined;
  return choices?.[0]?.message?.content ?? '';
}
