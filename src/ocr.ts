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
 * Downloads an image to a uniquely named temporary JPEG file.
 *
 * @param fileUrl - URL of the image to download
 * @param timeoutMs - Maximum download duration in milliseconds
 * @returns The path to the downloaded temporary file
 * @throws Error if the download response is unsuccessful
 */
export async function downloadTelegramPhoto(
  botToken: string,
  fileUrl: string,
  timeoutMs: number = 30_000
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(fileUrl, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Failed to download photo: ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const tmpPath = join('/tmp', `ocr_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`);
    await writeFile(tmpPath, buffer);
    return tmpPath;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extracts and normalizes text recognized from an image.
 *
 * @param imagePath - Path to the image to process
 * @param language - OCR language code
 * @param cacheDir - Optional directory for OCR language data and cache files
 * @returns The recognized text with trimmed, non-empty lines joined by newline characters
 */
export async function extractTextFromImage(
  imagePath: string,
  language: string = 'eng',
  cacheDir?: string
): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  if (cacheDir && !existsSync(cacheDir)) {
    await mkdir(cacheDir, { recursive: true });
  }
  const workerOptions = cacheDir ? { cachePath: cacheDir } : {};
  const worker = await createWorker(language, undefined, workerOptions);
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
 * Counts price-like monetary amounts in OCR text.
 *
 * @returns The number of detected amounts.
 */
export function countAmountsInOcr(ocrText: string): number {
  // Match locale-aware monetary amounts:
  // - Optional thousands groups (either 1,234 or 1.234 style)
  // - Followed by a decimal separator and 1-2 digits (e.g. 15,5 or 15.99)
  // Each full amount (including thousands separator) counts as one match.
  const matches = ocrText.match(/\d{1,3}(?:[.,]\d{3})*[.,]\d{1,2}(?!\d)/g);
  return matches ? matches.length : 0;
}

/**
 * Builds a prompt for extracting a transaction amount and matching it to an available budget category.
 *
 * @param ocrText - Text extracted from the transaction screenshot.
 * @param categories - Budget categories available for matching.
 * @returns A prompt requiring a JSON object containing the extracted amount, category match, confidence, and reasoning.
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
 * Sends an analysis prompt to the configured AI provider.
 *
 * @param prompt - The OCR analysis prompt to submit
 * @returns The provider's response text
 * @throws If OpenAI is selected without an API key or the AI provider is unsupported
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
 * Normalizes a JSON-formatted AI response into an OCR analysis result.
 *
 * @param raw - The AI response, optionally enclosed in a Markdown JSON code block
 * @returns The normalized analysis with amount, category fields, confidence, and reasoning
 */
export function parseAiResponse(raw: string): OcrAnalysis {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  const parsed = JSON.parse(cleaned);

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      amountInCents: null,
      categoryId: null,
      categoryName: null,
      confidence: 'low',
      reasoning: 'Failed to parse AI response: not a valid object.',
    };
  }

  const record = parsed as Record<string, unknown>;

  // Only non-negative numeric amounts are valid expenses; negative values are rejected.
  // Reject amounts that would exceed Number.MAX_SAFE_INTEGER after conversion.
  let amountInCents: number | null = null;
  if (typeof record.amount === 'number' && record.amount >= 0) {
    const rounded = Math.round(record.amount * 100);
    if (Number.isSafeInteger(rounded)) {
      amountInCents = -rounded;
    }
  }

  return {
    amountInCents,
    categoryId: typeof record.categoryId === 'string' ? record.categoryId : null,
    categoryName: typeof record.categoryName === 'string' ? record.categoryName : null,
    confidence: ['high', 'medium', 'low'].includes(record.confidence as string) ? record.confidence as OcrAnalysis['confidence'] : 'low',
    reasoning: typeof record.reasoning === 'string' ? record.reasoning : '',
  };
}

/**
 * Validates and reconciles the category identifiers and names in an OCR analysis result.
 *
 * @param result - The OCR analysis result to validate
 * @param categories - The available budget categories
 * @returns The result with canonical category details, or cleared category fields and low confidence when no category can be resolved
 */
