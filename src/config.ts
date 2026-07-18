import { readFileSync } from 'fs';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * Reads a secret value. Prefers Docker secret files (/run/secrets/<name>)
 * when the corresponding _FILE env var is set, otherwise falls back to
 * the env var directly. This allows backward compatibility with .env
 * for local development while supporting Docker secrets in production.
 */
export function readSecret(envKey: string): string | undefined {
  const fileKey = `${envKey}_FILE`;
  const filePath = process.env[fileKey];
  if (filePath) {
    try {
      return readFileSync(filePath, 'utf8').trim();
    } catch (err) {
      throw new Error(`Failed to read secret file ${filePath} for ${envKey}: ${err}`);
    }
  }
  return process.env[envKey];
}

export function requireSecret(envKey: string): string {
  const value = readSecret(envKey);
  if (!value) {
    throw new Error(`Missing required environment variable or secret: ${envKey}`);
  }
  return value;
}

export function optional(envKey: string, defaultValue: string): string {
  return readSecret(envKey) || process.env[envKey] || defaultValue;
}

function parseUserIds(raw: string): number[] {
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

export interface AccountEntry {
  name: string;
  id: string;
}

export function parseAccounts(raw: string): AccountEntry[] {
  if (!raw) return [];
  const entries: AccountEntry[] = [];
  const tokens = raw.split(',').map((s) => s.trim()).filter(Boolean);
  for (const token of tokens) {
    const sepIndex = token.indexOf(':');
    if (sepIndex === -1) {
      throw new Error(`Invalid ACTUAL_ACCOUNTS entry "${token}": expected format "name:uuid"`);
    }
    const name = token.substring(0, sepIndex).trim();
    const id = token.substring(sepIndex + 1).trim();
    if (!name || !id) {
      throw new Error(`Invalid ACTUAL_ACCOUNTS entry "${token}": name and uuid must not be empty`);
    }
    entries.push({ name, id });
  }
  return entries;
}

export interface AppConfig {
  telegramBotToken: string;
  actualServerUrl: string;
  actualPassword: string;
  actualSyncId: string;
  accounts: AccountEntry[];
  actualDataDir: string;
  actualFilePassword: string | undefined;
  actualPayeeName: string;
  allowedUserIds: number[];
}

let _config: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (_config) return _config;

  const telegramBotToken = requireSecret('TELEGRAM_BOT_TOKEN');
  const actualServerUrl = requireSecret('ACTUAL_SERVER_URL');
  const actualPassword = requireSecret('ACTUAL_PASSWORD');
  const actualSyncId = requireSecret('ACTUAL_SYNC_ID');

  // Backward compatibility: if ACTUAL_ACCOUNTS is set, use it.
  // Otherwise fall back to ACTUAL_DEFAULT_ACCOUNT_ID (single "Default" account).
  const accountsRaw = (readSecret('ACTUAL_ACCOUNTS') || process.env.ACTUAL_ACCOUNTS || '').trim();
  let accounts: AccountEntry[];
  if (accountsRaw) {
    accounts = parseAccounts(accountsRaw);
    if (accounts.length === 0) {
      throw new Error('ACTUAL_ACCOUNTS is set but contains no valid "name:uuid" entries');
    }
  } else {
    const fallbackId = requireSecret('ACTUAL_DEFAULT_ACCOUNT_ID');
    accounts = [{ name: 'Default', id: fallbackId }];
  }

  const actualDataDir = optional('ACTUAL_DATA_DIR', '/app/data');
  const actualFilePassword = readSecret('ACTUAL_FILE_PASSWORD') || undefined;
  const actualPayeeName = optional('ACTUAL_PAYEE_NAME', 'Telegram Bot');
  const allowedUserIds = parseUserIds(
    readSecret('ALLOWED_TELEGRAM_USER_IDS') || process.env.ALLOWED_TELEGRAM_USER_IDS || ''
  );

  _config = {
    telegramBotToken,
    actualServerUrl,
    actualPassword,
    actualSyncId,
    accounts,
    actualDataDir,
    actualFilePassword,
    actualPayeeName,
    allowedUserIds,
  };

  return _config;
}
