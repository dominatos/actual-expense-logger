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

export interface AppConfig {
  telegramBotToken: string;
  actualServerUrl: string;
  actualPassword: string;
  actualSyncId: string;
  actualDefaultAccountId: string;
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
  const actualDefaultAccountId = requireSecret('ACTUAL_DEFAULT_ACCOUNT_ID');

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
    actualDefaultAccountId,
    actualDataDir,
    actualFilePassword,
    actualPayeeName,
    allowedUserIds,
  };

  return _config;
}