export function validateCategoryMatch(
  result: OcrAnalysis,
  categories: Category[]
): OcrAnalysis {
  // No categoryId at all — nothing to validate.
  if (!result.categoryId) return result;

  // categoryId is present: resolve it through categories.find regardless of
  // whether categoryName is populated, so orphaned IDs are always verified.
  const byId = categories.find((c) => c.id === result.categoryId);

  if (byId) {
    if (!result.categoryName || byId.name.toLowerCase() === result.categoryName.toLowerCase()) {
      // ID is valid; populate the canonical name and return.
      console.log(`[OCR VALIDATE] Category match OK: ${result.categoryId} = ${byId.name}`);
      return { ...result, categoryName: byId.name };
    }

    // ID valid but name mismatches — trust the name to find the correct ID.
    const byName = categories.find(
      (c) => c.name.toLowerCase() === result.categoryName!.toLowerCase()
    );
    if (byName) {
      console.log(`[OCR VALIDATE] FIXED mismatch: ${result.categoryId} (${byId.name}) -> ${byName.id} (${byName.name})`);
      return { ...result, categoryId: byName.id, categoryName: byName.name };
    }

    // Name not found — clear both to avoid inconsistent state.
    console.log(`[OCR VALIDATE] Category not found: ${result.categoryName}`);
    return { ...result, categoryId: null, categoryName: null, confidence: 'low' };
  }

  // ID not found in categories list — try to recover by name.
  if (result.categoryName) {
    const byName = categories.find(
      (c) => c.name.toLowerCase() === result.categoryName!.toLowerCase()
    );
    if (byName) {
      console.log(`[OCR VALIDATE] FIXED unknown ID via name: ${result.categoryId} -> ${byName.id} (${byName.name})`);
      return { ...result, categoryId: byName.id, categoryName: byName.name };
    }
  }

  // Neither ID nor name could be resolved — clear both.
  console.log(`[OCR VALIDATE] Category not found: id=${result.categoryId}, name=${result.categoryName ?? '(none)'}`);
  return { ...result, categoryId: null, categoryName: null, confidence: 'low' };
}

/**
 * Analyzes a Telegram receipt and produces a categorized budget result.
 *
 * @param botToken - The Telegram bot token used to download the receipt image
 * @param fileUrl - The Telegram file URL for the receipt image
 * @param ocrText - Optional pre-extracted text; when provided, image download and OCR are skipped
 * @returns The normalized amount, matched category, confidence, and reasoning
 */
export async function processScreenshot(
  botToken: string,
  fileUrl: string,
  ocrText?: string,
): Promise<OcrAnalysis> {
  const config = loadConfig();
  let tmpPath: string | null = null;

  try {
    let text: string;
    if (ocrText === undefined) {
      tmpPath = await downloadTelegramPhoto(botToken, fileUrl);
      text = await extractTextFromImage(tmpPath, config.ocrLanguage, config.ocrCacheDir);
    } else {
      text = ocrText;
    }
    console.log(`[OCR] Extracted text (${text.length} chars): ${text.substring(0, 200)}`);
    const categories = await getCategories();
    console.log(`[OCR] Available categories: ${categories.map((c) => `${c.id}=${c.name}`).join(', ')}`);
    const prompt = buildAnalysisPrompt(text, categories);
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

/**
 * Sends a prompt to an Ollama-compatible endpoint and retrieves the generated text.
 *
 * @param url - The endpoint URL
 * @param model - The model to use
 * @param prompt - The prompt to send
 * @param timeoutMs - The request timeout in milliseconds
 * @returns The generated response text
 */

async function callOllama(url: string, model: string, prompt: string, timeoutMs: number = 120_000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: false }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Ollama request failed (${response.status}): ${text}`);
    }

    const result = await response.json() as Record<string, unknown>;
    return (result.response ?? result.result ?? result.output ?? '') as string;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sends a prompt to the OpenAI chat completions API and retrieves the generated content.
 *
 * @param apiKey - The API key used for authentication
 * @param model - The OpenAI model to use
 * @param prompt - The expense categorization prompt
 * @param timeoutMs - The request timeout in milliseconds
 * @returns The response content, or an empty string when no content is available
 * @throws {Error} If the API response is not successful
 */
async function callOpenAi(apiKey: string, model: string, prompt: string, timeoutMs: number = 60_000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
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
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI request failed (${response.status}): ${text}`);
    }

    const result = await response.json() as Record<string, unknown>;
    const choices = result.choices as Array<{ message?: { content?: string } }> | undefined;
    return choices?.[0]?.message?.content ?? '';
  } finally {
    clearTimeout(timer);
  }
}
