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
 * Add a new rule. If a rule with the same pattern exists, it is replaced.
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
 * Delete a rule by ID.
 */
export function deleteRule(id: string): boolean {
  const rules = loadRules();
  const filtered = rules.filter((r) => r.id !== id);
  if (filtered.length === rules.length) return false;
  saveRulesToFile(filtered);
  return true;
}

/**
 * Match OCR text against saved rules (case-insensitive substring).
 * Returns the most recently created match, or null if no match.
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
