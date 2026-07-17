/**
 * Parse a user-provided amount string into negative cents for Actual Budget.
 * Handles: "15" -> -1500, "15.50" -> -1550, "15,5" -> -1550, "42.00-" -> -4200
 * Ignores currency symbols, spaces, and other non-numeric characters.
 * Returns null if no valid number can be extracted.
 */
export function parseAmountToCents(text: string): number | null {
  const match = text.match(/[-]?\d+([.,]\d+)?-?/);
  if (!match) return null;

  let numStr = match[0].replace(',', '.');
  if (numStr.endsWith('-')) {
    numStr = '-' + numStr.slice(0, -1);
  }

  const parsed = parseFloat(numStr);
  if (isNaN(parsed)) return null;

  // Convert to negative cents (expense)
  const cents = Math.round(Math.abs(parsed) * 100);
  return -cents;
}

/**
 * Parse a comma-separated string of Telegram user IDs into a number array.
 * Filters out empty strings, whitespace, and NaN values.
 */
export function parseUserIds(raw: string): number[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => !isNaN(n));
}
