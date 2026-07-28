import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { randomUUID } from 'crypto';

export interface Rule {
  id: string;
  pattern: string;
  categoryId: string;
  categoryName: string;
  createdAt: string;
}

interface RulesFile {
  rules: Rule[];
}

/**
 * Resolves the path to the OCR rules storage file.
 *
 * @returns The path to `ocr-rules.json` in the configured data directory
 */
function getRulesPath(): string {
  const dataDir = process.env.ACTUAL_DATA_DIR || '/app/data';
  return join(dataDir, 'ocr-rules.json');
}

/**
 * Load all rules from the JSON file.
 * Returns an empty array if the file doesn't exist or is invalid.
 */
export function loadRules(): Rule[] {
  const rulesPath = getRulesPath();
  try {
    if (!existsSync(rulesPath)) return [];
    const raw = readFileSync(rulesPath, 'utf8');
    const parsed = JSON.parse(raw) as RulesFile;
    if (!Array.isArray(parsed.rules)) return [];
    return parsed.rules;
  } catch {
    return [];
  }
}

/**
 * Save rules to the JSON file.
 */
function saveRulesToFile(rules: Rule[]): void {
  const rulesPath = getRulesPath();
  const dir = dirname(rulesPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const data: RulesFile = { rules };
  writeFileSync(rulesPath, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Creates a rule for an OCR pattern, replacing any existing rule with the same normalized pattern.
 *
 * @param pattern - The OCR pattern to trim and convert to uppercase
 * @param categoryId - The category identifier associated with the rule
 * @param categoryName - The category name associated with the rule
 * @returns The newly created rule
 */
export function saveRule(pattern: string, categoryId: string, categoryName: string): Rule {
  const rules = loadRules();
  const normalizedPattern = pattern.trim().toUpperCase();

  // Remove existing rule with same pattern
  const filtered = rules.filter((r) => r.pattern.toUpperCase() !== normalizedPattern);

  const newRule: Rule = {
    id: randomUUID(),
    pattern: normalizedPattern,
    categoryId,
    categoryName,
    createdAt: new Date().toISOString(),
  };

  filtered.push(newRule);
  saveRulesToFile(filtered);
  return newRule;
}

/**
 * Deletes the rule with the specified identifier.
 *
 * @param id - The identifier of the rule to delete
 * @returns `true` if a rule was deleted, `false` if no matching rule was found
 */
export function deleteRule(id: string): boolean {
  const rules = loadRules();
  const filtered = rules.filter((r) => r.id !== id);
  if (filtered.length === rules.length) return false;
  saveRulesToFile(filtered);
  return true;
}

/**
 * Finds the most recently created rule whose pattern appears in the OCR text.
 *
 * @param ocrText - The OCR text to evaluate
 * @returns The most recently created matching rule, or `null` if no rule matches
 */
export function matchRule(ocrText: string): Rule | null {
  const rules = loadRules();
  const upperText = ocrText.toUpperCase();

  // Find all matches, sorted by most recent first
  const matches = rules
    .filter((r) => upperText.includes(r.pattern))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return matches[0] ?? null;
}
