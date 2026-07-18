/**
 * Parse a user-provided amount string into negative cents for Actual Budget.
 * Handles: "15" -> -1500, "15.50" -> -1550, "15,5" -> -1550, "42.00-" -> -4200
 * Strips currency symbols and spaces. Distinguishes decimal from thousands separators.
 * Returns null for ambiguous or malformed input.
 */
export function parseAmountToCents(text: string): number | null {
  // Strip currency symbols, spaces, and other non-numeric characters (keep digits, dot, comma, minus)
  const cleaned = text.replace(/[^0-9.,\-]/g, '');
  if (!cleaned) return null;

  // Handle trailing minus (e.g., "42.00-" -> "-42.00")
  let numStr = cleaned;
  if (numStr.endsWith('-')) {
    numStr = '-' + numStr.slice(0, -1);
  }

  // Determine decimal separator: last occurrence of comma or dot
  const lastComma = numStr.lastIndexOf(',');
  const lastDot = numStr.lastIndexOf('.');

  if (lastComma > -1 && lastDot > -1) {
    // Both present — the last one is the decimal separator
    if (lastComma > lastDot) {
      // European: "1.234,56" -> "1234.56"
      numStr = numStr.replace(/\./g, '').replace(',', '.');
    } else {
      // US: "1,234.56" -> "1234.56"
      numStr = numStr.replace(/,/g, '');
    }
  } else if (lastComma > -1) {
    // Only comma — treat as decimal separator
    numStr = numStr.replace(',', '.');
  }
  // Only dot or neither — keep as-is

  const parsed = parseFloat(numStr);
  if (isNaN(parsed) || !Number.isFinite(parsed)) return null;

  // Convert to negative cents (expense)
  const cents = Math.round(Math.abs(parsed) * 100);
  if (!Number.isSafeInteger(cents)) return null;
  return -cents;
}

/**
 * Parse a comma-separated string of Telegram user IDs into a number array.
 * Validates each token as a positive safe integer. Throws on malformed input.
 */
export function parseUserIds(raw: string): number[] {
  if (!raw) return [];
  const tokens = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const ids: number[] = [];
  for (const token of tokens) {
    const n = Number(token);
    if (!Number.isSafeInteger(n) || n <= 0) {
      throw new Error(`Invalid ALLOWED_TELEGRAM_USER_IDS token: "${token}"`);
    }
    ids.push(n);
  }
  return ids;
}
